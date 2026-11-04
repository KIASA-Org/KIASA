package ats

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/mxschmitt/playwright-go"
)

// Submit presses the form's submit button.
func (s *Standard) Submit(frame playwright.Frame) error {
	sel := s.SubmitSel
	if sel == "" {
		sel = s.form() + ` button[type="submit"], ` + s.form() + ` input[type="submit"]`
	}
	button := frame.Locator(sel).Last()
	if err := button.ScrollIntoViewIfNeeded(playwright.LocatorScrollIntoViewIfNeededOptions{Timeout: ms(fieldTimeout)}); err != nil {
		return err
	}
	return button.Click(playwright.LocatorClickOptions{Timeout: ms(fieldTimeout)})
}

// readOutcome looks at the page and says where the application stands. The form selector
// comes in so a still-present form can be told from a confirmation.
const readOutcome = `(selector) => {
  const text = (document.body.innerText || "").toLowerCase();
  if (/(thank you for applying|thanks for applying|application (has been )?submitted|successfully submitted|we('|’)?ve received your application|we have received your application|application complete|your application was sent|submission received)/.test(text)) {
    return { state: "confirmed" };
  }
  const captcha = [...document.querySelectorAll("iframe")].some(f => {
    const r = f.getBoundingClientRect();
    return /recaptcha\/api2\/(anchor|bframe)|hcaptcha\.com\/(captcha|challenge)/.test(f.src || "") && r.width > 10 && r.height > 10;
  });
  if (captcha) return { state: "blocked", reason: "This job uses a reCAPTCHA that only a person can complete." };
  const codeInput = [...document.querySelectorAll("input")].find(el => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || el.type === "hidden") return false;
    const near = ((el.labels && el.labels[0] ? el.labels[0].innerText : "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.name || "") + " " + (el.id || "")).toLowerCase();
    return /security code|verification code|confirmation code|one.?time|enter the .*code|\bcode\b.*confirm/.test(near);
  });
  if (codeInput && /verification code|security code|sent to|enter the .*code|confirm you/.test(text)) {
    return { state: "needs_code", id: codeInput.id || codeInput.name || "" };
  }
  const form = document.querySelector(selector);
  if (form) {
    const bad = [...form.querySelectorAll('[aria-invalid="true"], .field-error, .error, [class*=error-message], [class*=error]')].find(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (e.innerText || "").trim() !== "";
    });
    return { state: "not_submitted", reason: bad ? bad.innerText.replace(/\s+/g, " ").trim().slice(0, 200) : "" };
  }
  return { state: "unclear" };
}`

type outcome struct {
	State  string `json:"state"`
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

func (s *Standard) lookForOutcome(frame playwright.Frame) (outcome, error) {
	raw, err := frame.Evaluate(readOutcome, s.form())
	if err != nil {
		return outcome{}, err
	}
	packed, err := json.Marshal(raw)
	if err != nil {
		return outcome{}, err
	}
	var out outcome
	err = json.Unmarshal(packed, &out)
	return out, err
}

// AwaitOutcome watches the page after submit until it is clear what happened, or time is up.
func (s *Standard) AwaitOutcome(frame playwright.Frame, timeout time.Duration) (state, reason, codeField string, err error) {
	deadline := time.Now().Add(timeout)
	last := outcome{State: Unclear}
	for time.Now().Before(deadline) {
		out, err := s.lookForOutcome(frame)
		if err != nil {
			return "", "", "", err
		}
		switch out.State {
		case Confirmed, Blocked, NeedsCode:
			return out.State, out.Reason, out.ID, nil
		}
		last = out
		time.Sleep(600 * time.Millisecond)
	}
	if last.State == NotSubmitted {
		reason := last.Reason
		if reason == "" {
			reason = "The form did not go through and gave no reason."
		}
		return NotSubmitted, reason, "", nil
	}
	return Unclear, "It could not be confirmed that the application was sent.", "", nil
}

// FillCode types the verification code into the code field, one character at a time so a
// code shown as several boxes advances through them.
func (s *Standard) FillCode(frame playwright.Frame, field, code string) error {
	input := frame.Locator(byField(field)).First()
	if err := input.Focus(playwright.LocatorFocusOptions{Timeout: ms(fieldTimeout)}); err != nil {
		return err
	}
	_ = input.Fill("")
	if err := input.PressSequentially(code, playwright.LocatorPressSequentiallyOptions{Delay: playwright.Float(60), Timeout: ms(fieldTimeout)}); err != nil {
		return fmt.Errorf("typing the code: %w", err)
	}
	return nil
}
