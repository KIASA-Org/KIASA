// Package update keeps the KIASA Browser up to date by itself. When it starts, the browser reads
// a small file on KIASA's site that says which version is current. A newer version is downloaded
// and installed before anything else happens.
//
// An update runs on every member's PC with no one asked, so it is only trusted if it is signed
// with the release key, which is kept on the owner's PC and nowhere else. Neither the site nor the
// download can make the browser run anything that key did not sign. Anything that goes wrong
// leaves the browser on the version it has.
package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	manifestLimit = 8 << 10
	setupLimit    = 64 << 20
	// triesLimit is how many times one version is tried before leaving it for a while, so that a
	// release that will not install cannot keep a member from opening their browser.
	triesLimit = 2
	triesReset = 6 * time.Hour
)

// Manifest says which version is current, and where it is. Rollback marks a release put back on
// purpose: only a manifest signed with it may take a browser to an older version, so an old
// manifest served again cannot.
type Manifest struct {
	Version   string `json:"version"`
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	Rollback  bool   `json:"rollback,omitempty"`
	Signature string `json:"signature"`
}

// signed is what the signature covers: every field that decides what runs.
func (m Manifest) signed() []byte {
	return []byte(fmt.Sprintf("KIASA-BROWSER-UPDATE-1\n%s\n%s\n%s\n%t\n", m.Version, m.URL, strings.ToLower(m.SHA256), m.Rollback))
}

// Sign fills in the manifest's signature.
func (m *Manifest) Sign(private ed25519.PrivateKey) {
	m.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(private, m.signed()))
}

// ErrNotSigned means a manifest was not signed with the release key.
var ErrNotSigned = errors.New("this update is not signed with KIASA's release key")

// Verify says whether a manifest was signed with the release key.
func (m Manifest) Verify(publicKey string) error {
	key, err := base64.StdEncoding.DecodeString(publicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return errors.New("this build has no usable release key")
	}
	signature, err := base64.StdEncoding.DecodeString(m.Signature)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(key), m.signed(), signature) {
		return ErrNotSigned
	}
	return nil
}

// Config is what a check needs.
type Config struct {
	ManifestURL string
	PublicKey   string
	Current     string
	// WorkDir holds the download and the count of tries.
	WorkDir string
	// AllowPlainHTTP is for the local test build only.
	AllowPlainHTTP bool
	Client         *http.Client
	Now            func() time.Time
}

func parse(version string) (parts [3]int, ok bool) {
	pieces := strings.Split(strings.TrimSpace(version), ".")
	if len(pieces) != 3 {
		return parts, false
	}
	for i, piece := range pieces {
		n, err := strconv.Atoi(piece)
		if err != nil || n < 0 {
			return parts, false
		}
		parts[i] = n
	}
	return parts, true
}

