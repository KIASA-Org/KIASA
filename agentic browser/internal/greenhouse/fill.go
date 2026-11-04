package greenhouse

import (
	"fmt"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"
)

// Answer is the server's reply to one question. No values means it has no answer.
type Answer struct {
	ID string `json:"id"`
	// Values holds the text, or the chosen options. For a search it holds what to look
	// for, best first, as in a school and then "Other".
	Values []string `json:"values,omitempty"`
}

// Problem is a question that did not end up answered, and why.
type Problem struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Why   string `json:"why"`
}

const (
	fieldTimeout  = 8 * time.Second
	searchTimeout = 8 * time.Second
	typingDelay   = 35 // milliseconds between keys in a search box
)

// Fill puts the answers into the form and returns what could not be answered. Only the
// questions that were scanned can be answered: a reply naming anything else is dropped,
// and a reply to a choice must be one of its options. files says which file goes with
// which file question, as in the résumé. Optional questions with no answer stay empty.
// It does not send the form.
func Fill(frame playwright.Frame, questions []Question, answers []Answer, files map[string]string) []Problem {
	given := make(map[string][]string, len(answers))
	for _, answer := range answers {
		given[answer.ID] = answer.Values
	}
	var problems []Problem
	for _, q := range questions {
		if q.Filled {
			continue
		}
		var err error
		values := given[q.ID]
		switch {
		case q.Kind == KindFile:
			path := files[q.ID]
			if path == "" {
				if q.Required {
					err = fmt.Errorf("this form requires a file we do not have")
				}
				break
			}
			err = attach(frame, q, path)
		case len(values) == 0 || strings.TrimSpace(values[0]) == "":
			if q.Required {
				err = fmt.Errorf("the server has no answer to this")
			}
		default:
			err = fillOne(frame, q, values)
		}
		if err != nil {
			problems = append(problems, Problem{ID: q.ID, Label: q.Label, Why: firstLine(err)})
		}
	}
	return stillAsked(frame, problems)
}

// stillAsked drops the problems with questions the form no longer asks: an answer further
// down can take one away, as "Current role" does with a job's end date.
func stillAsked(frame playwright.Frame, problems []Problem) []Problem {
	if len(problems) == 0 {
		return problems
	}
	now, err := readFields(frame)
	if err != nil {
		return problems
	}
	there := make(map[string]bool, len(now))
	for _, q := range now {
		there[q.ID] = true
	}
	kept := problems[:0]
	for _, p := range problems {
		if there[p.ID] {
			kept = append(kept, p)
		}
	}
	return kept
}

func firstLine(err error) string {
	line, _, _ := strings.Cut(err.Error(), "\n")
	return line
}

func fillOne(frame playwright.Frame, q Question, values []string) error {
	switch q.Kind {
	case KindText, KindLongText:
		return fillText(frame, q, values[0])
	case KindCheckbox:
		return fillCheckbox(frame, q, values[0])
	case KindSearch:
		return fillSearch(frame, q, values)
	case KindChoice, KindMultiChoice:
		chosen, err := matchOptions(q, values)
		if err != nil {
			return err
		}
		switch {
		case q.native:
			_, err := frame.Locator(byID(q.ID)).SelectOption(playwright.SelectOptionValues{Labels: &chosen}, playwright.LocatorSelectOptionOptions{Timeout: ms(fieldTimeout)})
			return err
		case q.dropdown:
			for _, option := range chosen {
				if err := pickFromDropdown(frame, q, option); err != nil {
					return err
				}
			}
			return nil
		default:
			return checkOptions(frame, q, chosen)
		}
	}
	return fmt.Errorf("this kind of question is not known: %s", q.Kind)
}

func ms(d time.Duration) *float64 { return playwright.Float(float64(d.Milliseconds())) }

