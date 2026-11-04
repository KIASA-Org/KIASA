package greenhouse

import (
	"testing"
	"time"

	"github.com/mxschmitt/playwright-go"
)

func openFilled(t *testing.T) playwright.Frame {
	t.Helper()
	frame, err := Open(openForm(t), formAt)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func TestSubmit_ConfirmsWhenNoCodeIsNeeded(t *testing.T) {
	frame := openFilled(t)
	if _, err := frame.Evaluate("() => { window.__needCode = false; }"); err != nil {
		t.Fatal(err)
	}
	if err := PressSubmit(frame); err != nil {
		t.Fatal(err)
	}
	state, _, _, err := AwaitOutcome(frame, 10*time.Second)
	if err != nil || state != Confirmed {
		t.Fatalf("state = %q, err = %v", state, err)
	}
	sent, _ := frame.Evaluate("() => window.sent")
	if sent != true {
		t.Error("the form should have been sent")
	}
}

func TestSubmit_ReadsACodeFieldThenConfirms(t *testing.T) {
	frame := openFilled(t)
	if err := PressSubmit(frame); err != nil {
		t.Fatal(err)
	}
	state, _, codeField, err := AwaitOutcome(frame, 10*time.Second)
	if err != nil || state != NeedsCode || codeField != "security_code" {
		t.Fatalf("state = %q, field = %q, err = %v", state, codeField, err)
	}
	if err := FillCode(frame, codeField, "246810"); err != nil {
		t.Fatal(err)
	}
	if err := PressSubmit(frame); err != nil {
		t.Fatal(err)
	}
	state, _, _, err = AwaitOutcome(frame, 10*time.Second)
	if err != nil || state != Confirmed {
		t.Fatalf("after the code: state = %q, err = %v", state, err)
	}
}

func TestSubmit_AWrongCodeIsNotTakenAsSent(t *testing.T) {
	frame := openFilled(t)
	PressSubmit(frame)
	_, _, codeField, _ := AwaitOutcome(frame, 10*time.Second)
	FillCode(frame, codeField, "000000")
	PressSubmit(frame)
	state, _, _, err := AwaitOutcome(frame, 4*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	// Still asking for a code, so the application did not go through.
	if state == Confirmed {
		t.Error("a wrong code must not be taken as submitted")
	}
	sent, _ := frame.Evaluate("() => window.sent")
	if sent == true {
		t.Error("the form should not have been sent with a wrong code")
	}
}