// Newer says whether a version is newer than another. A version that cannot be read is not.
func Newer(version, than string) bool {
	a, okA := parse(version)
	b, okB := parse(than)
	if !okA || !okB {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

// Enabled says whether this build updates itself. Builds with no version of their own do not.
func (c Config) Enabled() bool {
	_, ok := parse(c.Current)
	return ok && c.PublicKey != "" && c.ManifestURL != ""
}

func (c Config) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c Config) allowedURL(address string) bool {
	u, err := url.Parse(address)
	if err != nil || u.Host == "" || u.User != nil {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	return c.AllowPlainHTTP && u.Scheme == "http" && u.Hostname() == "127.0.0.1"
}

// wanted says whether this manifest should be installed over the version running.
func (c Config) wanted(m Manifest) bool {
	if m.Rollback {
		_, ok := parse(m.Version)
		return ok && strings.TrimSpace(m.Version) != strings.TrimSpace(c.Current)
	}
	return Newer(m.Version, c.Current)
}

// Ready is a verified download, ready to install.
type Ready struct {
	Manifest Manifest
	Setup    string
	config   Config
}

// Find looks for an update and, if there is one, downloads and verifies it. It returns nil with
// no error when there is nothing to do. Whatever it returns, the browser can carry on.
func Find(ctx context.Context, c Config) (*Ready, error) {
	if !c.Enabled() {
		return nil, nil
	}
	if !c.allowedURL(c.ManifestURL) {
		return nil, errors.New("the update address is not a safe one")
	}
	m, err := readManifest(ctx, c)
	if err != nil || m == nil {
		return nil, err
	}
	// The signature first: nothing in an unsigned manifest is acted on, even to compare it.
	if err := m.Verify(c.PublicKey); err != nil {
		return nil, err
	}
	if !c.wanted(*m) {
		return nil, nil
	}
	if !c.allowedURL(m.URL) {
		return nil, errors.New("the update's address is not a safe one")
	}
	if c.triedTooOften(m.Version) {
		return nil, fmt.Errorf("version %s did not install, so it is being left for a while", m.Version)
	}
	setup, err := download(ctx, c, *m)
	if err != nil {
		return nil, err
	}
	return &Ready{Manifest: *m, Setup: setup, config: c}, nil
}

func readManifest(ctx context.Context, c Config) (*Manifest, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.ManifestURL, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.Client.Do(req)
	if err != nil {
		return nil, errors.New("could not reach the update file")
	}
	defer res.Body.Close()
	// No file means no update has been released this way yet.
	if res.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the update file answered with status %d", res.StatusCode)
	}
	var m Manifest
	if err := json.NewDecoder(io.LimitReader(res.Body, manifestLimit)).Decode(&m); err != nil {
		return nil, errors.New("the update file could not be read")
	}
	return &m, nil
}

func download(ctx context.Context, c Config, m Manifest) (string, error) {
	want, err := hex.DecodeString(m.SHA256)
	if err != nil || len(want) != sha256.Size {
		return "", errors.New("the update has no usable checksum")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.URL, nil)
	if err != nil {
		return "", err
	}
	res, err := c.Client.Do(req)
	if err != nil {
		return "", errors.New("could not download the update")
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the update's download answered with status %d", res.StatusCode)
	}
	if err := os.MkdirAll(c.WorkDir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(c.WorkDir, "KIASA-Update-"+safeName(m.Version)+".exe")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(res.Body, setupLimit+1))
	closeErr := file.Close()
	if copyErr == nil {
		copyErr = closeErr
	}
	switch {
	case copyErr != nil:
		os.Remove(path)
		return "", errors.New("the update did not finish downloading")
	case written > setupLimit:
		os.Remove(path)
		return "", errors.New("the update is far larger than it should be")
	case hex.EncodeToString(hash.Sum(nil)) != strings.ToLower(hex.EncodeToString(want)):
		os.Remove(path)
		return "", errors.New("the update's download does not match its signed checksum")
	}
	return path, nil
}

func safeName(version string) string {
	return strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || r == '.' {
			return r
		}
		return -1
	}, version)
}

type attempt struct {
	Version string    `json:"version"`
	Tries   int       `json:"tries"`
	At      time.Time `json:"at"`
}

func (c Config) attemptFile() string { return filepath.Join(c.WorkDir, "attempt.json") }

func (c Config) readAttempt() attempt {
	var last attempt
	if data, err := os.ReadFile(c.attemptFile()); err == nil {
		json.Unmarshal(data, &last)
	}
	return last
}

func (c Config) triedTooOften(version string) bool {
	last := c.readAttempt()
	return last.Version == version && last.Tries >= triesLimit && c.now().Sub(last.At) < triesReset
}

// NoteTry counts an attempt at installing a version, before it is made.
func (c Config) NoteTry(version string) error {
	last := c.readAttempt()
	if last.Version != version || c.now().Sub(last.At) >= triesReset {
		last = attempt{Version: version}
	}
	last.Tries++
	last.At = c.now()
	data, err := json.Marshal(last)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(c.WorkDir, 0o700); err != nil {
		return err
	}
	return os.WriteFile(c.attemptFile(), data, 0o600)
}

// Tidy removes old downloads, once a version is running. Its count of tries stays.
func (c Config) Tidy() {
	found, err := filepath.Glob(filepath.Join(c.WorkDir, "KIASA-Update-*.exe"))
	if err != nil {
		return
	}
	for _, path := range found {
		os.Remove(path)
	}
}
