// Package agent is the KIASA Browser's job loop. It takes the member's next job from KIASA,
// reads every question on the form, sends them to the model server, and types in what comes
// back, with the résumé made for that job. It has no AI of its own and writes no answer.
//
// This version only fills forms: nothing in it, or in the package that fills them, presses a
// form's submit button.
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/answers"
	"stealth-app/internal/ats"
	"stealth-app/internal/brand"
	"stealth-app/internal/gmail"
	"stealth-app/internal/link"
)

// Config is what the loop needs from the browser around it.
type Config struct {
	Code   func() link.Code
	NewTab func() (playwright.Page, error)
	// Status says how the browser is, for the Auto apply page.
	Status func(state, detail string)
	// WorkDir holds each job's résumé while its form is open.
	WorkDir string
	// RestIdle is how long it waits when there is nothing to do.
	RestIdle time.Duration
	// RestBetween is how long a filled form stays on show before the next job.
	RestBetween time.Duration
	// Allowed says whether a model server's address can be sent résumés.
	Allowed func(address string) bool
	// Client makes the requests to the model server.
	Client *http.Client
	// Gmail reads a member's own Gmail for verification codes; nil when this build has no Google app.
	Gmail *gmail.Client
	// GmailOpen opens Google's Allow page in the member's own Chrome, for connecting.
	GmailOpen func(address string) error
}

const followUpRounds = 3

type loop struct {
	cfg    Config
	tab    playwright.Page
	folder string
}

// Run works through jobs until ctx ends.
func Run(ctx context.Context, cfg Config) {
	if cfg.RestIdle == 0 {
		cfg.RestIdle = 20 * time.Second
	}
	if cfg.RestBetween == 0 {
		cfg.RestBetween = 45 * time.Second
		if brand.IsLocalTest() {
			cfg.RestBetween = 12 * time.Second
		}
	}
	if cfg.Allowed == nil {
		cfg.Allowed = AllowedServer
	}
	if cfg.Client == nil {
		cfg.Client = &http.Client{Timeout: 30 * time.Second}
	}
	// A résumé left from a run that did not end well has no reason to stay.
	os.RemoveAll(cfg.WorkDir)
	l := &loop{cfg: cfg}
	var connecting atomic.Bool
	for {
		l.gmailStep(ctx, &connecting)
		rest := l.step(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(rest):
		}
	}
}

// AllowedServer says whether browsers may send a résumé to an address, whatever KIASA's
// database says: only a tunnel with no path. The local test build also accepts this PC.
func AllowedServer(address string) bool {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" {
		return false
	}
	if u.Scheme == "https" && u.Port() == "" && strings.HasSuffix(strings.ToLower(u.Hostname()), ".trycloudflare.com") {
		return true
	}
	return brand.IsLocalTest() && u.Scheme == "http" && u.Hostname() == "127.0.0.1"
}

func (l *loop) say(state, detail string) {
	if l.cfg.Status != nil {
		l.cfg.Status(state, detail)
	}
}

// step does one thing, and says how long to rest afterwards.
func (l *loop) step(ctx context.Context) time.Duration {
	work, err := link.NextJob(ctx, l.cfg.Code())
	if err != nil {
		if ctx.Err() == nil && !errors.Is(err, link.ErrNotConnected) {
			log.Printf("[!] Could not ask KIASA for the next job: %v\n", err)
		}
		return l.cfg.RestIdle
	}
	// Whatever there is to do, an open browser stays connected to the model server.
	if work.ModelServer != "" && l.cfg.Allowed(work.ModelServer) {
		answers.Client{Address: work.ModelServer, Key: l.cfg.Code().Secret, HTTP: l.cfg.Client}.Ping(ctx)
	}
	if work.Job == nil {
		l.sayWhy(work)
		return l.cfg.RestIdle
	}
	if work.Mode != "fill" && work.Mode != "apply" {
		// A newer page asked for more than this version can do.
		l.release(work.Job.ID)
		l.say("waiting", "Please update the KIASA Browser.")
		return l.cfg.RestIdle
	}
	return l.fill(ctx, work)
}

