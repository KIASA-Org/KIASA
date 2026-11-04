package ats

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/answers"
)

//go:embed scan.js
var scanScript string

const fieldTimeout = 8 * time.Second

func ms(d time.Duration) *float64 { return playwright.Float(float64(d.Milliseconds())) }

// field is one scanned question with the flags the filler needs.
type field struct {
	ID       string   `json:"id"`
	Kind     string   `json:"kind"`
	Label    string   `json:"label"`
	Required bool     `json:"required"`
	Hint     string   `json:"hint,omitempty"`
	Options  []string `json:"options,omitempty"`
	Filled   bool     `json:"filled"`
	Dropdown bool     `json:"dropdown"`
	Native   bool     `json:"native"`
}

func (f field) question() answers.Question {
	return answers.Question{ID: f.ID, Kind: f.Kind, Label: f.Label, Required: f.Required, Hint: f.Hint, Options: f.Options}
}

// DropdownOps reads and fills a site's own dropdown control (not a native <select>). A site
// with such controls, like Ashby's, sets Standard.Dropdown to one of these.
type DropdownOps interface {
	// Options opens the dropdown, reads its choices and closes it, changing nothing. multi
	// says it takes more than one. No options means it needs typing first (a search).
	Options(frame playwright.Frame, id string) (options []string, multi bool, err error)
	// Choose picks the given values in the dropdown.
	Choose(frame playwright.Frame, id string, values []string) error
}

// Standard reads and fills a standard HTML application form. Lever and other classic sites
// build on it; a site with its own kind of control (a React dropdown, say) sets Dropdown.
// It is used for one job and remembers the last scan.
type Standard struct {
	SiteName  string      // short name for the status line
	Form      string      // CSS selector for the application form
	SubmitSel string      // CSS selector for the submit button
	Dropdown  DropdownOps // how to read and fill this site's own dropdowns, if any

	batch []field
	known map[string]bool
}

func (s *Standard) Name() string { return s.SiteName }

// Prepare does nothing by default; sites with repeating history sections override it.
func (s *Standard) Prepare(frame playwright.Frame, schools, jobs int) error { return nil }

// readFields runs the scanner and parses the result.
func (s *Standard) readFields(frame playwright.Frame) ([]field, error) {
	raw, err := frame.Evaluate(scanScript, s.form())
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
	var fields []field
	if err := json.Unmarshal(packed, &fields); err != nil {
		return nil, err
	}
	return fields, nil
}

func (s *Standard) form() string {
	if s.Form == "" {
		return "form"
	}
	return s.Form
}

// Scan reads every question and remembers it.
func (s *Standard) Scan(frame playwright.Frame) ([]answers.Question, error) {
	found, err := s.readFields(frame)
	if err != nil {
		return nil, err
	}
	if s.Dropdown != nil {
		for i := range found {
			if !found[i].Dropdown {
				continue
			}
			opts, multi, err := s.Dropdown.Options(frame, found[i].ID)
			if err != nil {
				return nil, fmt.Errorf("reading the choices of %q: %w", found[i].Label, err)
			}
			found[i].Options = opts
			switch {
			case len(opts) == 0:
				found[i].Kind = KindSearch // nothing to choose until something is typed
			case multi:
				found[i].Kind = KindMultiChoice
			}
		}
	}
	s.batch = found
	s.known = map[string]bool{}
	out := make([]answers.Question, len(found))
	for i, f := range found {
		out[i] = f.question()
	}
	return out, nil
}

// Fill types the answers into the form, skipping questions already answered.
func (s *Standard) Fill(frame playwright.Frame, given []answers.Answer, files map[string]string) ([]Problem, error) {
	values := make(map[string][]string, len(given))
	for _, a := range given {
		values[a.ID] = a.Values
	}
	var problems []Problem
	for _, f := range s.batch {
		s.known[f.ID] = true
		if f.Filled {
			continue
		}
		vals := values[f.ID]
		if err := s.one(frame, f, vals, files); err != nil {
			problems = append(problems, Problem{ID: f.ID, Label: f.Label, Why: firstLine(err)})
		}
	}
	return problems, nil
}

// one fills a single field.
func (s *Standard) one(frame playwright.Frame, f field, vals []string, files map[string]string) error {
	switch {
	case f.Kind == KindFile:
		path := files[f.ID]
		if path == "" {
			if f.Required {
				return fmt.Errorf("this form requires a file we do not have")
			}
			return nil
		}
		return frame.Locator(byField(f.ID)).First().SetInputFiles(path, playwright.LocatorSetInputFilesOptions{Timeout: ms(fieldTimeout)})
	case len(vals) == 0 || strings.TrimSpace(firstOf(vals)) == "":
		if f.Required {
			return fmt.Errorf("no answer was given")
		}
		return nil
	case f.Dropdown:
		if s.Dropdown == nil {
			return fmt.Errorf("this site's dropdown is not handled yet")
		}
		return s.Dropdown.Choose(frame, f.ID, vals)
	case f.Kind == KindText || f.Kind == KindLongText:
		return frame.Locator(byField(f.ID)).First().Fill(vals[0])
	case f.Kind == KindChoice && f.Native, f.Kind == KindMultiChoice && f.Native:
		return s.selectNative(frame, f, vals)
	case f.Kind == KindCheckbox:
		return s.setBoxes(frame, f, vals)
	case f.Kind == KindChoice || f.Kind == KindMultiChoice:
		return s.setBoxes(frame, f, vals) // radio/checkbox groups
	case f.Kind == KindSearch:
		return fmt.Errorf("this site's search box is not handled yet")
	default:
		return fmt.Errorf("a %s field is not handled yet", f.Kind)
	}
}

