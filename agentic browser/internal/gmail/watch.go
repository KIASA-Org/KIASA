package gmail

import (
	"context"
	"time"
)

// pollEvery is how often the inbox is checked while waiting for a code.
var pollEvery = 3 * time.Second

// Watch waits for a verification code that arrives after it starts. Start it just BEFORE pressing
// the button that sends the email, so an older code is never taken. Each code is used once.
type Watch struct {
	client *Client
	hints  []string
	since  time.Time
	used   map[string]bool
}

// WatchFor starts watching for a code belonging to the given site. hostAndCompany is the job's host
// and the company, for telling this application's mail from another's.
func (c *Client) WatchFor(host, company string) *Watch {
	return &Watch{
		client: c,
		hints:  SiteHints(host, company),
		// A small allowance for clock differences, as the owner's agent uses.
		since: c.cfg.Now().Add(-20 * time.Second),
		used:  map[string]bool{},
	}
}

// WaitForCode checks the inbox until a matching code arrives, or the timeout passes. A code it
// returns is marked used, so a second call waits for a fresh one.
func (w *Watch) WaitForCode(ctx context.Context, timeout time.Duration) (*CodeResult, error) {
	// The timeout is real wall-clock; cfg.Now() governs only "since" (what counts as fresh), so a
	// test may freeze it without this loop running forever.
	deadline := time.Now().Add(timeout)
	for {
		found, err := w.client.FindRecentCode(w.hints, w.since, w.used)
		if err == ErrNotConnected {
			return nil, err
		}
		if err == nil && found != nil {
			w.used[found.MessageID] = true
			return found, nil
		}
		if !time.Now().Before(deadline) {
			return nil, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(pollEvery):
		}
	}
}
