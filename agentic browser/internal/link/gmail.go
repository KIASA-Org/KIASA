package link

import "context"

// GmailWant is what the member has asked for about their Gmail, and the address already connected.
type GmailWant struct {
	Connect    bool   `json:"want_connect"`
	Disconnect bool   `json:"want_disconnect"`
	Email      string `json:"email"`
}

// GmailWanted asks KIASA whether the member wants their Gmail connected or disconnected.
func GmailWanted(ctx context.Context, code Code) (GmailWant, error) {
	var want GmailWant
	err := call(ctx, code, "browser_agent_gmail", map[string]any{"agent_key": code.Secret}, &want)
	return want, err
}

// ReportGmail tells KIASA that the member's Gmail is connected (with the address) or disconnected.
// Only the address is sent, never any mail.
func ReportGmail(ctx context.Context, code Code, email string, connected bool) error {
	return call(ctx, code, "browser_agent_gmail_report", map[string]any{
		"agent_key": code.Secret, "email": email, "connected": connected,
	}, nil)
}