func fillText(frame playwright.Frame, q Question, value string) error {
	input := frame.Locator(byID(q.ID))
	if err := input.Fill(value, playwright.LocatorFillOptions{Timeout: ms(fieldTimeout)}); err != nil {
		return err
	}
	held, err := input.InputValue(playwright.LocatorInputValueOptions{Timeout: ms(fieldTimeout)})
	if err != nil {
		return err
	}
	if held != value && !(isPhone(q) && samePhone(held, value)) {
		return fmt.Errorf("the form did not keep the whole answer, it may be too long")
	}
	return nil
}

// isPhone says a box holds a phone number, which forms write out in their own way as it
// is typed: only its digits have to stay the same.
func isPhone(q Question) bool {
	return q.ID == "phone" || strings.Contains(strings.ToLower(q.Label), "phone")
}

// samePhone says two numbers end alike. The form may have taken a country code off, because
// it has a box of its own for that.
func samePhone(held, value string) bool {
	a, b := digitsOf(held), digitsOf(value)
	if len(a) < 7 || len(b) < 7 {
		return a == b
	}
	return strings.HasSuffix(a, b) || strings.HasSuffix(b, a)
}

func digitsOf(text string) string {
	var digits strings.Builder
	for _, char := range text {
		if char >= '0' && char <= '9' {
			digits.WriteRune(char)
		}
	}
	return digits.String()
}

func fillCheckbox(frame playwright.Frame, q Question, value string) error {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "yes", "true":
		return checkBox(frame.Locator(byID(q.ID)))
	case "no", "false":
		if q.Required {
			return fmt.Errorf("this box must be ticked to apply, and the answer is no")
		}
		return nil
	}
	return fmt.Errorf("a box can only be answered yes or no")
}

// checkBox ticks a box. A styled box can be covered by its own drawing, or be worked by a
// script that wants the click itself, so a tick that does not take is tried the plain way.
func checkBox(box playwright.Locator) error {
	err := box.Check(playwright.LocatorCheckOptions{Timeout: ms(fieldTimeout), Force: playwright.Bool(true)})
	if err == nil {
		return nil
	}
	if checked, stateErr := box.IsChecked(); stateErr == nil && checked {
		return nil
	}
	if _, clickErr := box.Evaluate("el => el.click()", nil); clickErr != nil {
		return err
	}
	if checked, stateErr := box.IsChecked(); stateErr == nil && checked {
		return nil
	}
	return err
}

func normal(text string) string {
	return strings.ToLower(strings.Join(strings.Fields(text), " "))
}

// matchOptions returns the form's own wording of the chosen options, and refuses anything
// the form does not offer.
func matchOptions(q Question, values []string) ([]string, error) {
	out := make([]string, 0, len(values))
	for _, value := range values {
		found := ""
		for _, option := range q.Options {
			if normal(option) == normal(value) {
				found = option
				break
			}
		}
		if found == "" {
			return nil, fmt.Errorf("the answer is not one of this question's choices")
		}
		out = append(out, found)
	}
	if q.Kind == KindChoice && len(out) > 1 {
		return nil, fmt.Errorf("this question takes only one choice")
	}
	return out, nil
}

func checkOptions(frame playwright.Frame, q Question, chosen []string) error {
	boxes := frame.Locator(byName(q.ID))
	for _, option := range chosen {
		index := -1
		for i, label := range q.Options {
			if label == option {
				index = i
				break
			}
		}
		if index < 0 {
			return fmt.Errorf("the answer is not one of this question's choices")
		}
		if err := checkBox(boxes.Nth(index)); err != nil {
			return err
		}
	}
	return nil
}

// openDropdown opens a dropdown and returns its options as they stand.
func openDropdown(frame playwright.Frame, id string) (playwright.Locator, error) {
	input := frame.Locator(byID(id))
	if err := input.Focus(playwright.LocatorFocusOptions{Timeout: ms(fieldTimeout)}); err != nil {
		return nil, err
	}
	if err := frame.Page().Keyboard().Press("ArrowDown"); err != nil {
		return nil, err
	}
	return frame.Locator(listOf(id)).Locator("[role=option]"), nil
}

