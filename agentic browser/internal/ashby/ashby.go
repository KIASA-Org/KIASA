// Package ashby reads and fills application forms on Ashby, the hiring site. Ashby's form is
// a React app: its text and file fields are standard, so it leans on the shared reader, but
// its dropdowns are custom, so it teaches the reader how to read and fill those.
package ashby

import (
	"net/url"
	"strings"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/ats"
)

const (
	// Ashby renders its application inside div#root, not a <form>; the stand-in uses
	// #application-form, so both are accepted.
	formSel   = `#application-form, #root`
	submitSel = `button:has-text("Submit Application"), button[type="submit"]`
)

// Ashby applies on Ashby job postings.
type Ashby struct {
	ats.Standard
}

// New makes an Ashby site handler for one job.
func New() ats.Site {
	a := &Ashby{Standard: ats.Standard{SiteName: "Ashby", Form: formSel, SubmitSel: submitSel}}
	a.Standard.Dropdown = dropdown{}
	return a
}

// IsJobLink says whether a link is an Ashby posting.
func IsJobLink(link string) bool {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "ashbyhq.com" || strings.HasSuffix(host, ".ashbyhq.com")
}

// Open loads the job and brings up its application form. Ashby only mounts the form after a
// client-side "Apply for this Job" from the posting page: a direct load of the .../application
// URL renders nothing, so Open goes to the posting, presses Apply, and waits for the fields.
func (a *Ashby) Open(page playwright.Page, link string) (playwright.Frame, error) {
	visit := func(u string) {
		page.Goto(u, playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateDomcontentloaded, Timeout: playwright.Float(30000)})
	}
	visit(link)
	// A form already on the page (the stand-in, or an already-open one).
	if a.formReady(page, 6000) {
		return page.MainFrame(), nil
	}
	// The form mounts only after Apply on the posting page; a direct .../application is blank.
	if posting := postingURL(link); posting != link {
		visit(posting)
	}
	if clickApply(page) && a.formReady(page, 20000) {
		return page.MainFrame(), nil
	}
	return nil, ats.ErrNoForm
}

// formReady waits for a sign the application form has mounted.
func (a *Ashby) formReady(page playwright.Page, timeout float64) bool {
	anchor := page.Locator(`button:has-text("Submit Application"), input#_systemfield_email, input#_systemfield_name`).First()
	return anchor.WaitFor(playwright.LocatorWaitForOptions{State: playwright.WaitForSelectorStateVisible, Timeout: playwright.Float(timeout)}) == nil
}

// clickApply waits for an "Apply for this Job" button or link to appear (React mounts it a
// moment after the page loads), then presses it.
func clickApply(page playwright.Page) bool {
	apply := page.Locator(`button:has-text("Apply for this Job"), a:has-text("Apply for this Job"), button:has-text("Apply Now"), button:has-text("Apply")`).First()
	if apply.WaitFor(playwright.LocatorWaitForOptions{State: playwright.WaitForSelectorStateVisible, Timeout: playwright.Float(20000)}) != nil {
		return false
	}
	return apply.Click(playwright.LocatorClickOptions{Timeout: playwright.Float(10000)}) == nil
}

// postingURL drops the /application step and any query, to get the posting page.
func postingURL(link string) string {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil {
		return link
	}
	u.RawQuery = ""
	u.Fragment = ""
	u.Path = strings.TrimSuffix(strings.TrimRight(u.Path, "/"), "/application")
	return u.String()
}

// dropdown reads and fills Ashby's React dropdowns, which open a list of options on a key
// press and show the choice in a box of their own.
type dropdown struct{}

func field(id string) string {
	q := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(id)
	return `[id="` + q + `"]`
}

func (dropdown) Options(frame playwright.Frame, id string) ([]string, bool, error) {
	input := frame.Locator(field(id)).First()
	if err := input.Focus(playwright.LocatorFocusOptions{Timeout: playwright.Float(5000)}); err != nil {
		return nil, false, err
	}
	keyboard := frame.Page().Keyboard()
	defer keyboard.Press("Escape")
	if err := keyboard.Press("ArrowDown"); err != nil {
		return nil, false, err
	}
	options := frame.Locator(`[role="option"]`)
	if err := options.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(2500),
	}); err != nil {
		return nil, false, nil // a search box that lists nothing until typed into
	}
	texts, err := options.AllInnerTexts()
	if err != nil {
		return nil, false, err
	}
	multi := false
	if n, _ := frame.Locator(`[role="listbox"][aria-multiselectable="true"]`).Count(); n > 0 {
		multi = true
	}
	return clean(texts), multi, nil
}

func (d dropdown) Choose(frame playwright.Frame, id string, values []string) error {
	input := frame.Locator(field(id)).First()
	keyboard := frame.Page().Keyboard()
	for _, want := range values {
		if strings.TrimSpace(want) == "" {
			continue
		}
		if err := input.Focus(playwright.LocatorFocusOptions{Timeout: playwright.Float(5000)}); err != nil {
			return err
		}
		if err := keyboard.Press("ArrowDown"); err != nil {
			return err
		}
		option := frame.GetByRole(*playwright.AriaRoleOption, playwright.FrameGetByRoleOptions{Name: want, Exact: playwright.Bool(true)})
		if n, _ := option.Count(); n == 0 {
			option = frame.GetByRole(*playwright.AriaRoleOption, playwright.FrameGetByRoleOptions{Name: want})
		}
		if err := option.First().Click(playwright.LocatorClickOptions{Timeout: playwright.Float(5000)}); err != nil {
			_ = keyboard.Press("Escape")
			return err
		}
	}
	return nil
}

func clean(texts []string) []string {
	out := make([]string, 0, len(texts))
	seen := map[string]bool{}
	for _, t := range texts {
		t = strings.Join(strings.Fields(t), " ")
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}
