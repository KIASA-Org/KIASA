package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/answers"
	"stealth-app/internal/brand"
	"stealth-app/internal/greenhouse"
	"stealth-app/internal/link"
)

func TestAllowedServer(t *testing.T) {
	cases := map[string]bool{
		"https://calm-river-12.trycloudflare.com":     true,
		"https://calm-river-12.trycloudflare.com/":    true,
		"http://calm-river-12.trycloudflare.com":      false,
		"https://evil.example":                        false,
		"https://trycloudflare.com.evil.example":      false,
		"https://calm.trycloudflare.com.evil.example": false,
		"https://evil.example/.trycloudflare.com":     false,
		"https://user:pass@calm.trycloudflare.com":    false,
		"https://calm.trycloudflare.com:8443":         false,
		"https://calm.trycloudflare.com/steal":        false,
		"http://127.0.0.1:8787":                       false,
		"":                                            false,
	}
	for address, want := range cases {
		if got := AllowedServer(address); got != want {
			t.Errorf("AllowedServer(%q) = %v, want %v", address, got, want)
		}
	}
}

func TestAllowedServer_ThisPCOnlyInTheLocalTestBuild(t *testing.T) {
	saved := brand.LocalTest
	brand.LocalTest = "on"
	defer func() { brand.LocalTest = saved }()
	if !AllowedServer("http://127.0.0.1:8787") {
		t.Error("the local test build should accept this PC")
	}
	if AllowedServer("http://10.0.0.5:8787") || AllowedServer("http://127.0.0.1.evil.example:8787") {
		t.Error("nothing else should be accepted, even there")
	}
}

func TestJudge(t *testing.T) {
	ask := []answers.Ask{{ID: "a", Label: "A"}}
	problem := []greenhouse.Problem{{ID: "b", Label: "Phone", Why: "too long"}}
	empty := []greenhouse.Question{{ID: "c", Label: "Why?", Kind: greenhouse.KindLongText}}
	emptyFile := []greenhouse.Question{{ID: "resume", Label: "Resume/CV", Kind: greenhouse.KindFile}}
	cases := []struct {
		name            string
		asks            []answers.Ask
		problems        []greenhouse.Problem
		stillEmpty      []greenhouse.Question
		unasked         []greenhouse.Question
		outcome, reason string
	}{
		{"all done", nil, nil, nil, nil, "filled", "Nothing was sent"},
		{"member first", ask, problem, empty, nil, "waiting", "1 question needs"},
		{"a problem", nil, problem, nil, nil, "failed", "Phone: too long"},
		{"still empty", nil, nil, empty, nil, "failed", "Why?: still empty"},
		{"no file", nil, nil, emptyFile, nil, "failed", "did not attach"},
		{"never ending", nil, nil, nil, empty, "failed", "kept asking"},
	}
	for _, c := range cases {
		outcome, reason := judge(c.asks, c.problems, c.stillEmpty, c.unasked, 3)
		if outcome != c.outcome || !strings.Contains(reason, c.reason) {
			t.Errorf("%s: %s, %q", c.name, outcome, reason)
		}
	}
}

// standIns is a stand-in for KIASA and the model server, with the real form page in Chrome.
type standIns struct {
	t       *testing.T
	mu      sync.Mutex
	jobs    []map[string]any
	reports []map[string]any
	asked   [][]answers.Question
	asks    []answers.Ask
	stop    string
	pings   []string
	modelUp bool
	kiasa   *httptest.Server
	model   *httptest.Server
}

func (s *standIns) serveKIASA(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case strings.HasSuffix(r.URL.Path, "/browser_agent_next_job"):
		work := map[string]any{"mode": "fill", "model_server": s.model.URL, "stop": "no_jobs"}
		if len(s.jobs) > 0 {
			delete(work, "stop")
			work["job"] = s.jobs[0]
			work["resume"] = map[string]any{"info": map[string]string{"title": "Engineer"}, "education": []any{map[string]string{"school": "A"}, map[string]string{"school": "B"}}, "experience": []any{map[string]string{"company": "C"}, map[string]string{"company": "D"}}}
			work["details"] = map[string]any{"first_name": "Test", "facts": []any{}}
			s.jobs = s.jobs[1:]
		}
		json.NewEncoder(w).Encode(work)
	case strings.HasSuffix(r.URL.Path, "/browser_agent_report"):
		var report map[string]any
		json.NewDecoder(r.Body).Decode(&report)
		// As the real one does, it refuses a report whose questions are not a list.
		if _, isList := report["asks"].([]any); !isList {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.reports = append(s.reports, report)
		w.Write([]byte("null"))
	case r.URL.Path == "/jobs/resume/pdf":
		if r.Header.Get("Authorization") != "Bearer kapp_test" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Disposition", `attachment; filename="Test Person Resume.pdf"`)
		w.Write([]byte("%PDF-1.4 test"))
	default:
		w.Write([]byte("null"))
	}
}

