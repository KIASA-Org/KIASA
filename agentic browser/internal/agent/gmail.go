package agent

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	"stealth-app/internal/link"
)

// connectTimeout is how long the member has on Google's Allow page.
const connectTimeout = 5 * time.Minute

// gmailStep honours a member's request to connect or disconnect their Gmail. Connecting opens
// Google's Allow page in the member's own Chrome, which takes a while, so it runs on its own and
// does not hold up applying. The member's mail is never read here; this only sets up the access.
func (l *loop) gmailStep(ctx context.Context, connecting *atomic.Bool) {
	if l.cfg.Gmail == nil || !l.cfg.Gmail.Configured() {
		return
	}
	want, err := link.GmailWanted(ctx, l.cfg.Code())
	if err != nil {
		return
	}
	switch {
	case want.Disconnect:
		if err := l.cfg.Gmail.Forget(); err != nil {
			log.Printf("[!] Could not disconnect Gmail: %v\n", err)
		}
		l.reportGmail("", false)
	case want.Connect && !connecting.Load():
		if l.cfg.Gmail.Connected() {
			// Already connected: say so, which clears the request.
			if email, err := l.cfg.Gmail.Profile(); err == nil {
				l.reportGmail(email, true)
			}
			return
		}
		if !connecting.CompareAndSwap(false, true) {
			return
		}
		go func() {
			defer connecting.Store(false)
			l.say("working", "Connecting your Gmail: follow the Allow page.")
			email, err := l.cfg.Gmail.Connect(l.cfg.GmailOpen, want.Email, connectTimeout)
			if err != nil {
				log.Printf("[!] Gmail was not connected: %v\n", err)
				return
			}
			log.Printf("[+] Gmail connected: %s\n", email)
			l.reportGmail(email, true)
		}()
	}
}

func (l *loop) reportGmail(email string, connected bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := link.ReportGmail(ctx, l.cfg.Code(), email, connected); err != nil {
		log.Printf("[!] Could not tell KIASA about Gmail: %v\n", err)
	}
}
