package lever

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/answers"
	"stealth-app/internal/ats"
)

const postingAt = "https://jobs.lever.co/test/abc123"

func TestIsJobLink(t *testing.T) {
	yes := []string{"https://jobs.lever.co/test/abc123", "https://jobs.eu.lever.co/x/y/apply"}
	no := []string{"https://job-boards.greenhouse.io/test/jobs/1", "https://example.com/lever.co/x", "https://notlever.co.evil.com/x"}
	for _, link := range yes {
		if !IsJobLink(link) {
			t.Errorf("want Lever: %s", link)
		}
	}
	for _, link := range no {
		if IsJobLink(link) {
			t.Errorf("not Lever: %s", link)
		}
	}
}

func TestApplyURL(t *testing.T) {
	cases := map[string]string{
		"https://jobs.lever.co/test/abc123":         "https://jobs.lever.co/test/abc123/apply",
		"https://jobs.lever.co/test/abc123/":        "https://jobs.lever.co/test/abc123/apply",
		"https://jobs.lever.co/test/abc123/apply":   "https://jobs.lever.co/test/abc123/apply",
		"https://jobs.lever.co/test/abc123?src=xyz": "https://jobs.lever.co/test/abc123/apply",
	}
	for in, want := range cases {
		if got := applyURL(in); got != want {
			t.Errorf("applyURL(%q) = %q, want %q", in, got, want)
		}
	}
}

// page opens the Lever stand-in at Lever's real address, with nothing leaving this computer.
func page(t *testing.T) playwright.Page {
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
	browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{Channel: playwright.String("chrome"), Headless: playwright.Bool(true)})
	if err != nil {
		t.Skipf("could not start Chrome: %v", err)
	}
	t.Cleanup(func() { browser.Close() })
	pg, err := browser.NewPage()
	if err != nil {
		t.Fatal(err)
	}
	html, err := os.ReadFile(filepath.Join("testdata", "apply.html"))
	if err != nil {
		t.Fatal(err)
	}
	if err := pg.Route("**/*", func(route playwright.Route) {
		if strings.HasPrefix(route.Request().URL(), "https://jobs.lever.co/") {
			route.Fulfill(playwright.RouteFulfillOptions{ContentType: playwright.String("text/html"), Body: string(html)})
			return
		}
		t.Errorf("the test tried to leave this computer: %s", route.Request().URL())
		route.Abort()
	}); err != nil {
		t.Fatal(err)
	}
	return pg
}

func open(t *testing.T) (ats.Site, playwright.Frame) {
	t.Helper()
	site := New()
	frame, err := site.Open(page(t), postingAt)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return site, frame
}

func TestScan_ReadsEveryKindOfField(t *testing.T) {
	site, frame := open(t)
	qs, err := site.Scan(frame)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]answers.Question{}
	for _, q := range qs {
		byID[q.ID] = q
	}
	want := map[string]string{
		"name": ats.KindText, "email": ats.KindText, "phone": ats.KindText,
		"resume": ats.KindFile, "cards[1a2b][field0]": ats.KindChoice,
		"loc": ats.KindChoice, "int": ats.KindMultiChoice, "why": ats.KindLongText, "consent": ats.KindCheckbox,
	}
	for id, kind := range want {
		q, ok := byID[id]
		if !ok {
			t.Errorf("missing question %q", id)
			continue
		}
		if q.Kind != kind {
			t.Errorf("%q kind = %q, want %q", id, q.Kind, kind)
		}
	}
	if q := byID["cards[1a2b][field0]"]; len(q.Options) != 2 {
		t.Errorf("work-auth options = %v", q.Options)
	}
	if q := byID["loc"]; len(q.Options) != 3 || !q.Required {
		t.Errorf("location = %+v", q)
	}
}

func TestFill_PutsAnswersIn(t *testing.T) {
	site, frame := open(t)
	if _, err := site.Scan(frame); err != nil {
		t.Fatal(err)
	}
	resume := filepath.Join(t.TempDir(), "r.pdf")
	os.WriteFile(resume, []byte("%PDF-1.4 test"), 0o600)
	problems, err := site.Fill(frame, []answers.Answer{
		{ID: "name", Values: []string{"Ana Lee"}},
		{ID: "email", Values: []string{"ana@example.com"}},
		{ID: "cards[1a2b][field0]", Values: []string{"Yes"}},
		{ID: "loc", Values: []string{"Remote"}},
		{ID: "int", Values: []string{"Backend", "Machine learning"}},
		{ID: "consent", Values: []string{"yes"}},
		{ID: "why", Values: []string{"I admire the work."}},
	}, map[string]string{"resume": resume})
	if err != nil {
		t.Fatal(err)
	}
	if len(problems) != 0 {
		t.Fatalf("problems: %+v", problems)
	}
	got, _ := frame.Evaluate(`() => ({
		name: document.getElementById("name").value,
		auth: document.querySelector('[name="cards[1a2b][field0]"]').value,
		remote: document.getElementById("loc_re").checked,
		be: document.getElementById("int_be").checked,
		ml: document.getElementById("int_ml").checked,
		fe: document.getElementById("int_fe").checked,
		consent: document.getElementById("consent").checked,
		attached: document.getElementById("resume").files.length > 0,
	})`)
	m := got.(map[string]any)
	if m["name"] != "Ana Lee" || m["auth"] != "yes" || m["remote"] != true || m["be"] != true || m["ml"] != true || m["consent"] != true {
		t.Errorf("not filled as expected: %+v", m)
	}
	if m["fe"] == true {
		t.Errorf("Frontend should not be ticked")
	}
	if m["attached"] != true {
		t.Errorf("résumé did not attach")
	}
}

func TestSubmit_Confirms(t *testing.T) {
	site, frame := open(t)
	if err := site.Submit(frame); err != nil {
		t.Fatal(err)
	}
	state, _, _, err := site.AwaitOutcome(frame, 10*time.Second)
	if err != nil || state != ats.Confirmed {
		t.Fatalf("state = %q, err = %v", state, err)
	}
}