// sayWhy puts the reason there is no job on the Auto apply page.
func (l *loop) sayWhy(work link.Work) {
	switch work.Stop {
	case "limit":
		l.say("waiting", fmt.Sprintf("Reached today's limit: %d applications.", work.AppliedToday))
	case "no_details":
		l.say("waiting", "Save your details on the Auto apply page.")
	case "model_server_off":
		l.say("waiting", "Model server is off.")
	case "waiting_for_resumes":
		l.say("waiting", fmt.Sprintf("Waiting for résumés: %d jobs have none yet.", work.WaitingForResumes))
	default:
		l.say("idle", "")
	}
}

func jobName(job *link.Job) string {
	parts := make([]string, 0, 2)
	if job.Company != "" {
		parts = append(parts, job.Company)
	}
	if job.Title != "" {
		parts = append(parts, job.Title)
	}
	if len(parts) == 0 {
		return "this job"
	}
	return strings.Join(parts, ", ")
}

func firstLine(err error) string {
	line, _, _ := strings.Cut(err.Error(), "\n")
	return line
}

// freshTab closes the last job's form and opens a new tab, keeping any others the member has.
func (l *loop) freshTab() (playwright.Page, error) {
	if l.tab != nil && !l.tab.IsClosed() {
		l.tab.Close()
	}
	l.tab = nil
	if l.folder != "" {
		os.RemoveAll(l.folder)
		l.folder = ""
	}
	tab, err := l.cfg.NewTab()
	if err != nil {
		return nil, err
	}
	l.tab = tab
	return tab, nil
}

// report says what became of a job. Saying so must not fail because the browser is closing.
func (l *loop) report(job, outcome, reason string, asks []answers.Ask) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := link.Report(ctx, l.cfg.Code(), job, outcome, reason, asks); err != nil {
		log.Printf("[!] Could not report a job as %s: %v\n", outcome, err)
	}
}

// release gives a job back untouched, for a reason that says nothing about the job.
func (l *loop) release(job string) { l.report(job, "released", "", nil) }

// stopped says the job ended because the browser or its tab closed, which is no fault of
// the job's.
func (l *loop) stopped(ctx context.Context, tab playwright.Page) bool {
	return ctx.Err() != nil || (tab != nil && tab.IsClosed())
}

