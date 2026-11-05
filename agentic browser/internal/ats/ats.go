// Package ats reads and fills job application forms across hiring sites. A Site knows one
// site's forms. The browser has no AI of its own: a Site reads every question a person can
// see and types in the answers it is given; the model server decides the answers. A Site is
// used for one job and remembers what it last read, so filling needs only the answers.
package ats

import (
	"errors"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/answers"
)

// The kinds of question a form can ask. These match the strings the model server expects.
const (
	KindText        = "text"
	KindLongText    = "long_text"
	KindChoice      = "choice"       // pick one of Options
	KindMultiChoice = "multi_choice" // pick any of Options
	KindSearch      = "search"       // type to find a choice, as with a school or a city
	KindCheckbox    = "checkbox"     // one box, as with a consent
	KindFile        = "file"
)

// What pressing submit led to.
const (
	Confirmed    = "confirmed"     // the application went through
	NeedsCode    = "needs_code"    // the form emailed a code and is waiting for it
	Blocked      = "blocked"       // something only a person can do (a reCAPTCHA challenge)
	NotSubmitted = "not_submitted" // still on the form; a field was not accepted
	Unclear      = "unclear"       // it may have gone through, but nothing said so plainly
)

// ErrNoForm means the link does not lead to an application form that can be read here, as
// when a posting has closed or a company uses its own form.
var ErrNoForm = errors.New("no application form on this page")

// Problem is a question that did not end up answered, and why.
type Problem struct {
	ID    string
	Label string
	Why   string
}

// Site reads and fills one hiring site's application form. A Site is for one job: Scan
// records what it found, and Fill and Unanswered build on that.
type Site interface {
	// Name is the site's short name, for the member-facing status.
	Name() string
	// Open loads the job and returns the frame that holds its application form, or ErrNoForm.
	Open(page playwright.Page, link string) (playwright.Frame, error)
	// Prepare adds room for a member's history before scanning (education and jobs). Sites
	// without repeating sections do nothing.
	Prepare(frame playwright.Frame, schools, jobs int) error
	// Scan reads every question a person can see, with each choice's options.
	Scan(frame playwright.Frame) ([]answers.Question, error)
	// Fill types the given answers into the form. It never presses submit.
	Fill(frame playwright.Frame, given []answers.Answer, files map[string]string) ([]Problem, error)
	// Unanswered reads the form again after filling: fresh is questions not seen before (a
	// follow-up an answer revealed), stillEmpty is required questions left empty.
	Unanswered(frame playwright.Frame) (fresh, stillEmpty []answers.Question, err error)
	// Submit presses the form's submit button.
	Submit(frame playwright.Frame) error
	// AwaitOutcome watches the page after submit until it is clear what happened, or time is up.
	AwaitOutcome(frame playwright.Frame, timeout time.Duration) (state, reason, codeField string, err error)
	// FillCode types a verification code into the code field.
	FillCode(frame playwright.Frame, field, code string) error
}