// selectNative chooses options in a native <select>.
func (s *Standard) selectNative(frame playwright.Frame, f field, vals []string) error {
	var labels []string
	for _, v := range vals {
		if match := bestOption(f.Options, v); match != "" {
			labels = append(labels, match)
		}
	}
	if len(labels) == 0 {
		return fmt.Errorf("none of the answers match the choices")
	}
	_, err := frame.Locator(byField(f.ID)).First().SelectOption(playwright.SelectOptionValues{Labels: &labels})
	return err
}

// setBoxes ticks the radio or checkbox options whose labels match, through a click so a
// React form notices. For a lone consent box, a yes-like answer ticks it.
func (s *Standard) setBoxes(frame playwright.Frame, f field, vals []string) error {
	arg, _ := json.Marshal(map[string]any{
		"form": s.form(), "id": f.ID, "kind": f.Kind, "values": vals, "options": f.Options,
	})
	raw, err := frame.Evaluate(setBoxesJS, string(arg))
	if err != nil {
		return err
	}
	packed, _ := json.Marshal(raw)
	var res struct {
		Set       int      `json:"set"`
		Unmatched []string `json:"unmatched"`
	}
	json.Unmarshal(packed, &res)
	if res.Set == 0 {
		return fmt.Errorf("none of the answers match the choices")
	}
	return nil
}

const setBoxesJS = `(payload) => {
  const a = JSON.parse(payload);
  const form = document.querySelector(a.form);
  if (!form) return { set: 0, unmatched: a.values };
  const norm = t => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
  const boxes = [...form.querySelectorAll('input[type=checkbox], input[type=radio]')].filter(el => (el.name || el.id) === a.id || el.id === a.id);
  const labelOf = el => {
    const l = el.labels && el.labels.length ? el.labels[0].innerText : "";
    return norm(l || el.getAttribute("aria-label") || el.value);
  };
  const yes = v => /^(y|yes|true|1|i (agree|acknowledge|consent)|agree|acknowledge|accept|confirm)/.test(norm(v));
  let set = 0; const unmatched = [];
  if (a.kind === "checkbox" && boxes.length <= 1) {
    const box = boxes[0];
    if (box && yes(a.values[0] || "yes")) { if (!box.checked) box.click(); set = 1; }
    return { set, unmatched };
  }
  for (const want of a.values) {
    const w = norm(want);
    let hit = boxes.find(el => labelOf(el) === w) || boxes.find(el => labelOf(el).includes(w) || w.includes(labelOf(el)));
    if (hit) { if (!hit.checked) hit.click(); set++; } else unmatched.push(want);
  }
  return { set, unmatched };
}`

// Unanswered reads the form again: fresh is questions not seen before, stillEmpty is
// required questions still empty.
func (s *Standard) Unanswered(frame playwright.Frame) (fresh, stillEmpty []answers.Question, err error) {
	found, err := s.readFields(frame)
	if err != nil {
		return nil, nil, err
	}
	var freshFields []field
	for _, f := range found {
		if !s.known[f.ID] {
			fresh = append(fresh, f.question())
			freshFields = append(freshFields, f)
		}
		if f.Required && !f.Filled {
			stillEmpty = append(stillEmpty, f.question())
		}
	}
	// Carry the fresh ones so a following Fill can answer them.
	s.batch = freshFields
	return fresh, stillEmpty, nil
}

func byField(id string) string {
	q := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(id)
	return `[id="` + q + `"], [name="` + q + `"]`
}

func firstOf(vals []string) string {
	if len(vals) == 0 {
		return ""
	}
	return vals[0]
}

// bestOption finds the choice closest to a wanted value: an exact match, else one that
// contains it or is contained by it.
func bestOption(options []string, want string) string {
	w := strings.ToLower(strings.TrimSpace(want))
	for _, o := range options {
		if strings.ToLower(strings.TrimSpace(o)) == w {
			return o
		}
	}
	for _, o := range options {
		lo := strings.ToLower(strings.TrimSpace(o))
		if strings.Contains(lo, w) || strings.Contains(w, lo) {
			return o
		}
	}
	return ""
}

func firstLine(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return s
}
