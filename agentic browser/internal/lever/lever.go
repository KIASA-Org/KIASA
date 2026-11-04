// Package lever reads and fills application forms on Lever, the hiring site. Lever uses a
// plain HTML form, so it leans on the shared standard-form reader and only knows how to find
// Lever's apply page and its submit button.
package lever

import (
	"net/url"
	"strings"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/ats"
)

const (
	formSel   = `form[action*="apply"], form.application-form, div.application-form form, form`
	submitSel = `button[data-qa="btn-submit"], button.template-btn-submit, form button[type="submit"], button[type="submit"]`
)

// Lever applies on Lever job postings.
type Lever struct {
	ats.Standard
}

// New makes a Lever site handler for one job.
func New() ats.Site {
	return &Lever{Standard: ats.Standard{SiteName: "Lever", Form: formSel, SubmitSel: submitSel}}
}

// IsJobLink says whether a link is a Lever posting.
func IsJobLink(link string) bool {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "lever.co" || strings.HasSuffix(host, ".lever.co")
}

// Open loads the posting's apply form and returns the frame that holds it.
func (l *Lever) Open(page playwright.Page, link string) (playwright.Frame, error) {
	if _, err := page.Goto(applyURL(link), playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	}); err != nil {
		return nil, err
	}
	form := page.Locator(l.Form).First()
	if err := form.WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateAttached,
		Timeout: playwright.Float(15000),
	}); err != nil {
		return nil, ats.ErrNoForm
	}
	return page.MainFrame(), nil
}

// applyURL turns a posting link into its apply page: Lever serves the form at ".../apply".
func applyURL(link string) string {
	u, err := url.Parse(strings.TrimSpace(link))
	if err != nil {
		return link
	}
	u.RawQuery = ""
	u.Fragment = ""
	path := strings.TrimRight(u.Path, "/")
	if !strings.HasSuffix(path, "/apply") {
		path += "/apply"
	}
	u.Path = path
	return u.String()
}