func (s *standIns) serveModel(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case r.URL.Path == "/v1/ping":
		s.pings = append(s.pings, r.Header.Get("Authorization"))
		json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	case r.URL.Path == "/health":
		json.NewEncoder(w).Encode(map[string]bool{"ok": s.modelUp})
	case r.Method == http.MethodPost:
		var req answers.Request
		json.NewDecoder(r.Body).Decode(&req)
		s.asked = append(s.asked, req.Questions)
		reply := &answers.Reply{Answers: []answers.Answer{}, Asks: s.asks, Stop: s.stop}
		for _, q := range req.Questions {
			if value := madeUpAnswer(q); len(value) > 0 {
				reply.Answers = append(reply.Answers, answers.Answer{ID: q.ID, Values: value})
			}
		}
		// Answered at once: a real server gives a ticket to poll, which this is the end of.
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(answers.Progress{Ticket: "t1", State: answers.StateQueued})
		lastReply.Store(reply)
	case r.Method == http.MethodGet:
		json.NewEncoder(w).Encode(answers.Progress{Ticket: "t1", State: answers.StateDone, Reply: lastReply.Load()})
	}
}

var lastReply replyBox

type replyBox struct {
	mu    sync.Mutex
	reply *answers.Reply
}

func (b *replyBox) Store(reply *answers.Reply) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.reply = reply
}

func (b *replyBox) Load() *answers.Reply {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.reply
}

func madeUpAnswer(q answers.Question) []string {
	switch q.Kind {
	case answers.KindFile:
		return nil
	case answers.KindSearch:
		if q.ID == "school--0" {
			return []string{"Massachusetts Institute of Technology"}
		}
		return []string{"New York"}
	case answers.KindChoice, answers.KindMultiChoice:
		return []string{q.Options[0]}
	case answers.KindCheckbox:
		return []string{"yes"}
	}
	if q.ID == "short" {
		return []string{"Short"}
	}
	if q.ID == "phone" {
		return []string{"4155550100"}
	}
	if strings.Contains(q.ID, "year") {
		return []string{"2020"}
	}
	return []string{"An answer."}
}

// start opens Chrome with the stand-in Greenhouse form, and the stand-ins for everything else.
func start(t *testing.T) (*standIns, Config) {
	t.Helper()
	driver := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "driver")
	if _, err := os.Stat(driver); err != nil {
		t.Skip("the browser driver is not on this computer")
	}
	pw, err := playwright.Run(&playwright.RunOptions{DriverDirectory: driver, SkipInstallBrowsers: true})
	if err != nil {
		t.Skipf("could not start the driver: %v", err)
	}
	t.Cleanup(func() { pw.Stop() })
	chrome, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{Channel: playwright.String("chrome"), Headless: playwright.Bool(true)})
	if err != nil {
		t.Skipf("could not start Chrome: %v", err)
	}
	t.Cleanup(func() { chrome.Close() })
	form, err := os.ReadFile(filepath.Join("..", "greenhouse", "testdata", "form.html"))
	if err != nil {
		t.Fatal(err)
	}
	context_, err := chrome.NewContext()
	if err != nil {
		t.Fatal(err)
	}
	if err := context_.Route("**/*", func(route playwright.Route) {
		route.Fulfill(playwright.RouteFulfillOptions{ContentType: playwright.String("text/html"), Body: string(form)})
	}); err != nil {
		t.Fatal(err)
	}

	s := &standIns{t: t, modelUp: true}
	s.kiasa = httptest.NewServer(http.HandlerFunc(s.serveKIASA))
	s.model = httptest.NewServer(http.HandlerFunc(s.serveModel))
	t.Cleanup(s.kiasa.Close)
	t.Cleanup(s.model.Close)

	savedSite := brand.SiteURL
	brand.SiteURL = s.kiasa.URL
	t.Cleanup(func() { brand.SiteURL = savedSite })

	return s, Config{
		Code:        func() link.Code { return link.Code{URL: s.kiasa.URL, Key: "pub", Secret: "kapp_test"} },
		NewTab:      func() (playwright.Page, error) { return context_.NewPage() },
		WorkDir:     filepath.Join(t.TempDir(), "work"),
		RestIdle:    20 * time.Millisecond,
		RestBetween: 20 * time.Millisecond,
		Allowed:     func(string) bool { return true },
		Client:      s.model.Client(),
	}
}

