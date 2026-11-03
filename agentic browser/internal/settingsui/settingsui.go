// Package settingsui is the settings window. It is a small page the browser shows in
// a window of its own, served to it from this computer only.
package settingsui

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	linkpkg "stealth-app/internal/link"
	"stealth-app/internal/settings"
)

// checkIn asks KIASA whether a connection code is accepted; tests replace it.
var checkIn = linkpkg.CheckIn

//go:embed page.html
var pageHTML []byte

//go:embed logo.png
var logoPNG []byte

// CheckProxy tries a proxy and returns the address websites will see through it.
type CheckProxy func(proxyURL string) (address string, err error)

// Options describes one settings window.
type Options struct {
	// BrowserExe is the browser to show the window with.
	BrowserExe string
	// WindowProfile is a folder for the window's own browser profile, kept apart from
	// the profile people browse with.
	WindowProfile string
	// SettingsPath is the settings file.
	SettingsPath string
	// Check tests a proxy for the Test connection button.
	Check CheckProxy
	// Notice is shown when the window opens, as the reason it was opened.
	Notice string
}

// Show opens the settings window and waits for it to close. saved reports whether the
// person saved, as opposed to closing the window.
func Show(opts Options) (saved bool, err error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return false, err
	}
	token, err := newToken()
	if err != nil {
		listener.Close()
		return false, err
	}
	server := newServer(opts.SettingsPath, listener.Addr().String(), token, opts.Check)
	server.notice = opts.Notice
	httpServer := &http.Server{Handler: server, ReadHeaderTimeout: 10 * time.Second}
	go httpServer.Serve(listener)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		httpServer.Shutdown(ctx)
	}()

	cmd := exec.Command(opts.BrowserExe, windowArgs("http://"+listener.Addr().String()+"/"+token+"/", opts.WindowProfile)...)
	if err := cmd.Start(); err != nil {
		return false, err
	}
	closed := make(chan error, 1)
	go func() { closed <- cmd.Wait() }()

	select {
	case <-server.saved:
		// The page closes its window itself. This is for when it does not.
		select {
		case <-closed:
		case <-time.After(1500 * time.Millisecond):
			cmd.Process.Kill()
			<-closed
		}
		return true, nil
	case <-closed:
		return server.wasSaved(), nil
	}
}

// windowArgs starts the browser as a plain small window. It only ever needs this
// computer, so all other names are made to fail: it must not reach the internet
// directly when someone has set a proxy because their real address should stay hidden.
func windowArgs(url, profile string) []string {
	return []string{
		"--app=" + url,
		"--user-data-dir=" + profile,
		"--window-size=600,690",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-sync",
		"--disable-extensions",
		"--no-proxy-server",
		"--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1",
	}
}

func newToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// server answers the page. Only a page opened with the secret address can use it, and
// the checks on Host and Origin stop other websites from reaching it through the
// browser.
type server struct {
	path  string
	addr  string
	token string
	check CheckProxy
	// notice is the reason the window was opened, shown to the person.
	notice string

	mu    sync.Mutex
	done  bool
	saved chan struct{}
}

func newServer(path, addr, token string, check CheckProxy) *server {
	return &server{path: path, addr: addr, token: token, check: check, saved: make(chan struct{})}
}

