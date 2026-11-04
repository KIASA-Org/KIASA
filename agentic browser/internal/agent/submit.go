package agent

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/ats"
	"stealth-app/internal/gmail"
	"stealth-app/internal/link"
)

const (
	// confirmWait is how long to watch the page for the result after pressing submit.
	confirmWait = 40 * time.Second
	// codeWait is how long to wait for the verification code email.
	codeWait = 2 * time.Minute
)

// submit sends a form that filled cleanly, in apply mode. It presses submit, reads what happened,
// and if the form emailed a verification code, reads it from the member's Gmail and finishes. It
// marks the job applied only once the page plainly confirms it.
func (l *loop) submit(ctx context.Context, work link.Work, site ats.Site, frame playwright.Frame, filled int) time.Duration {
	job := work.Job
	name := jobName(job)

	// Watch Gmail from BEFORE submit, so a code email sent on submit is caught.
	var watch *gmail.Watch
	if l.cfg.Gmail != nil && l.cfg.Gmail.Connected() {
		watch = l.cfg.Gmail.WatchFor(gmail.SanitizeHost(job.URL), job.Company)
	}

	l.say("working", "Submitting: "+name)
	if err := site.Submit(frame); err != nil {
		return l.submitFailed(ctx, frame, job.ID, "Could not press submit", err)
	}

	for round := 0; round < 2; round++ {
		state, reason, codeField, err := site.AwaitOutcome(frame, confirmWait)
		if err != nil {
			return l.submitFailed(ctx, frame, job.ID, "Could not tell if it was sent", err)
		}
		switch state {
		case ats.Confirmed:
			l.report(job.ID, "applied", fmt.Sprintf("Submitted. %s answered.", plural(filled, "question", "questions")), nil)
			log.Printf("[+] Applied to %s.\n", name)
			l.say("working", "Applied: "+name)
			return l.cfg.RestBetween
		case ats.Blocked:
			l.report(job.ID, "skipped", reason, nil)
			return l.cfg.RestBetween
		case ats.NotSubmitted, ats.Unclear:
			l.report(job.ID, "failed", reason, nil)
			return l.cfg.RestBetween
		case ats.NeedsCode:
			if round > 0 {
				l.report(job.ID, "failed", "The verification code was not accepted.", nil)
				return l.cfg.RestBetween
			}
			if done := l.enterCode(ctx, site, frame, job.ID, name, codeField, watch); done {
				return l.cfg.RestIdle
			}
			// A code was entered and submit pressed again; read the outcome next round.
		}
	}
	l.report(job.ID, "failed", "It could not be confirmed that the application was sent.", nil)
	return l.cfg.RestBetween
}

// enterCode reads the verification code from Gmail and types it, then presses submit again. It
// returns true when it has reported a final state itself (and the loop should stop).
func (l *loop) enterCode(ctx context.Context, site ats.Site, frame playwright.Frame, job, name, codeField string, watch *gmail.Watch) bool {
	if watch == nil {
		l.report(job, "waiting", "This job emailed a code to confirm it is you. Connect your Gmail on the Auto apply page so the agent can read it.", nil)
		l.say("waiting", "Connect your Gmail to finish a job.")
		return true
	}
	l.say("working", "Waiting for the verification code: "+name)
	found, err := watch.WaitForCode(ctx, codeWait)
	if err == gmail.ErrNotConnected {
		l.report(job, "waiting", "Please reconnect your Gmail on the Auto apply page.", nil)
		return true
	}
	if l.stopped(ctx, frame.Page()) {
		l.release(job)
		return true
	}
	if err != nil || found == nil {
		l.report(job, "failed", "The verification code did not arrive in time.", nil)
		return true
	}
	l.say("working", "Entering the code: "+name)
	if err := site.FillCode(frame, codeField, found.Code); err != nil {
		l.report(job, "failed", "Could not enter the code: "+firstLine(err), nil)
		return true
	}
	if err := site.Submit(frame); err != nil {
		l.report(job, "failed", "Could not submit after the code: "+firstLine(err), nil)
		return true
	}
	return false
}

func (l *loop) submitFailed(ctx context.Context, frame playwright.Frame, job, what string, err error) time.Duration {
	if l.stopped(ctx, frame.Page()) {
		l.release(job)
		return l.cfg.RestIdle
	}
	l.report(job, "failed", what+": "+firstLine(err), nil)
	return l.cfg.RestBetween
}
