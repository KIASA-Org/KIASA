package gmail

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

// memStore keeps a token in memory.
type memStore struct {
	token Token
	has   bool
	saves int
}

func (m *memStore) Save(t Token) error  { m.token, m.has = t, true; m.saves++; return nil }
func (m *memStore) Load() (Token, bool) { return m.token, m.has }

// fakeGoogle answers like Google, from canned replies keyed by a substring of the address.
type fakeGoogle struct {
	t        *testing.T
	replies  map[string]func() (int, string)
	bearers  []string
	tokenGET int
}

func (g *fakeGoogle) transport(method, address string, headers map[string]string, form map[string]string) (int, []byte, error) {
	if auth := headers["Authorization"]; auth != "" {
		g.bearers = append(g.bearers, strings.TrimPrefix(auth, "Bearer "))
	}
	for key, reply := range g.replies {
		if strings.Contains(address, key) {
			status, body := reply()
			return status, []byte(body), nil
		}
	}
	g.t.Fatalf("fakeGoogle got an unexpected %s %s", method, address)
	return 0, nil, nil
}

func encodeBody(subject, body string) string {
	part := map[string]any{
		"mimeType": "multipart/alternative",
		"headers": []map[string]any{
			{"name": "From", "value": "Greenhouse <no-reply@greenhouse.io>"},
			{"name": "Subject", "value": subject},
		},
		"parts": []any{
			map[string]any{"mimeType": "text/plain", "body": map[string]any{"data": base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte(body))}},
		},
	}
	msg := map[string]any{"internalDate": "9999999999000", "payload": part}
	packed, _ := json.Marshal(msg)
	return string(packed)
}

func newClient(g *fakeGoogle, store *memStore) *Client {
	return New(Config{ClientID: "id", ClientSecret: "secret", Transport: g.transport, Store: store, Now: func() time.Time { return time.Unix(1_000_000, 0) }})
}

func TestAccess_UsesAGoodTokenWithoutRefreshing(t *testing.T) {
	store := &memStore{token: Token{Access: "good", Refresh: "r", ExpiresAt: time.Unix(1_000_000, 0).Add(time.Hour)}, has: true}
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"/profile": func() (int, string) { return 200, `{"emailAddress":"ana@example.com"}` },
	}}
	email, err := newClient(g, store).Profile()
	if err != nil || email != "ana@example.com" {
		t.Fatalf("email = %q, err = %v", email, err)
	}
	if len(g.bearers) != 1 || g.bearers[0] != "good" {
		t.Errorf("used tokens %v", g.bearers)
	}
}

func TestAccess_RefreshesAnExpiredToken(t *testing.T) {
	store := &memStore{token: Token{Access: "old", Refresh: "r", ExpiresAt: time.Unix(1, 0)}, has: true}
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"oauth2.googleapis.com/token": func() (int, string) { return 200, `{"access_token":"fresh","expires_in":3600}` },
		"/profile":                    func() (int, string) { return 200, `{"emailAddress":"ana@example.com"}` },
	}}
	if _, err := newClient(g, store).Profile(); err != nil {
		t.Fatal(err)
	}
	if store.token.Access != "fresh" || store.token.Refresh != "r" {
		t.Errorf("token = %+v (should keep the old refresh token)", store.token)
	}
	if len(g.bearers) != 1 || g.bearers[0] != "fresh" {
		t.Errorf("used tokens %v", g.bearers)
	}
}

func TestAccess_RefreshesOnceOn401(t *testing.T) {
	store := &memStore{token: Token{Access: "stale", Refresh: "r", ExpiresAt: time.Unix(1_000_000, 0).Add(time.Hour)}, has: true}
	first := true
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"oauth2.googleapis.com/token": func() (int, string) { return 200, `{"access_token":"fresh","expires_in":3600}` },
		"/profile": func() (int, string) {
			if first {
				first = false
				return 401, `{"error":{"message":"expired"}}`
			}
			return 200, `{"emailAddress":"ana@example.com"}`
		},
	}}
	if _, err := newClient(g, store).Profile(); err != nil {
		t.Fatal(err)
	}
	if len(g.bearers) != 2 || g.bearers[1] != "fresh" {
		t.Errorf("used tokens %v", g.bearers)
	}
}