// runOne works until one job has been reported, and returns the report and the job's tab.
func runOne(t *testing.T, s *standIns, cfg Config) (map[string]any, *loop) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	l := &loop{cfg: cfg}
	for {
		l.step(ctx)
		s.mu.Lock()
		count := len(s.reports)
		s.mu.Unlock()
		if count > 0 {
			s.mu.Lock()
			defer s.mu.Unlock()
			return s.reports[0], l
		}
		if ctx.Err() != nil {
			t.Fatal("no job was reported")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func job() map[string]any {
	return map[string]any{"id": "job-1", "url": "https://job-boards.greenhouse.io/test/jobs/1", "title": "Engineer", "company": "Acme", "description": "A job."}
}

func TestLoop_FillsAFormAndNeverSendsIt(t *testing.T) {
	s, cfg := start(t)
	s.jobs = []map[string]any{job()}
	report, l := runOne(t, s, cfg)
	if report["outcome"] != "filled" || !strings.Contains(report["reason"].(string), "Nothing was sent") {
		t.Fatalf("report = %+v", report)
	}
	// Nothing in it may press the form's button.
	sent, err := l.tab.MainFrame().Evaluate("() => window.sent")
	if err != nil || sent != false {
		t.Errorf("the form was sent: %v, %v", sent, err)
	}
	attached, err := l.tab.Locator("#resume").Evaluate("el => el.files.length ? el.files[0].name : ''", nil)
	if err != nil || attached != "Test Person Resume.pdf" {
		t.Errorf("attached %v (%v), want the résumé under its own name", attached, err)
	}
	// The question an answer made appear is asked for too.
	if len(s.asked) != 2 || len(s.asked[1]) != 1 || s.asked[1][0].ID != "question_9" {
		t.Errorf("asked = %+v, want a second round for the follow-up", s.asked)
	}
	// Every school and job on the résumé gets its own set of boxes.
	first := map[string]bool{}
	for _, q := range s.asked[0] {
		first[q.ID] = true
	}
	for _, id := range []string{"degree--1", "start-year--1", "company-name-1", "current-role-1_1"} {
		if !first[id] {
			t.Errorf("%s was not asked: Add another should have been pressed", id)
		}
	}
	for _, q := range s.asked[0] {
		if q.ID == "trap" || strings.Contains(q.Label, "banana") {
			t.Error("a question hidden from people was sent to the model")
		}
	}
}

func TestLoop_WaitsWhenOnlyTheMemberCanAnswer(t *testing.T) {
	s, cfg := start(t)
	s.jobs = []map[string]any{job()}
	s.asks = []answers.Ask{{ID: "question_7[]_1", Label: "I confirm", Why: "yours"}}
	report, _ := runOne(t, s, cfg)
	if report["outcome"] != "waiting" {
		t.Fatalf("report = %+v", report)
	}
	asks, _ := report["asks"].([]any)
	if len(asks) == 0 {
		t.Errorf("the question should go with the report: %+v", report)
	}
}

func TestLoop_SkipsAFormTheServerSaysToLeave(t *testing.T) {
	s, cfg := start(t)
	s.jobs = []map[string]any{job()}
	s.stop = "This form checks whether a person is filling it in."
	report, l := runOne(t, s, cfg)
	if report["outcome"] != "skipped" || report["reason"] != s.stop {
		t.Fatalf("report = %+v", report)
	}
	filled, err := l.tab.Locator("#first_name").InputValue()
	if err != nil || filled != "" {
		t.Errorf("nothing should have been typed: %q, %v", filled, err)
	}
}

func TestLoop_StaysConnectedEvenWithNothingToDo(t *testing.T) {
	s, cfg := start(t)
	l := &loop{cfg: cfg}
	l.step(context.Background())
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.pings) != 1 || s.pings[0] != "Bearer kapp_test" {
		t.Errorf("pings = %v", s.pings)
	}
}

func TestLoop_DoesNotCheckInWithAnUntrustedServer(t *testing.T) {
	s, cfg := start(t)
	cfg.Allowed = AllowedServer
	l := &loop{cfg: cfg}
	l.step(context.Background())
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.pings) != 0 {
		t.Error("the browser's key should not go to a server that is not trusted")
	}
}

func TestLoop_GivesTheJobBackWhenTheModelIsOff(t *testing.T) {
	s, cfg := start(t)
	s.jobs = []map[string]any{job()}
	s.modelUp = false
	var said string
	cfg.Status = func(_, detail string) { said = detail }
	report, _ := runOne(t, s, cfg)
	if report["outcome"] != "released" {
		t.Fatalf("report = %+v", report)
	}
	if said != "Model server is off." {
		t.Errorf("said %q", said)
	}
}

func TestLoop_GivesTheJobBackForAnUntrustedServer(t *testing.T) {
	s, cfg := start(t)
	s.jobs = []map[string]any{job()}
	cfg.Allowed = AllowedServer // the stand-in's address is on this PC, which is not allowed here
	report, _ := runOne(t, s, cfg)
	if report["outcome"] != "released" {
		t.Fatalf("report = %+v", report)
	}
	if len(s.asked) != 0 {
		t.Error("nothing should be sent to a server that is not trusted")
	}
}

func TestLoop_SkipsAJobThatIsNotOnGreenhouse(t *testing.T) {
	s, cfg := start(t)
	other := job()
	other["url"] = "https://jobs.lever.co/acme/1"
	s.jobs = []map[string]any{other}
	report, _ := runOne(t, s, cfg)
	if report["outcome"] != "skipped" {
		t.Fatalf("report = %+v", report)
	}
}
