package gmail

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func TestWatch_WaitsForAFreshCodeAndUsesEachOnce(t *testing.T) {
	pollEvery = time.Millisecond
	store := &memStore{token: Token{Access: "good", Refresh: "r", ExpiresAt: time.Now().Add(time.Hour)}, has: true}
	// The inbox gains a code only after the first few checks.
	tries := 0
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"/messages/m1": func() (int, string) { return 200, encodeBody("Security code", "Your code is 246810.") },
		"/messages": func() (int, string) {
			tries++
			if tries < 3 {
				return 200, `{"messages":[]}`
			}
			return 200, `{"messages":[{"id":"m1"}]}`
		},
	}}
	client := New(Config{ClientID: "id", ClientSecret: "s", Transport: g.transport, Store: store, Now: time.Now})
	watch := client.WatchFor("job-boards.greenhouse.io", "Acme")

	found, err := watch.WaitForCode(context.Background(), 5*time.Second)
	if err != nil || found == nil || found.Code != "246810" {
		t.Fatalf("found = %+v, err = %v", found, err)
	}
	// The same code is not taken again.
	again, err := watch.WaitForCode(context.Background(), 200*time.Millisecond)
	if err != nil || again != nil {
		t.Errorf("a used code should not come back: %+v, %v", again, err)
	}
}

func TestWatch_IgnoresMailFromBeforeItStarted(t *testing.T) {
	pollEvery = time.Millisecond
	store := &memStore{token: Token{Access: "good", Refresh: "r", ExpiresAt: time.Now().Add(time.Hour)}, has: true}
	old := map[string]any{"internalDate": "1000", "payload": map[string]any{
		"headers": []map[string]any{{"name": "From", "value": "no-reply@greenhouse.io"}, {"name": "Subject", "value": "Security code"}},
		"parts":   []any{map[string]any{"mimeType": "text/plain", "body": map[string]any{"data": base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("Your code is 135790"))}}},
	}}
	oldJSON, _ := json.Marshal(old)
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"/messages/old": func() (int, string) { return 200, string(oldJSON) },
		"/messages":     func() (int, string) { return 200, `{"messages":[{"id":"old"}]}` },
	}}
	client := New(Config{ClientID: "id", ClientSecret: "s", Transport: g.transport, Store: store, Now: func() time.Time { return time.UnixMilli(1_000_000) }})
	watch := client.WatchFor("greenhouse.io", "Acme")
	found, err := watch.WaitForCode(context.Background(), 100*time.Millisecond)
	if err != nil || found != nil {
		t.Errorf("a code from before the watch began should be ignored: %+v, %v", found, err)
	}
}

func TestWatch_StopsIfGmailDisconnects(t *testing.T) {
	pollEvery = time.Millisecond
	store := &memStore{token: Token{Access: "old", Refresh: "r", ExpiresAt: time.Unix(1, 0)}, has: true}
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"oauth2.googleapis.com/token": func() (int, string) { return 400, `{"error":"invalid_grant"}` },
	}}
	client := New(Config{ClientID: "id", ClientSecret: "s", Transport: g.transport, Store: store, Now: time.Now})
	watch := client.WatchFor("greenhouse.io", "Acme")
	if _, err := watch.WaitForCode(context.Background(), time.Second); err != ErrNotConnected {
		t.Errorf("err = %v, want ErrNotConnected", err)
	}
}
