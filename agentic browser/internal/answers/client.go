package answers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ErrServerOff means the model server is not there to answer, or could not answer just now.
var ErrServerOff = errors.New("the model server is not answering")

const (
	pollEvery = 2 * time.Second
	askLimit  = 15 * time.Minute
)

// Client is the browser's side of the model server.
type Client struct {
	Address string
	Key     string
	HTTP    *http.Client
}

func (c Client) url(path string) string { return strings.TrimRight(c.Address, "/") + path }

func (c Client) send(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		packed, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(packed)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.url(path), reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Key)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.HTTP.Do(req)
}

// Ready says whether the server and its model are up.
func (c Client) Ready(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	res, err := c.send(ctx, http.MethodGet, "/health", nil)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var out struct {
		OK bool `json:"ok"`
	}
	return res.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(res.Body, 4<<10)).Decode(&out) == nil && out.OK
}

// Ping tells the server this browser is here, which is how the admins see it as connected.
func (c Client) Ping(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	res, err := c.send(ctx, http.MethodGet, "/v1/ping", nil)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusOK
}

// Ask sends a job's questions and waits for the answers, saying how it stands as it goes.
// Answers can be a while coming when others are ahead in the queue.
func (c Client) Ask(ctx context.Context, req Request, progress func(Progress)) (*Reply, error) {
	res, err := c.send(ctx, http.MethodPost, "/v1/answers", req)
	if err != nil {
		return nil, ErrServerOff
	}
	var started Progress
	err = json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&started)
	res.Body.Close()
	if err != nil || res.StatusCode != http.StatusAccepted || started.Ticket == "" {
		if res.StatusCode == http.StatusBadRequest || res.StatusCode == http.StatusUnauthorized {
			return nil, fmt.Errorf("the model server refused this request, status %d", res.StatusCode)
		}
		return nil, ErrServerOff
	}
	finished := false
	defer func() {
		if finished {
			return
		}
		// The member stopped, or the browser is closing: the model need not go on.
		stop, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if res, err := c.send(stop, http.MethodDelete, "/v1/answers/"+started.Ticket, nil); err == nil {
			res.Body.Close()
		}
	}()

	deadline := time.Now().Add(askLimit)
	for time.Now().Before(deadline) {
		now, err := c.progress(ctx, started.Ticket)
		if err != nil {
			return nil, err
		}
		if progress != nil {
			progress(*now)
		}
		switch now.State {
		case StateDone:
			finished = true
			if now.Reply == nil {
				return nil, ErrServerOff
			}
			return now.Reply, nil
		case StateFailed:
			finished = true
			return nil, ErrServerOff
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(pollEvery):
		}
	}
	return nil, ErrServerOff
}

func (c Client) progress(ctx context.Context, ticket string) (*Progress, error) {
	res, err := c.send(ctx, http.MethodGet, "/v1/answers/"+ticket, nil)
	if err != nil {
		return nil, ErrServerOff
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		// A server that restarted no longer knows the request.
		return nil, ErrServerOff
	}
	var now Progress
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&now); err != nil {
		return nil, ErrServerOff
	}
	return &now, nil
}
