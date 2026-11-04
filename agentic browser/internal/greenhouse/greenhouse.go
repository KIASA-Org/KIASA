// Package greenhouse reads and fills application forms on Greenhouse, the hiring site.
// The browser has no AI: it reads every question a person can see, and types in the
// answers it is given. This package cannot send an application, because nothing in it
// presses the form's submit button.
package greenhouse

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"
)

//go:embed scan.js
var scanScript string

// The kinds of question a form can ask.
const (
	KindText        = "text"
	KindLongText    = "long_text"
	KindChoice      = "choice"       // pick one of Options
	KindMultiChoice = "multi_choice" // pick any of Options
	KindSearch      = "search"       // type to find a choice, as with a school or a city
	KindCheckbox    = "checkbox"     // one box, as with a consent
	KindFile        = "file"
)

// Question is one thing an application form asks.
type Question struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"`
	Label    string   `json:"label"`
	Required bool     `json:"required"`
	Hint     string   `json:"hint,omitempty"`
	Options  []string `json:"options,omitempty"`
	// Filled says the form already holds an answer to this one.
	Filled bool `json:"filled"`

	dropdown bool
	native   bool
}

// ErrNoForm means the link does not lead to a Greenhouse application form that can be
// read here, as when a posting has closed or a company uses its own form.
var ErrNoForm = errors.New("no Greenhouse application form on this page")

var (
	boardJob    = regexp.MustCompile(`^/([^/]+)/jobs/(\d+)`)
	schoolField = regexp.MustCompile(`^school--\d+$`)
)

// IsJobLink says whether a job link is one this package can work on: a Greenhouse
// address, or a company's own page saying it holds a Greenhouse job (gh_jid).
func IsJobLink(link string) bool {
	u, err := url.Parse(link)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return false
	}
	return isGreenhouseHost(u.Hostname()) || u.Query().Get("gh_jid") != ""
}

func isGreenhouseHost(host string) bool {
	host = strings.ToLower(host)
	return host == "greenhouse.io" || strings.HasSuffix(host, ".greenhouse.io")
}

// FormLink is where a Greenhouse job's form can be opened on its own. A link to a
// company's own page has none that can be told from the address.
func FormLink(link string) (string, bool) {
	u, err := url.Parse(link)
	if err != nil || !isGreenhouseHost(u.Hostname()) {
		return "", false
	}
	query := u.Query()
	if strings.HasPrefix(u.Path, "/embed/job_app") && query.Get("for") != "" && query.Get("token") != "" {
		return formAddress(query.Get("for"), query.Get("token")), true
	}
	if found := boardJob.FindStringSubmatch(u.Path); found != nil {
		return formAddress(found[1], found[2]), true
	}
	return "", false
}

func formAddress(board, job string) string {
	return "https://job-boards.greenhouse.io/embed/job_app?for=" + url.QueryEscape(board) + "&token=" + url.QueryEscape(job)
}

const (
	openTimeout = 60 * time.Second
	readyWait   = 25 * time.Second

	dropdownWait = 3000 // milliseconds
)

// formWait is how long a page gets to show its form, in milliseconds.
var formWait = 30000

const formSelector = "form#application-form, form#application_form"

// Open goes to a job's application form and returns the frame it is in. A company's own
// page that holds the form in a frame is left for the form itself, so that nothing else
// on that page gets in the way.
func Open(page playwright.Page, link string) (playwright.Frame, error) {
	target := link
	if direct, ok := FormLink(link); ok {
		target = direct
	}
	if err := visit(page, target); err != nil {
		return nil, err
	}
	frame, err := findForm(page)
	if err != nil {
		return nil, err
	}
	// The form was in a frame on another site: open that frame's address by itself.
	if frame != page.MainFrame() {
		if err := visit(page, frame.URL()); err != nil {
			return nil, err
		}
		if frame, err = findForm(page); err != nil {
			return nil, err
		}
	}
	// One of a page's scripts can get lost on a slow connection, and then it never comes
	// alive however long it is given. Loading it again usually settles that.
	if err := waitUntilLive(frame); err != nil {
		if err := visit(page, frame.URL()); err != nil {
			return nil, err
		}
		if frame, err = findForm(page); err != nil {
			return nil, err
		}
		if err := waitUntilLive(frame); err != nil {
			return nil, err
		}
	}
	return frame, nil
}

