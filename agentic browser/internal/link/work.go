package link

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"stealth-app/internal/brand"
)

// Job is a posting KIASA gave this browser to work on.
type Job struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	Title       string `json:"title"`
	Company     string `json:"company"`
	Location    string `json:"location"`
	Description string `json:"description"`
}

// Work is what KIASA says this browser should do next.
type Work struct {
	// Mode is off, fill or apply: what the member or an admin has set.
	Mode string `json:"mode"`
	// ModelServer is where the model server is, when it has been heard from lately.
	ModelServer  string `json:"model_server"`
	AppliedToday int    `json:"applied_today"`
	// Stop says why there is no job: limit, no_details, model_server_off,
	// waiting_for_resumes or no_jobs.
	Stop              string          `json:"stop"`
	WaitingForResumes int             `json:"waiting_for_resumes"`
	Job               *Job            `json:"job"`
	Resume            json.RawMessage `json:"resume"`
	Details           json.RawMessage `json:"details"`
}

// NextJob asks KIASA for the next job. A job it gives is marked as being worked on, so one
// given must always be reported.
func NextJob(ctx context.Context, code Code) (Work, error) {
	var work Work
	err := call(ctx, code, "browser_agent_next_job", map[string]any{"agent_key": code.Secret}, &work)
	return work, err
}

// Report tells KIASA what became of a job: filled, failed, skipped, waiting, or released,
// which gives it back untouched. Only short notes and the questions the member has to
// answer are sent: never a page, and never an answer.
func Report(ctx context.Context, code Code, job, outcome, reason string, asks any) error {
	packed, err := json.Marshal(asks)
	if err != nil {
		return err
	}
	// A list with nothing in it is still a list, however it was made. KIASA refuses anything else.
	if string(packed) == "null" {
		packed = []byte("[]")
	}
	return call(ctx, code, "browser_agent_report", map[string]any{
		"agent_key": code.Secret, "job": job, "outcome": outcome, "reason": reason, "asks": json.RawMessage(packed),
	}, nil)
}

var resumeClient = &http.Client{Timeout: 90 * time.Second}

const resumeLimit = 20 << 20

var unsafeName = regexp.MustCompile(`[^\p{L}\p{N} ._()-]+`)

// Resume downloads the résumé made for a job into the folder, and returns the file's path.
func Resume(ctx context.Context, code Code, job, folder string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(brand.SiteURL, "/")+"/jobs/resume/pdf?job="+url.QueryEscape(job), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+code.Secret)
	res, err := resumeClient.Do(req)
	if err != nil {
		return "", errors.New("could not reach KIASA")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("KIASA answered with status %d", res.StatusCode)
	}
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(folder, resumeName(res.Header.Get("Content-Disposition")))
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", err
	}
	_, err = io.Copy(file, io.LimitReader(res.Body, resumeLimit))
	if closed := file.Close(); err == nil {
		err = closed
	}
	if err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

// resumeName is the file's name as the site gives it, kept to a plain name in the folder.
func resumeName(header string) string {
	const fallback = "Resume.pdf"
	_, params, err := mime.ParseMediaType(header)
	if err != nil || params["filename"] == "" {
		return fallback
	}
	name := strings.ReplaceAll(params["filename"], `\`, "/")
	name = strings.TrimSpace(unsafeName.ReplaceAllString(filepath.Base(filepath.FromSlash(name)), ""))
	if name == "" || strings.HasPrefix(name, ".") || !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		return fallback
	}
	return name
}