func TestRefresh_RevokedMeansNotConnected(t *testing.T) {
	store := &memStore{token: Token{Access: "old", Refresh: "r", ExpiresAt: time.Unix(1, 0)}, has: true}
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"oauth2.googleapis.com/token": func() (int, string) {
			return 400, `{"error":"invalid_grant","error_description":"Token has been expired or revoked."}`
		},
	}}
	if _, err := newClient(g, store).Profile(); !errors.Is(err, ErrNotConnected) {
		t.Errorf("err = %v, want ErrNotConnected", err)
	}
}

func TestFindRecentCode_ReadsACodeFromAMatchingEmail(t *testing.T) {
	store := &memStore{token: Token{Access: "good", Refresh: "r", ExpiresAt: time.Unix(1_000_000, 0).Add(time.Hour)}, has: true}
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"/messages/m1": func() (int, string) {
			return 200, encodeBody("Security code for your application", "Your verification code is 482913.")
		},
		"/messages?": func() (int, string) { return 200, `{"messages":[{"id":"m1"}]}` },
		"/messages":  func() (int, string) { return 200, `{"messages":[{"id":"m1"}]}` },
	}}
	hints := SiteHints("job-boards.greenhouse.io", "EarnIn")
	found, err := newClient(g, store).FindRecentCode(hints, time.Unix(0, 0), nil)
	if err != nil {
		t.Fatal(err)
	}
	if found == nil || found.Code != "482913" || found.MessageID != "m1" {
		t.Fatalf("found = %+v", found)
	}
}

func TestFindRecentCode_SkipsUsedAndTooOld(t *testing.T) {
	store := &memStore{token: Token{Access: "good", Refresh: "r", ExpiresAt: time.Unix(1_000_000, 0).Add(time.Hour)}, has: true}
	old := map[string]any{"internalDate": "1000", "payload": map[string]any{
		"headers": []map[string]any{{"name": "From", "value": "no-reply@greenhouse.io"}, {"name": "Subject", "value": "Security code"}},
		"parts":   []any{map[string]any{"mimeType": "text/plain", "body": map[string]any{"data": base64.URLEncoding.WithPadding(base64.NoPadding).EncodeToString([]byte("Your code is 111111"))}}},
	}}
	oldJSON, _ := json.Marshal(old)
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){
		"/messages/used": func() (int, string) { return 200, encodeBody("Security code", "Your code is 999999") },
		"/messages/old":  func() (int, string) { return 200, string(oldJSON) },
		"/messages":      func() (int, string) { return 200, `{"messages":[{"id":"used"},{"id":"old"}]}` },
	}}
	found, err := newClient(g, store).FindRecentCode(nil, time.Unix(500, 0), map[string]bool{"used": true})
	if err != nil {
		t.Fatal(err)
	}
	if found != nil {
		t.Errorf("found = %+v, want nothing (one used, one too old)", found)
	}
}

func TestNotConnected(t *testing.T) {
	g := &fakeGoogle{t: t, replies: map[string]func() (int, string){}}
	client := newClient(g, &memStore{})
	if client.Connected() {
		t.Error("should not be connected")
	}
	if _, err := client.Profile(); !errors.Is(err, ErrNotConnected) {
		t.Errorf("err = %v", err)
	}
}

func TestSealedFile(t *testing.T) {
	store := SealedFile{Path: t.TempDir() + "/token.bin", Sealer: plainSealer{}}
	if _, ok := store.Load(); ok {
		t.Error("nothing saved yet")
	}
	want := Token{Access: "a", Refresh: "r", ExpiresAt: time.Unix(1_000_000, 0)}
	if err := store.Save(want); err != nil {
		t.Fatal(err)
	}
	got, ok := store.Load()
	if !ok || got.Access != "a" || got.Refresh != "r" {
		t.Fatalf("got %+v, %v", got, ok)
	}
	if err := store.Forget(); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.Load(); ok {
		t.Error("should be gone after Forget")
	}
}

// plainSealer is a no-op sealer for tests; the real one is Windows DPAPI.
type plainSealer struct{}

func (plainSealer) Seal(b []byte) ([]byte, error)   { return append([]byte("sealed:"), b...), nil }
func (plainSealer) Unseal(b []byte) ([]byte, error) { return b[len("sealed:"):], nil }
