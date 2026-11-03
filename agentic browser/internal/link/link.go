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
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return Code{}, errors.New("This code does not point to KIASA.")
	}
	return Code{URL: strings.TrimRight(in.U, "/"), Key: in.K, Secret: in.S}, nil
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
	body, err := json.Marshal(map[string]any{"agent_key": code.Secret, "info": status})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, code.URL+"/rest/v1/rpc/browser_agent_check_in", bytes.NewReader(body))
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
	reply, _ := io.ReadAll(io.LimitReader(res.Body, 8<<10))
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	if strings.Contains(string(reply), `"28000"`) {
		return ErrNotConnected
	}
	return fmt.Errorf("KIASA answered with status %d", res.StatusCode)
}

// Keep reports status to KIASA every few seconds until ctx ends, and once more
// ("paused") as it ends. current says how the browser is right now. A code KIASA no
// longer accepts stops the reporting and is passed to onRefused.
func Keep(ctx context.Context, code Code, current func() Status, onRefused func(error)) {
	send := func(c context.Context, s Status) bool {
		err := CheckIn(c, code, s)
		if errors.Is(err, ErrNotConnected) {
			if onRefused != nil {
				onRefused(err)
			}
			return false
		}
		return true
	}
	if !send(ctx, current()) {
		return
	}
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			last := current()
			last.State, last.Detail = "paused", "The KIASA Browser was closed."
			c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			send(c, last)
			cancel()
			return
		case <-tick.C:
			if !send(ctx, current()) {
				return
			}
		}
	}
}
