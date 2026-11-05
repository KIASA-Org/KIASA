package ashby

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

const applicationAt = "https://jobs.ashbyhq.com/test/abc123/application"

func TestIsJobLink(t *testing.T) {
	if !IsJobLink("https://jobs.ashbyhq.com/test/abc123") || IsJobLink("https://jobs.lever.co/x/y") {
		t.Error("IsJobLink is wrong")
	}
}

// page opens the Ashby stand-in at Ashby's real address, with nothing leaving this computer.
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
	html, err := os.ReadFile(filepath.Join("testdata", "application.html"))
	if err != nil {
		t.Fatal(err)
	}
	if err := pg.Route("**/*", func(route playwright.Route) {
		if strings.HasPrefix(route.Request().URL(), "https://jobs.ashbyhq.com/") {
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
	frame, err := site.Open(page(t), applicationAt)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return site, frame
}

func TestScan_ReadsFieldsAndDropdownOptions(t *testing.T) {
	site, frame := open(t)
	qs, err := site.Scan(frame)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]answers.Question{}
	for _, q := range qs {
		byID[q.ID] = q
	}
	if byID["name"].Kind != ats.KindText || byID["resume"].Kind != ats.KindFile || byID["why"].Kind != ats.KindLongText {
		t.Errorf("basic fields wrong: %+v", byID)
	}
	auth := byID["auth"]
	if auth.Kind != ats.KindChoice || !auth.Required || len(auth.Options) != 2 {
		t.Errorf("auth dropdown = %+v", auth)
	}
	hear := byID["hear"]
	if hear.Kind != ats.KindChoice || len(hear.Options) != 3 {
		t.Errorf("hear dropdown = %+v", hear)
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
		{ID: "auth", Values: []string{"Yes"}},
		{ID: "hear", Values: []string{"LinkedIn"}},
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
		auth: (document.querySelector("#auth").closest(".ashby-select").querySelector(".single-value") || {}).textContent || "",
		hear: (document.querySelectorAll(".ashby-select")[1].querySelector(".single-value") || {}).textContent || "",
		why: document.getElementById("why").value,
		attached: document.getElementById("resume").files.length > 0,
	})`)
	m := got.(map[string]any)
	if m["name"] != "Ana Lee" || m["auth"] != "Yes" || m["hear"] != "LinkedIn" || m["why"] != "I admire the work." {
		t.Errorf("not filled as expected: %+v", m)
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
