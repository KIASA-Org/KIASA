package agent

import (
	"errors"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/answers"
	"stealth-app/internal/ashby"
	"stealth-app/internal/ats"
	"stealth-app/internal/greenhouse"
	"stealth-app/internal/lever"
)

// siteFor picks the handler for a job's application site, or says none fits yet.
func siteFor(link string) (ats.Site, bool) {
	switch {
	case greenhouse.IsJobLink(link):
		return &ghSite{}, true
	case lever.IsJobLink(link):
		return lever.New(), true
	case ashby.IsJobLink(link):
		return ashby.New(), true
	default:
		return nil, false
	}
}

// ghSite adapts the greenhouse package, which has its own form reader, to the Site shape the
// agent now speaks. It keeps greenhouse's React-dropdown and history handling untouched.
type ghSite struct {
	batch []greenhouse.Question
	known map[string]bool
}

func (g *ghSite) Name() string { return "Greenhouse" }

func (g *ghSite) Open(page playwright.Page, link string) (playwright.Frame, error) {
	frame, err := greenhouse.Open(page, link)
	if errors.Is(err, greenhouse.ErrNoForm) {
		return nil, ats.ErrNoForm
	}
	return frame, err
}

func (g *ghSite) Prepare(frame playwright.Frame, schools, jobs int) error {
	return greenhouse.Expand(frame, schools, jobs)
}

func (g *ghSite) Scan(frame playwright.Frame) ([]answers.Question, error) {
	found, err := greenhouse.Scan(frame)
	if err != nil {
		return nil, err
	}
	g.batch = found
	g.known = map[string]bool{}
	return ghQuestions(found), nil
}

func (g *ghSite) Fill(frame playwright.Frame, given []answers.Answer, files map[string]string) ([]ats.Problem, error) {
	for _, q := range g.batch {
		g.known[q.ID] = true
	}
	gh := make([]greenhouse.Answer, len(given))
	for i, a := range given {
		gh[i] = greenhouse.Answer{ID: a.ID, Values: a.Values}
	}
	return ghProblems(greenhouse.Fill(frame, g.batch, gh, files)), nil
}

func (g *ghSite) Unanswered(frame playwright.Frame) (fresh, stillEmpty []answers.Question, err error) {
	f, s, err := greenhouse.Unanswered(frame, g.known)
	if err != nil {
		return nil, nil, err
	}
	g.batch = f
	return ghQuestions(f), ghQuestions(s), nil
}

func (g *ghSite) Submit(frame playwright.Frame) error { return greenhouse.PressSubmit(frame) }

func (g *ghSite) AwaitOutcome(frame playwright.Frame, timeout time.Duration) (state, reason, codeField string, err error) {
	return greenhouse.AwaitOutcome(frame, timeout)
}

func (g *ghSite) FillCode(frame playwright.Frame, field, code string) error {
	return greenhouse.FillCode(frame, field, code)
}

func ghQuestions(list []greenhouse.Question) []answers.Question {
	out := make([]answers.Question, len(list))
	for i, q := range list {
		out[i] = answers.Question{ID: q.ID, Kind: q.Kind, Label: q.Label, Required: q.Required, Hint: q.Hint, Options: q.Options}
	}
	return out
}

func ghProblems(list []greenhouse.Problem) []ats.Problem {
	out := make([]ats.Problem, len(list))
	for i, p := range list {
		out[i] = ats.Problem{ID: p.ID, Label: p.Label, Why: p.Why}
	}
	return out
}