// visit waits only for the page to begin arriving: slow pictures and trackers on a job
// page must not count against it. findForm then waits for what is needed.
func visit(page playwright.Page, address string) error {
	var err error
	// A connection that dropped once is common enough to try again before giving up.
	for try := 0; try < 3; try++ {
		_, err = page.Goto(address, playwright.PageGotoOptions{
			Timeout:   playwright.Float(float64(openTimeout.Milliseconds())),
			WaitUntil: playwright.WaitUntilStateCommit,
		})
		if err == nil {
			return nil
		}
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("could not open the job's page: %w", err)
}

func findForm(page playwright.Page) (playwright.Frame, error) {
	deadline := time.Now().Add(time.Duration(formWait) * time.Millisecond)
	for {
		for _, frame := range page.Frames() {
			// Only Greenhouse's own form counts: another form with the same name on a
			// company's page is not one this package understands.
			u, err := url.Parse(frame.URL())
			if err != nil || !isGreenhouseHost(u.Hostname()) {
				continue
			}
			if count, err := frame.Locator(formSelector).Count(); err == nil && count > 0 {
				return frame, nil
			}
		}
		if time.Now().After(deadline) {
			return nil, ErrNoForm
		}
		time.Sleep(300 * time.Millisecond)
	}
}

// ErrNotLoaded means the form's scripts did not arrive in time. Reading it anyway would
// see no choices in its dropdowns, so the job is better tried again later.
var ErrNotLoaded = errors.New("the application form did not finish loading")

// waitUntilLive waits for the page's scripts to take over the form. Until then its
// dropdowns are only pictures of dropdowns: they do not open. The older kind of form,
// with plain dropdowns, has nothing to wait for.
func waitUntilLive(frame playwright.Frame) error {
	const check = `() => {
		if (!document.querySelector("form#application-form")) return true;
		const el = document.querySelector("form#application-form input");
		return !!el && Object.keys(el).some(key => key.startsWith("__react"));
	}`
	deadline := time.Now().Add(readyWait)
	for time.Now().Before(deadline) {
		if live, err := frame.Evaluate(check); err == nil && live == true {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return ErrNotLoaded
}

// mostEntries is how many schools or jobs one form is given: well above any real résumé.
const mostEntries = 12

// Expand presses a form's "Add another" until it has room for every school and job on the
// résumé. A form with no such section is left as it is. It adds only empty boxes.
func Expand(frame playwright.Frame, schools, jobs int) error {
	if err := expandSection(frame, ".education--container", "schools", min(schools, mostEntries)); err != nil {
		return err
	}
	return expandSection(frame, ".employment--container", "jobs", min(jobs, mostEntries))
}

func expandSection(frame playwright.Frame, section, kind string, want int) error {
	count := func() (int, error) {
		raw, err := frame.Evaluate(sectionCounts)
		if err != nil {
			return 0, err
		}
		counts, _ := raw.(map[string]any)
		switch n := counts[kind].(type) {
		case int:
			return n, nil
		case float64:
			return int(n), nil
		}
		return 0, nil
	}
	have, err := count()
	if err != nil {
		return err
	}
	// A form that does not ask about these has no section to add to.
	if have == 0 {
		return nil
	}
	button := frame.Locator(section + ` button:has-text("Add another")`).Last()
	for have < want {
		if visible, err := button.IsVisible(); err != nil || !visible {
			return nil
		}
		if err := button.Click(playwright.LocatorClickOptions{Timeout: ms(fieldTimeout)}); err != nil {
			return fmt.Errorf("adding a section for another of your %s: %w", kind, err)
		}
		deadline := time.Now().Add(3 * time.Second)
		next := have
		for next == have && time.Now().Before(deadline) {
			time.Sleep(50 * time.Millisecond)
			if next, err = count(); err != nil {
				return err
			}
		}
		if next == have {
			return fmt.Errorf("the form did not add a section for another of your %s", kind)
		}
		have = next
	}
	return nil
}

// sectionCounts says how many schools and jobs a form has boxes for, by how it numbers them.
const sectionCounts = `() => {
	let schools = 0, jobs = 0;
	for (const el of document.querySelectorAll("form#application-form input")) {
		let found = /^(school|degree|discipline|start-month|start-year|end-month|end-year)--(\d+)$/.exec(el.id);
		if (found) schools = Math.max(schools, Number(found[2]) + 1);
		found = /^(company-name|title|start-date-month|start-date-year|end-date-month|end-date-year)-(\d+)$/.exec(el.id);
		if (found) jobs = Math.max(jobs, Number(found[2]) + 1);
	}
	return { schools, jobs };
}`

// Scan reads every question on the form, with the choices of each dropdown. It is safe
// to run again after filling: that finds the questions an answer made appear.
func Scan(frame playwright.Frame) ([]Question, error) {
	found, err := readFields(frame)
	if err != nil {
		return nil, err
	}
	for i := range found {
		if !found[i].dropdown {
			continue
		}
		// A school's list runs to thousands, and opening it shows only the first few: it is
		// found by typing, whatever it shows when opened.
		if schoolField.MatchString(found[i].ID) {
			found[i].Kind = KindSearch
			continue
		}
		options, multi, err := readDropdown(frame, found[i].ID)
		if err != nil {
			return nil, fmt.Errorf("reading the choices of %q: %w", found[i].Label, err)
		}
		found[i].Options = options
		switch {
		case len(options) == 0:
			// Nothing to choose from until something is typed.
			found[i].Kind = KindSearch
		case multi:
			found[i].Kind = KindMultiChoice
		}
	}
	return found, nil
}

func readFields(frame playwright.Frame) ([]Question, error) {
	raw, err := frame.Evaluate(scanScript)
	if err != nil {
		return nil, fmt.Errorf("reading the form: %w", err)
	}
	if raw == nil {
		return nil, ErrNoForm
	}
	packed, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var fields []struct {
		Question
		Dropdown bool `json:"dropdown"`
		Native   bool `json:"native"`
	}
	if err := json.Unmarshal(packed, &fields); err != nil {
		return nil, err
	}
	out := make([]Question, len(fields))
	for i, field := range fields {
		out[i] = field.Question
		out[i].dropdown, out[i].native = field.Dropdown, field.Native
	}
	return out, nil
}

func byID(id string) string { return `[id="` + quoted(id) + `"]` }

func byName(name string) string { return `input[name="` + quoted(name) + `"]` }

func quoted(text string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(text)
}

func listOf(id string) string { return byID("react-select-" + id + "-listbox") }

// readDropdown opens a dropdown, reads its choices and closes it again, changing nothing.
func readDropdown(frame playwright.Frame, id string) ([]string, bool, error) {
	input := frame.Locator(byID(id))
	if err := input.Focus(playwright.LocatorFocusOptions{Timeout: playwright.Float(5000)}); err != nil {
		return nil, false, err
	}
	keyboard := frame.Page().Keyboard()
	defer keyboard.Press("Escape")
	if err := keyboard.Press("ArrowDown"); err != nil {
		return nil, false, err
	}
	list := frame.Locator(listOf(id))
	// Some dropdowns fetch their choices when opened, and one that needs something typed
	// first never shows any, so the wait for a list has to be a short one.
	if err := list.Locator("[role=option]").First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: playwright.Float(dropdownWait),
	}); err != nil {
		return nil, false, nil
	}
	options, err := list.Locator("[role=option]").AllInnerTexts()
	if err != nil {
		return nil, false, err
	}
	for i := range options {
		options[i] = strings.Join(strings.Fields(options[i]), " ")
	}
	multi, _ := list.GetAttribute("aria-multiselectable")
	return options, multi == "true", nil
}
