// Package link is the browser's connection to KIASA: it reads the code a member
// makes on the Auto apply page and checks in with it, so the member and the admins
// can see how this browser is. Only a short working status is ever sent, never a
// page, a screenshot or anything typed.
package link

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"stealth-app/internal/brand"
)

const codePrefix = "KIASA-APP1."

// Code is what a connection code holds: where KIASA's database is, its public key
// (the one every page of the site has) and this browser's own secret.
type Code struct {
	URL    string
	Key    string
	Secret string
}

// ErrNotConnected means KIASA no longer accepts this code (it was replaced, or the
// browser was disconnected on the site).
var ErrNotConnected = errors.New("KIASA no longer accepts this connection code")

// Parse reads a code as the Auto apply page shows it.
func Parse(text string) (Code, error) {
	text = strings.TrimSpace(text)
	packed, ok := strings.CutPrefix(text, codePrefix)
	if !ok {
		return Code{}, errors.New("This is not a KIASA browser code. Make one on the Auto apply page of KIASA and paste it here.")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(packed, "="))
	if err != nil {
		return Code{}, errors.New("This code is damaged. Copy it again from the Auto apply page.")
	}
	var in struct {
		U string `json:"u"`
		K string `json:"k"`
		S string `json:"s"`
	}
	if err := json.Unmarshal(raw, &in); err != nil || in.U == "" || in.K == "" || in.S == "" {
		return Code{}, errors.New("This code is damaged. Copy it again from the Auto apply page.")
	}
	u, err := url.Parse(in.U)
	if err != nil || u.Host == "" || (u.Scheme != "https" && !(brand.IsLocalTest() && u.Scheme == "http" && u.Hostname() == "127.0.0.1")) {
		return Code{}, errors.New("This code does not point to KIASA.")
	}
	return Code{URL: strings.TrimRight(in.U, "/"), Key: in.K, Secret: in.S}, nil
}

// IsAppLink says whether a program argument is a link the Auto apply page opened
// the app with, as in kiasa-browser://start?code=...
func IsAppLink(arg string) bool {
	return strings.HasPrefix(strings.ToLower(arg), brand.AppLinkScheme+":")
}

// FromAppLink returns the code in such a link, or "" when it has none, as when the
// browser is open already and only has to come forward. Any website can open a link
// like this, so a code pointing anywhere but KIASA's own database is refused:
// otherwise a stranger's page could make this browser report to them.
func FromAppLink(arg, databaseHost string) (string, error) {
	u, err := url.Parse(arg)
	if err != nil || !strings.EqualFold(u.Scheme, brand.AppLinkScheme) {
		return "", errors.New("this is not a KIASA Browser link")
	}
	text := u.Query().Get("code")
	if text == "" {
		return "", nil
	}
	code, err := Parse(text)
	if err != nil {
		return "", err
	}
	if to, err := url.Parse(code.URL); err != nil || !strings.EqualFold(to.Host, databaseHost) {
		return "", errors.New("this code does not point to KIASA")
	}
	return strings.TrimSpace(text), nil
}

// Status is how the browser is, as it tells KIASA.
type Status struct {
	// State is idle, working, waiting, paused or error.
	State    string `json:"state"`
	Detail   string `json:"detail,omitempty"`
	Computer string `json:"computer,omitempty"`
	Version  string `json:"version,omitempty"`
}

var client = &http.Client{Timeout: 15 * time.Second}

// CheckIn tells KIASA how the browser is. It returns ErrNotConnected when the code
// is no longer accepted.
func CheckIn(ctx context.Context, code Code, status Status) error {
	return call(ctx, code, "browser_agent_check_in", map[string]any{"agent_key": code.Secret, "info": status}, nil)
}

// call runs one of the browser's functions in KIASA's database, and reads its answer.
func call(ctx context.Context, code Code, function string, args map[string]any, out any) error {
	body, err := json.Marshal(args)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, code.URL+"/rest/v1/rpc/"+function, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", code.Key)
	req.Header.Set("Authorization", "Bearer "+code.Key)
	res, err := client.Do(req)
	if err != nil {
		return errors.New("could not reach KIASA")
	}
	defer res.Body.Close()
	reply, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		if out == nil {
			return nil
		}
		return json.Unmarshal(reply, out)
	}
	if strings.Contains(string(reply), `"28000"`) {
		return ErrNotConnected
	}
	return fmt.Errorf("KIASA answered with status %d", res.StatusCode)
}

// beat is how often the browser checks in.
var beat = 15 * time.Second

// Keep reports status to KIASA every few seconds until ctx ends, and once more as it
// ends: "paused", or the problem it ended on. code and current say which code to use
// and how the browser is right now. When KIASA no longer accepts the code, onRefused
// says whether there is a new one to go on with; if not, the reporting stops.
func Keep(ctx context.Context, code func() Code, current func() Status, onRefused func() bool) {
	send := func(c context.Context, s Status) bool {
		if errors.Is(CheckIn(c, code(), s), ErrNotConnected) {
			return onRefused != nil && onRefused()
		}
		return true
	}
	if !send(ctx, current()) {
		return
	}
	tick := time.NewTicker(beat)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			last := current()
			if last.State != "error" {
				last.State, last.Detail = "paused", "The KIASA Browser was closed."
			}
			c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			CheckIn(c, code(), last)
			cancel()
			return
		case <-tick.C:
			if !send(ctx, current()) {
				return
			}
		}
	}
}
