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
	formSel   = `form#application-form, form[class*="application" i], form`
	submitSel = `button[type="submit"], button[aria-label*="submit" i]`
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

// Open loads the posting, reveals the application form if it is behind an Apply button, and
// returns the frame that holds it.
func (a *Ashby) Open(page playwright.Page, link string) (playwright.Frame, error) {
	if _, err := page.Goto(link, playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	}); err != nil {
		return nil, err
	}
	form := page.Locator(a.Form).First()
	if err := form.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(6000),
	}); err != nil {
		// The form may be behind an "Apply" button.
		apply := page.GetByRole(*playwright.AriaRoleButton, playwright.PageGetByRoleOptions{Name: "Apply"})
		if n, _ := apply.Count(); n > 0 {
			_ = apply.First().Click(playwright.LocatorClickOptions{Timeout: playwright.Float(6000)})
		}
		if err := form.WaitFor(playwright.LocatorWaitForOptions{
			State:   playwright.WaitForSelectorStateVisible,
			Timeout: playwright.Float(12000),
		}); err != nil {
			return nil, ats.ErrNoForm
		}
	}
	return page.MainFrame(), nil
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