func pickFromDropdown(frame playwright.Frame, q Question, option string) error {
	err := tryDropdown(frame, q, option)
	if err == nil {
		return nil
	}
	// A menu left open by the last question can sit over this one. Closing it is usually enough.
	frame.Page().Keyboard().Press("Escape")
	return tryDropdown(frame, q, option)
}

func tryDropdown(frame playwright.Frame, q Question, option string) error {
	options, err := openDropdown(frame, q.ID)
	if err != nil {
		return err
	}
	if err := waitForOptions(options, fieldTimeout); err != nil {
		return fmt.Errorf("its choices did not open")
	}
	return clickOption(frame, options, []string{option}, true)
}

// fillSearch types what to look for and takes the best result. Results are never
// guessed at: with nothing close, the box is emptied and the question reported.
func fillSearch(frame playwright.Frame, q Question, wanted []string) error {
	input := frame.Locator(byID(q.ID))
	options := frame.Locator(listOf(q.ID)).Locator("[role=option]")
	for _, value := range wanted {
		if err := input.Fill(""); err != nil {
			return err
		}
		if err := input.PressSequentially(value, playwright.LocatorPressSequentiallyOptions{Delay: playwright.Float(typingDelay), Timeout: ms(searchTimeout)}); err != nil {
			return err
		}
		if err := waitForOptions(options, searchTimeout); err != nil {
			continue
		}
		if err := clickOption(frame, options, []string{value}, false); err == nil {
			return nil
		}
	}
	if err := input.Fill(""); err != nil {
		return err
	}
	frame.Page().Keyboard().Press("Escape")
	return fmt.Errorf("no result matched the answer")
}

func waitForOptions(options playwright.Locator, wait time.Duration) error {
	return options.First().WaitFor(playwright.LocatorWaitForOptions{
		State:   playwright.WaitForSelectorStateVisible,
		Timeout: ms(wait),
	})
}

// clickOption clicks the option that says one of the wanted things. Unless exact is
// asked for, the closest wording counts: the same words, then one starting with them,
// then one containing them.
func clickOption(frame playwright.Frame, options playwright.Locator, wanted []string, exact bool) error {
	texts, err := options.AllInnerTexts()
	if err != nil {
		return err
	}
	for _, value := range wanted {
		want := normal(value)
		index := findOption(texts, want, func(text string) bool { return text == want })
		if index < 0 && !exact {
			index = findOption(texts, want, func(text string) bool { return strings.HasPrefix(text, want) })
		}
		if index < 0 && !exact {
			index = findOption(texts, want, func(text string) bool { return strings.Contains(text, want) })
		}
		if index >= 0 {
			return options.Nth(index).Click(playwright.LocatorClickOptions{Timeout: ms(fieldTimeout)})
		}
	}
	return fmt.Errorf("the answer is not among the results")
}

func findOption(texts []string, want string, matches func(string) bool) int {
	if want == "" {
		return -1
	}
	for i, text := range texts {
		if matches(normal(text)) {
			return i
		}
	}
	return -1
}

func attach(frame playwright.Frame, q Question, path string) error {
	return frame.Locator(byID(q.ID)).SetInputFiles(path, playwright.LocatorSetInputFilesOptions{Timeout: ms(fieldTimeout)})
}

// Unanswered looks at the form again, for what still needs an answer: required questions
// left empty, and new ones an answer made appear. It keeps questions already known to
// have no answer out, so that they are not asked for twice.
func Unanswered(frame playwright.Frame, known map[string]bool) (fresh []Question, stillEmpty []Question, err error) {
	questions, err := Scan(frame)
	if err != nil {
		return nil, nil, err
	}
	for _, q := range questions {
		switch {
		case !known[q.ID]:
			fresh = append(fresh, q)
		case q.Required && !q.Filled:
			stillEmpty = append(stillEmpty, q)
		}
	}
	return fresh, stillEmpty, nil
}
