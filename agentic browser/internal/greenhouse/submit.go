package greenhouse

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/mxschmitt/playwright-go"
)

// What pressing submit led to.
const (
	Confirmed    = "confirmed"     // the application went through
	NeedsCode    = "needs_code"    // the form emailed a code and is waiting for it
	Blocked      = "blocked"       // something only a person can do (a reCAPTCHA challenge)
	NotSubmitted = "not_submitted" // still on the form; a field was not accepted
	Unclear      = "unclear"       // it may have gone through, but nothing said so plainly
)

var submitButton = `form#application-form button[type="submit"], form#application_form button[type="submit"]`

// PressSubmit clicks the form's submit button.
func PressSubmit(frame playwright.Frame) error {
	button := frame.Locator(submitButton).Last()
	if err := button.ScrollIntoViewIfNeeded(playwright.LocatorScrollIntoViewIfNeededOptions{Timeout: ms(fieldTimeout)}); err != nil {
		return err
	}
	return button.Click(playwright.LocatorClickOptions{Timeout: ms(fieldTimeout)})
}

// readOutcome looks at the page and says where the application stands.
const readOutcome = `() => {
  const text = (document.body.innerText || "").toLowerCase();
  if (/(thank you for applying|thanks for applying|application (has been )?submitted|successfully submitted|we('|’)?ve received your application|we have received your application|application complete)/.test(text)) {
    return { state: "confirmed" };
  }
  // A reCAPTCHA the member must tick or solve (the visible checkbox or challenge, not the quiet badge).
  const captcha = [...document.querySelectorAll("iframe")].some(f => {
    const r = f.getBoundingClientRect();
    return /recaptcha\/api2\/(anchor|bframe)|hcaptcha\.com\/(captcha|challenge)/.test(f.src || "") && r.width > 10 && r.height > 10;
  });
  if (captcha) return { state: "blocked", reason: "This job uses a reCAPTCHA that only a person can complete." };
  // A code field that appeared, waiting for the emailed code.
  const codeInput = [...document.querySelectorAll("form input")].find(el => {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0) || el.type === "hidden") return false;
    const near = ((el.labels && el.labels[0] ? el.labels[0].innerText : "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.placeholder || "") + " " + (el.name || "") + " " + (el.id || "")).toLowerCase();
    return /security code|verification code|confirmation code|one.?time|enter the .*code|\bcode\b.*confirm/.test(near);
  });
  if (codeInput && /verification code|security code|sent to|enter the .*code|confirm you/.test(text)) {
    return { state: "needs_code", id: codeInput.id || codeInput.name || "" };
  }
  const form = document.querySelector("form#application-form, form#application_form");
  if (form) {
    // Only a shown error with words in it counts; empty or hidden error placeholders do not.
    const bad = [...form.querySelectorAll("[aria-invalid=\"true\"], .field-error, .error, [class*=error-message]")].find(e => {
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

func lookForOutcome(frame playwright.Frame) (outcome, error) {
	raw, err := frame.Evaluate(readOutcome)
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

// AwaitOutcome watches the page after submit until it is clear what happened, or the time is up. A
// "confirmed", "needs_code" or "blocked" is returned as soon as it is seen; otherwise it waits, and
// at the end reports why the form did not go through, or that it is unclear.
func AwaitOutcome(frame playwright.Frame, timeout time.Duration) (state, reason, codeField string, err error) {
	deadline := time.Now().Add(timeout)
	last := outcome{State: Unclear}
	for time.Now().Before(deadline) {
		out, err := lookForOutcome(frame)
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

// FillCode types the verification code into the code field. A code shown as several single-character
// boxes is handled too, because the characters are typed one at a time and the boxes advance.
func FillCode(frame playwright.Frame, field, code string) error {
	input := frame.Locator(byID(field))
	if n, _ := input.Count(); n == 0 {
		input = frame.Locator(`input[name="` + quoted(field) + `"]`).First()
	}
	if err := input.Focus(playwright.LocatorFocusOptions{Timeout: ms(fieldTimeout)}); err != nil {
		return err
	}
	if err := input.Fill(""); err != nil {
		// A multi-box field may refuse Fill; typing still works.
		_ = err
	}
	if err := input.PressSequentially(code, playwright.LocatorPressSequentiallyOptions{Delay: playwright.Float(60), Timeout: ms(fieldTimeout)}); err != nil {
		return fmt.Errorf("typing the code: %w", err)
	}
	return nil
}