func (l *loop) fill(ctx context.Context, work link.Work) time.Duration {
	job := work.Job
	name := jobName(job)

	if !l.cfg.Allowed(work.ModelServer) {
		l.release(job.ID)
		l.say("waiting", "Model server is off.")
		return l.cfg.RestIdle
	}
	server := answers.Client{Address: work.ModelServer, Key: l.cfg.Code().Secret, HTTP: l.cfg.Client}
	if !server.Ready(ctx) {
		l.release(job.ID)
		l.say("waiting", "Model server is off.")
		return l.cfg.RestIdle
	}
	site, ok := siteFor(job.URL)
	if !ok {
		l.report(job.ID, "skipped", "The KIASA Browser cannot apply on this job's site yet.", nil)
		return time.Second
	}

	l.say("working", "Opening: "+name)
	tab, err := l.freshTab()
	if err != nil {
		l.release(job.ID)
		return l.cfg.RestIdle
	}
	failed := func(what string, err error) time.Duration {
		if l.stopped(ctx, tab) {
			l.release(job.ID)
			return l.cfg.RestIdle
		}
		l.report(job.ID, "failed", what+": "+firstLine(err), nil)
		return l.cfg.RestBetween
	}

	frame, err := site.Open(tab, job.URL)
	if errors.Is(err, ats.ErrNoForm) {
		if l.stopped(ctx, tab) {
			l.release(job.ID)
			return l.cfg.RestIdle
		}
		l.report(job.ID, "skipped", "No application form on this page. The job may have closed.", nil)
		return time.Second
	}
	if err != nil {
		return failed("Could not open the form", err)
	}

	l.say("working", "Reading the form: "+name)
	var entries struct {
		Education  []json.RawMessage `json:"education"`
		Experience []json.RawMessage `json:"experience"`
	}
	json.Unmarshal(work.Resume, &entries)
	if err := site.Prepare(frame, len(entries.Education), len(entries.Experience)); err != nil {
		return failed("Could not add room for your history", err)
	}
	scanned, err := site.Scan(frame)
	if err != nil {
		return failed("Could not read the form", err)
	}

	l.folder = filepath.Join(l.cfg.WorkDir, job.ID)
	resume, err := link.Resume(ctx, l.cfg.Code(), job.ID, l.folder)
	if err != nil {
		return failed("Could not get the résumé", err)
	}
	files := map[string]string{"resume": resume}

	var info answers.Info
	if err := json.Unmarshal(work.Details, &info); err != nil {
		return failed("Could not read the saved details", err)
	}
	asked := answers.Request{
		Job:    answers.Job{Company: job.Company, Title: job.Title, Location: job.Location, Description: job.Description},
		Resume: work.Resume,
		Info:   info,
	}

	var asks []answers.Ask
	var problems []ats.Problem
	var stillEmpty []answers.Question
	filled := 0
	batch := scanned
	for round := 0; round <= followUpRounds && len(batch) > 0; round++ {
		asked.Questions = labelled(batch)
		reply, err := server.Ask(ctx, asked, func(now answers.Progress) {
			switch {
			case now.State == answers.StateQueued && now.Position > 0:
				l.say("working", fmt.Sprintf("Waiting for the model, %d ahead: %s", now.Position, name))
			default:
				l.say("working", "The model is answering: "+name)
			}
		})
		if err != nil {
			if !l.stopped(ctx, tab) {
				l.say("waiting", "Model server is off.")
			}
			l.release(job.ID)
			return l.cfg.RestIdle
		}
		if reply.Stop != "" {
			l.report(job.ID, "skipped", reply.Stop, nil)
			return l.cfg.RestBetween
		}
		asks = append(asks, reply.Asks...)
		l.say("working", "Filling the form: "+name)
		gaps, err := site.Fill(frame, reply.Answers, files)
		if err != nil {
			return failed("Could not fill the form", err)
		}
		problems = append(problems, gaps...)
		filled += len(reply.Answers)
		var fresh []answers.Question
		fresh, stillEmpty, err = site.Unanswered(frame)
		if err != nil {
			return failed("Could not read the form back", err)
		}
		batch = fresh
	}
	if l.stopped(ctx, tab) {
		l.release(job.ID)
		return l.cfg.RestIdle
	}

	outcome, reason := judge(asks, problems, stillEmpty, batch, filled)
	if outcome == "failed" && reason == "" {
		reason = "The form could not be completed."
	}
	// In apply mode, a form that filled cleanly is submitted; otherwise it is only filled.
	if outcome == "filled" && work.Mode == "apply" {
		return l.submit(ctx, work, site, frame, filled)
	}
	l.report(job.ID, outcome, reason, asks)
	log.Printf("[+] A job ended as %s after %d answers.\n", outcome, filled)
	if outcome == "waiting" {
		l.say("waiting", "A job needs your answer on the Auto apply page.")
	} else {
		l.say("working", "Filled, not sent: "+name)
	}
	return l.cfg.RestBetween
}

// judge decides what became of a job. Questions only the member can answer come first: until
// they answer, nothing else about the job matters.
func judge(asks []answers.Ask, problems []ats.Problem, stillEmpty, unasked []answers.Question, filled int) (string, string) {
	if len(asks) > 0 {
		return "waiting", plural(len(asks), "question needs", "questions need") + " your answer."
	}
	for _, p := range problems {
		return "failed", p.Label + ": " + p.Why
	}
	for _, q := range stillEmpty {
		if q.Kind != ats.KindFile {
			return "failed", q.Label + ": still empty after filling."
		}
		return "failed", q.Label + ": the file did not attach."
	}
	if len(unasked) > 0 {
		return "failed", "This form kept asking new questions."
	}
	return "filled", plural(filled, "question", "questions") + " answered. Nothing was sent."
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// labelled gives any wordless box its id as a label, so there is something to ask about.
func labelled(list []answers.Question) []answers.Question {
	out := make([]answers.Question, len(list))
	for i, q := range list {
		if q.Label == "" {
			q.Label = q.ID
		}
		out[i] = q
	}
	return out
}