func (s *server) wasSaved() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.done
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Host != s.addr {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	rest, ok := strings.CutPrefix(r.URL.Path, "/"+s.token+"/")
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	if r.Method == http.MethodGet {
		switch rest {
		case "":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'")
			w.Write(pageHTML)
		case "logo.png":
			w.Header().Set("Content-Type", "image/png")
			w.Write(logoPNG)
		case "state":
			s.state(w)
		default:
			http.Error(w, "not found", http.StatusNotFound)
		}
		return
	}

	if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" {
		http.Error(w, "not allowed", http.StatusMethodNotAllowed)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+s.addr {
		http.Error(w, "not allowed", http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		http.Error(w, "too large", http.StatusRequestEntityTooLarge)
		return
	}
	switch rest {
	case "parse":
		s.parse(w, body)
	case "test":
		s.test(w, body)
	case "save":
		s.save(w, body)
	default:
		http.Error(w, "not found", http.StatusNotFound)
	}
}

// form is what the page sends. The port arrives as typed.
type form struct {
	Enabled  bool   `json:"enabled"`
	Scheme   string `json:"scheme"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	// Link is a connection code typed or pasted; empty keeps the saved one.
	Link string `json:"link"`
}

func (s *server) state(w http.ResponseWriter) {
	current, err := settings.Load(s.path)
	firstRun := errors.Is(err, settings.ErrNotSet)
	if err != nil && !firstRun {
		// An unreadable file means asking again, not stopping for good.
		current = settings.Settings{}
		firstRun = true
	}
	p := current.Proxy
	reply := map[string]any{
		"firstRun":    firstRun,
		"enabled":     p.Enabled,
		"scheme":      p.Scheme,
		"host":        p.Host,
		"username":    p.Username,
		"hasPassword": p.Password != "", // the password itself never goes back to the page
		"notice":      s.notice,
		"linked":      current.Link != "", // nor does the code
	}
	if p.Port != 0 {
		reply["port"] = strconv.Itoa(p.Port)
	}
	writeJSON(w, reply)
}

func (s *server) parse(w http.ResponseWriter, body []byte) {
	var in struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(body, &in); err != nil {
		writeError(w, "Could not read that.")
		return
	}
	p, err := settings.ParseProxy(in.Text)
	if err != nil {
		writeError(w, err.Error())
		return
	}
	writeJSON(w, map[string]any{"scheme": p.Scheme, "host": p.Host, "port": strconv.Itoa(p.Port), "username": p.Username, "password": p.Password})
}

// proxyFrom turns what was typed into a proxy. An empty password box keeps the saved
// password, as long as it is still the same login on the same proxy.
func (s *server) proxyFrom(body []byte) (settings.Proxy, error) {
	var in form
	if err := json.Unmarshal(body, &in); err != nil {
		return settings.Proxy{}, errors.New("Could not read that.")
	}
	if !in.Enabled {
		return settings.Proxy{}, nil
	}
	port, err := strconv.Atoi(strings.TrimSpace(in.Port))
	if err != nil {
		return settings.Proxy{}, errors.New("Enter the proxy's port, a number from 1 to 65535.")
	}
	p := settings.Proxy{Enabled: true, Scheme: in.Scheme, Host: strings.TrimSpace(in.Host), Port: port, Username: strings.TrimSpace(in.Username), Password: in.Password}
	if p.Password == "" && p.Username != "" {
		if current, err := settings.Load(s.path); err == nil {
			c := current.Proxy
			if c.Host == p.Host && c.Port == p.Port && c.Username == p.Username {
				p.Password = c.Password
			}
		}
	}
	return p, p.Validate()
}

func (s *server) test(w http.ResponseWriter, body []byte) {
	p, err := s.proxyFrom(body)
	if err != nil {
		writeError(w, err.Error())
		return
	}
	address, err := s.check(p.URL())
	if err != nil {
		writeError(w, Explain(err))
		return
	}
	writeJSON(w, map[string]any{"address": address})
}

func (s *server) save(w http.ResponseWriter, body []byte) {
	p, err := s.proxyFrom(body)
	if err != nil {
		writeError(w, err.Error())
		return
	}
	var in form
	json.Unmarshal(body, &in)
	link := ""
	if current, err := settings.Load(s.path); err == nil {
		link = current.Link
	}
	switch {
	case strings.TrimSpace(in.Link) != "":
		code, err := linkpkg.Parse(in.Link)
		if err != nil {
			writeError(w, err.Error())
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		err = checkIn(ctx, code, linkpkg.Status{State: "idle", Detail: "Connecting."})
		cancel()
		switch {
		case errors.Is(err, linkpkg.ErrNotConnected):
			writeError(w, "KIASA does not accept this code. It may have been replaced: make a new one on the Auto apply page.")
			return
		case err != nil:
			writeError(w, "Could not reach KIASA to check the code. Check your internet connection and try again.")
			return
		}
		link = strings.TrimSpace(in.Link)
	}
	if link == "" {
		writeError(w, "Paste the code from the Auto apply page of KIASA. The KIASA Browser cannot be used without it.")
		return
	}
	if err := settings.Save(s.path, settings.Settings{Proxy: p, Link: link}); err != nil {
		writeError(w, "The settings could not be saved: "+filepath.Base(s.path))
		return
	}
	writeJSON(w, map[string]any{"ok": true})
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.done {
		s.done = true
		close(s.saved)
	}
}

// Explain turns a failed proxy check into plain words. It never repeats the error
// itself, so nothing about the login can reach the screen or a log.
func Explain(err error) string {
	message := err.Error()
	contains := func(parts ...string) bool {
		for _, part := range parts {
			if strings.Contains(message, part) {
				return true
			}
		}
		return false
	}
	switch {
	case contains("Proxy Authentication Required", "407"):
		return "The proxy refused this username or password."
	case contains("Timeout", "deadline exceeded", "i/o timeout", "timeout"):
		return "The proxy did not answer in time. Check the address and port, or try again."
	case contains("refused"):
		return "Nothing answered at this address and port."
	case contains("no such host"):
		return "This proxy address could not be found."
	default:
		return "Could not connect through this proxy. Check the details and try again."
	}
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, message string) {
	writeJSON(w, map[string]string{"error": message})
}
