package gmail

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	authEndpoint  = "https://accounts.google.com/o/oauth2/auth"
	tokenEndpoint = "https://oauth2.googleapis.com/token"
	apiBase       = "https://gmail.googleapis.com/gmail/v1/users/me"
	// readOnlyScope is all this asks for: reading mail. It cannot send, change or delete anything.
	readOnlyScope = "https://www.googleapis.com/auth/gmail.readonly"
)

// ErrNotConnected means the member has not connected their Gmail, or the access is gone (revoked,
// or expired — in Testing mode Google expires it after 7 days).
var ErrNotConnected = errors.New("Gmail is not connected")

// ErrBusy means Google could not be reached just now; the access itself is fine.
var ErrBusy = errors.New("Google could not be reached just now")

// Token is the member's access to their own Gmail, kept sealed on their PC.
type Token struct {
	Access    string    `json:"access_token"`
	Refresh   string    `json:"refresh_token"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Sealer encrypts the token at rest. The browser uses Windows DPAPI, so only this Windows user on
// this PC can read it.
type Sealer interface {
	Seal([]byte) ([]byte, error)
	Unseal([]byte) ([]byte, error)
}

// Store keeps the token.
type Store interface {
	Save(Token) error
	Load() (Token, bool)
}

// SealedFile keeps the token sealed in a file.
type SealedFile struct {
	Path   string
	Sealer Sealer
}

func (s SealedFile) Save(token Token) error {
	data, err := json.Marshal(token)
	if err != nil {
		return err
	}
	sealed, err := s.Sealer.Seal(data)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(s.Path, sealed, 0o600)
}

func (s SealedFile) Load() (Token, bool) {
	sealed, err := os.ReadFile(s.Path)
	if err != nil {
		return Token{}, false
	}
	data, err := s.Sealer.Unseal(sealed)
	if err != nil {
		return Token{}, false
	}
	var token Token
	if json.Unmarshal(data, &token) != nil {
		return Token{}, false
	}
	return token, token.Refresh != "" || token.Access != ""
}

// Forget removes the saved token, for disconnecting.
func (s SealedFile) Forget() error {
	err := os.Remove(s.Path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// Config is what a client needs.
type Config struct {
	ClientID     string
	ClientSecret string
	Transport    Transport
	Store        Store
	Now          func() time.Time
}

// Client reads a member's own Gmail, read-only.
type Client struct {
	cfg Config
}

func New(cfg Config) *Client {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Client{cfg: cfg}
}

// Configured says whether this build has the Google app's client details.
func (c *Client) Configured() bool {
	return c.cfg.ClientID != "" && c.cfg.ClientSecret != "" && c.cfg.Transport != nil
}

// Connected says whether the member has connected their Gmail.
func (c *Client) Connected() bool {
	_, ok := c.cfg.Store.Load()
	return ok
}

// Forget disconnects the member's Gmail by removing the saved access.
func (c *Client) Forget() error {
	if store, ok := c.cfg.Store.(interface{ Forget() error }); ok {
		return store.Forget()
	}
	return c.cfg.Store.Save(Token{})
}

func randomText(bytes int) string {
	buf := make([]byte, bytes)
	if _, err := randRead(buf); err != nil {
		// Only if the system has no randomness, which does not happen in practice.
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// Connect opens Google's "Allow" page with openURL and waits for the member to allow read-only
// Gmail, then keeps the access sealed. It returns the Gmail address that was connected. The sign-in
// uses PKCE and a one-off local page, so the sign-in code never leaves this PC.
func (c *Client) Connect(openURL func(string) error, loginHint string, timeout time.Duration) (string, error) {
	if c.cfg.ClientID == "" {
		return "", errors.New("this build has no Google app set")
	}
	verifier := randomText(48)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	state := randomText(16)

	redirect, wait, stop, err := listenForCode(state)
	if err != nil {
		return "", err
	}
	defer stop()

	params := url.Values{
		"client_id":             {c.cfg.ClientID},
		"redirect_uri":          {redirect},
		"response_type":         {"code"},
		"scope":                 {readOnlyScope},
		"access_type":           {"offline"},
		"prompt":                {"consent"},
		"state":                 {state},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
	}
	if loginHint != "" {
		params.Set("login_hint", loginHint)
	}
	if err := openURL(authEndpoint + "?" + params.Encode()); err != nil {
		return "", fmt.Errorf("could not open Google's permission page: %w", err)
	}
	code, err := wait(timeout)
	if err != nil {
		return "", err
	}

	token, err := c.exchange(code, verifier, redirect)
	if err != nil {
		return "", err
	}
	if err := c.cfg.Store.Save(token); err != nil {
		return "", err
	}
	return c.Profile()
}

func (c *Client) exchange(code, verifier, redirect string) (Token, error) {
	status, body, err := c.cfg.Transport("POST", tokenEndpoint, nil, map[string]string{
		"grant_type":    "authorization_code",
		"code":          code,
		"redirect_uri":  redirect,
		"client_id":     c.cfg.ClientID,
		"client_secret": c.cfg.ClientSecret,
		"code_verifier": verifier,
	})
	if err != nil {
		return Token{}, ErrBusy
	}
	if status != http.StatusOK {
		return Token{}, fmt.Errorf("Google refused the sign-in (%d): %s", status, firstError(body))
	}
	return c.tokenFromReply(body)
}

func (c *Client) tokenFromReply(body []byte) (Token, error) {
	var reply struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
		Expires int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &reply); err != nil || reply.Access == "" {
		return Token{}, errors.New("Google's answer could not be read")
	}
	if reply.Expires == 0 {
		reply.Expires = 3600
	}
	return Token{Access: reply.Access, Refresh: reply.Refresh, ExpiresAt: c.cfg.Now().Add(time.Duration(reply.Expires) * time.Second)}, nil
}

func (c *Client) refresh(token Token) (Token, error) {
	if token.Refresh == "" {
		return Token{}, ErrNotConnected
	}
	status, body, err := c.cfg.Transport("POST", tokenEndpoint, nil, map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": token.Refresh,
		"client_id":     c.cfg.ClientID,
		"client_secret": c.cfg.ClientSecret,
	})
	if err != nil {
		return Token{}, ErrBusy
	}
	if status == http.StatusBadRequest || status == http.StatusUnauthorized {
		// invalid_grant: the access was revoked or has expired (Testing mode's 7-day limit).
		if strings.Contains(string(body), "invalid_grant") {
			return Token{}, ErrNotConnected
		}
		return Token{}, fmt.Errorf("Google refused to refresh the access: %s", firstError(body))
	}
	if status != http.StatusOK {
		return Token{}, ErrBusy
	}
	fresh, err := c.tokenFromReply(body)
	if err != nil {
		return Token{}, err
	}
	// Google may or may not send a new refresh token; keep the old one if not.
	if fresh.Refresh == "" {
		fresh.Refresh = token.Refresh
	}
	if err := c.cfg.Store.Save(fresh); err != nil {
		return Token{}, err
	}
	return fresh, nil
}

// access returns a usable access token, refreshing if it is about to expire.
func (c *Client) access() (Token, error) {
	token, ok := c.cfg.Store.Load()
	if !ok {
		return Token{}, ErrNotConnected
	}
	if token.Access == "" || c.cfg.Now().After(token.ExpiresAt.Add(-time.Minute)) {
		return c.refresh(token)
	}
	return token, nil
}

func (c *Client) get(path string, params url.Values) ([]byte, error) {
	token, err := c.access()
	if err != nil {
		return nil, err
	}
	address := apiBase + "/" + path
	if len(params) > 0 {
		address += "?" + params.Encode()
	}
	status, body, err := c.cfg.Transport("GET", address, map[string]string{"Authorization": "Bearer " + token.Access}, nil)
	if err != nil {
		return nil, ErrBusy
	}
	if status == http.StatusUnauthorized {
		// Refused before its expiry: refresh once and try again.
		if token, err = c.refresh(token); err != nil {
			return nil, err
		}
		status, body, err = c.cfg.Transport("GET", address, map[string]string{"Authorization": "Bearer " + token.Access}, nil)
		if err != nil {
			return nil, ErrBusy
		}
	}
	if status == http.StatusOK {
		return body, nil
	}
	if status == 0 || status == http.StatusTooManyRequests || status >= 500 {
		return nil, ErrBusy
	}
	return nil, fmt.Errorf("Gmail answered %d: %s", status, firstError(body))
}

// Profile returns the connected Gmail address.
func (c *Client) Profile() (string, error) {
	body, err := c.get("profile", nil)
	if err != nil {
		return "", err
	}
	var reply struct {
		Email string `json:"emailAddress"`
	}
	json.Unmarshal(body, &reply)
	return reply.Email, nil
}

func firstError(body []byte) string {
	var reply struct {
		Error json.RawMessage `json:"error"`
		Desc  string          `json:"error_description"`
	}
	json.Unmarshal(body, &reply)
	// The read-only API wraps it: {"error":{"message":"..."}}.
	var obj struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(reply.Error, &obj) == nil && obj.Message != "" {
		return obj.Message
	}
	// The sign-in endpoint sends a plain string: {"error":"invalid_grant"}.
	var text string
	if json.Unmarshal(reply.Error, &text) == nil && text != "" {
		if reply.Desc != "" {
			return text + ": " + reply.Desc
		}
		return text
	}
	if reply.Desc != "" {
		return reply.Desc
	}
	if len(body) > 160 {
		body = body[:160]
	}
	return string(body)
}

var scriptStyle = regexp.MustCompile(`(?is)<script\b.*?</script>|<style\b.*?</style>|<head\b.*?</head>`)
var blockEnd = regexp.MustCompile(`(?i)<br\s*/?>|</(p|div|tr|td|h\d|li)>`)
var anyTag = regexp.MustCompile(`<[^>]+>`)

func htmlToText(markup string) string {
	markup = scriptStyle.ReplaceAllString(markup, " ")
	markup = blockEnd.ReplaceAllString(markup, "\n")
	return html.UnescapeString(anyTag.ReplaceAllString(markup, " "))
}

type message struct {
	id       string
	from     string
	subject  string
	received time.Time
	text     string
}

func header(headers []map[string]any, name string) string {
	for _, h := range headers {
		if strings.EqualFold(fmt.Sprint(h["name"]), name) {
			return fmt.Sprint(h["value"])
		}
	}
	return ""
}

func decodeBody(part map[string]any, out map[string]string) {
	mime, _ := part["mimeType"].(string)
	if body, ok := part["body"].(map[string]any); ok {
		if data, ok := body["data"].(string); ok && (mime == "text/plain" || mime == "text/html") {
			if raw, err := base64.URLEncoding.WithPadding(base64.NoPadding).DecodeString(data); err == nil {
				out[mime] += string(raw)
			}
		}
	}
	if parts, ok := part["parts"].([]any); ok {
		for _, p := range parts {
			if pm, ok := p.(map[string]any); ok {
				decodeBody(pm, out)
			}
		}
	}
}

func (c *Client) readMessage(id string) (message, error) {
	body, err := c.get("messages/"+id, url.Values{"format": {"full"}})
	if err != nil {
		return message{}, err
	}
	var full struct {
		InternalDate string `json:"internalDate"`
		Payload      struct {
			Headers []map[string]any `json:"headers"`
		} `json:"payload"`
	}
	if err := json.Unmarshal(body, &full); err != nil {
		return message{}, err
	}
	var holder struct {
		Payload map[string]any `json:"payload"`
	}
	json.Unmarshal(body, &holder)
	bodies := map[string]string{}
	if holder.Payload != nil {
		decodeBody(holder.Payload, bodies)
	}
	text := bodies["text/plain"]
	if strings.TrimSpace(text) == "" {
		text = htmlToText(bodies["text/html"])
	}
	received := time.Time{}
	if ms, err := strconv.ParseInt(full.InternalDate, 10, 64); err == nil {
		received = time.UnixMilli(ms)
	}
	return message{
		id:       id,
		from:     header(full.Payload.Headers, "From"),
		subject:  header(full.Payload.Headers, "Subject"),
		received: received,
		text:     text,
	}, nil
}

// CodeResult is a code found in the inbox.
type CodeResult struct {
	Code      string
	MessageID string
	From      string
	Subject   string
}

// FindRecentCode looks through the member's mail from the last hour for a verification code that
// belongs to this application and arrived after `since`, skipping any already used. Reads only.
func (c *Client) FindRecentCode(hints []string, since time.Time, used map[string]bool) (*CodeResult, error) {
	return c.search("newer_than:1h", hints, since, used)
}

// LatestCode finds the newest verification code from a hiring system within the last so many hours,
// for trying the connection. Reads only.
func (c *Client) LatestCode(withinHours int) (*CodeResult, error) {
	if withinHours < 1 {
		withinHours = 1
	}
	return c.search(fmt.Sprintf("newer_than:%dh", withinHours), nil, c.cfg.Now().Add(-time.Duration(withinHours)*time.Hour), nil)
}

func (c *Client) search(query string, hints []string, since time.Time, used map[string]bool) (*CodeResult, error) {
	list, err := c.get("messages", url.Values{"q": {query}, "maxResults": {"25"}})
	if err != nil {
		return nil, err
	}
	var listing struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	json.Unmarshal(list, &listing)
	for _, item := range listing.Messages {
		if used[item.ID] {
			continue
		}
		msg, err := c.readMessage(item.ID)
		if err != nil {
			continue
		}
		if !msg.received.IsZero() && msg.received.Before(since) {
			continue
		}
		if !Belongs(hints, msg.from, msg.subject) {
			continue
		}
		if code := FindCode(msg.subject, msg.text); code != "" {
			return &CodeResult{Code: code, MessageID: msg.id, From: msg.from, Subject: msg.subject}, nil
		}
	}
	return nil, nil
}
