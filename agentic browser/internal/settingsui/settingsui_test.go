package settingsui

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stealth-app/internal/settings"
)

const testToken = "secret-token"

// tester is a settings server and helpers to talk to it the way the page does.
type tester struct {
	t      *testing.T
	srv    *server
	web    *httptest.Server
	host   string
	path   string
	checks []string
}

func newTester(t *testing.T, check CheckProxy) *tester {
	t.Helper()
	path := filepath.Join(t.TempDir(), "settings.json")
	tt := &tester{t: t, path: path}
	if check == nil {
		check = func(proxyURL string) (string, error) {
			tt.checks = append(tt.checks, proxyURL)
			return "198.51.100.7", nil
		}
	}
	web := httptest.NewUnstartedServer(nil)
	web.Start()
	t.Cleanup(web.Close)
	tt.web = web
	tt.host = strings.TrimPrefix(web.URL, "http://")
	tt.srv = newServer(path, tt.host, testToken, check)
	web.Config.Handler = tt.srv
	return tt
}

func (tt *tester) post(route, body string) map[string]any {
	tt.t.Helper()
	req, _ := http.NewRequest(http.MethodPost, tt.web.URL+"/"+testToken+"/"+route, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		tt.t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		tt.t.Fatalf("%s: status %d", route, res.StatusCode)
	}
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		tt.t.Fatal(err)
	}
	return out
}

func (tt *tester) state() map[string]any {
	tt.t.Helper()
	res, err := http.Get(tt.web.URL + "/" + testToken + "/state")
	if err != nil {
		tt.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		tt.t.Fatal(err)
	}
	return out
}

const proxyForm = `{"enabled":true,"scheme":"http","host":"1.2.3.4","port":"8080","username":"user","password":"s3cret-value"}`

func TestPage_IsServedWithTheToken(t *testing.T) {
	tt := newTester(t, nil)
	res, err := http.Get(tt.web.URL + "/" + testToken + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !strings.Contains(string(body), "KIASA settings") {
		t.Errorf("status %d, body starts %q", res.StatusCode, string(body)[:40])
	}
	if res.Header.Get("Content-Security-Policy") == "" {
		t.Error("no content security policy")
	}
}

func TestLogo_IsARealPNG(t *testing.T) {
	if len(logoPNG) < 8 || string(logoPNG[1:4]) != "PNG" {
		t.Errorf("logo.png is not a PNG file")
	}
}

func TestStrangersAreTurnedAway(t *testing.T) {
	tt := newTester(t, nil)

	for name, build := range map[string]func() *http.Request{
		"no token": func() *http.Request {
			r, _ := http.NewRequest(http.MethodGet, tt.web.URL+"/", nil)
			return r
		},
		"wrong token": func() *http.Request {
			r, _ := http.NewRequest(http.MethodGet, tt.web.URL+"/wrong/state", nil)
			return r
		},
		"another host name, as DNS rebinding would send": func() *http.Request {
			r, _ := http.NewRequest(http.MethodGet, tt.web.URL+"/"+testToken+"/state", nil)
			r.Host = "evil.example"
			return r
		},
		"a POST from another website": func() *http.Request {
			r, _ := http.NewRequest(http.MethodPost, tt.web.URL+"/"+testToken+"/save", strings.NewReader(proxyForm))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Origin", "https://evil.example")
			return r
		},
		"a POST of the kind a plain web form can send": func() *http.Request {
			r, _ := http.NewRequest(http.MethodPost, tt.web.URL+"/"+testToken+"/save", strings.NewReader(proxyForm))
			r.Header.Set("Content-Type", "text/plain")
			return r
		},
	} {
		t.Run(name, func(t *testing.T) {
			res, err := http.DefaultClient.Do(build())
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			if res.StatusCode == http.StatusOK {
				t.Errorf("got status 200")
			}
		})
	}
	if _, err := os.Stat(tt.path); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("a rejected request wrote the settings file")
	}
	if tt.srv.wasSaved() {
		t.Error("a rejected request counted as saved")
	}
}

func TestFirstRun_AsksForAProxy(t *testing.T) {
	tt := newTester(t, nil)
	if got := tt.state(); got["firstRun"] != true {
		t.Errorf("state = %v", got)
	}
}

func TestSave_ThenStateNeverReturnsThePassword(t *testing.T) {
	tt := newTester(t, nil)
	if got := tt.post("save", proxyForm); got["ok"] != true {
		t.Fatalf("save: %v", got)
	}
	if !tt.srv.wasSaved() {
		t.Error("not marked as saved")
	}
	saved, err := settings.Load(tt.path)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Proxy.Password != "s3cret-value" || saved.Proxy.Host != "1.2.3.4" || saved.Proxy.Port != 8080 {
		t.Errorf("saved %+v", saved.Proxy)
	}

	state := tt.state()
	if state["firstRun"] != false || state["host"] != "1.2.3.4" || state["port"] != "8080" || state["hasPassword"] != true {
		t.Errorf("state = %v", state)
	}
	raw, _ := json.Marshal(state)
	if strings.Contains(string(raw), "s3cret-value") {
		t.Errorf("state contains the password: %s", raw)
	}
}

func TestSave_EmptyPasswordKeepsTheSavedOneForTheSameLogin(t *testing.T) {
	tt := newTester(t, nil)
	tt.post("save", proxyForm)
	tt.post("save", `{"enabled":true,"scheme":"http","host":"1.2.3.4","port":"8080","username":"user","password":""}`)
	saved, _ := settings.Load(tt.path)
	if saved.Proxy.Password != "s3cret-value" {
		t.Errorf("password = %q, want it kept", saved.Proxy.Password)
	}
}

func TestSave_EmptyPasswordIsNotCarriedToAnotherProxy(t *testing.T) {
	for name, form := range map[string]string{
		"another address":  `{"enabled":true,"scheme":"http","host":"9.9.9.9","port":"8080","username":"user","password":""}`,
		"another port":     `{"enabled":true,"scheme":"http","host":"1.2.3.4","port":"9090","username":"user","password":""}`,
		"another username": `{"enabled":true,"scheme":"http","host":"1.2.3.4","port":"8080","username":"other","password":""}`,
	} {
		t.Run(name, func(t *testing.T) {
			tt := newTester(t, nil)
			tt.post("save", proxyForm)
			tt.post("save", form)
			saved, _ := settings.Load(tt.path)
			if saved.Proxy.Password != "" {
				t.Errorf("the old password went to %s", name)
			}
		})
	}
}

func TestSave_NoProxy(t *testing.T) {
	tt := newTester(t, nil)
	tt.post("save", proxyForm)
	if got := tt.post("save", `{"enabled":false}`); got["ok"] != true {
		t.Fatalf("save: %v", got)
	}
	saved, _ := settings.Load(tt.path)
	if saved.Proxy.URL() != "" || saved.Proxy.Password != "" {
		t.Errorf("saved %+v", saved.Proxy)
	}
	if got := tt.state(); got["enabled"] != false || got["firstRun"] != false {
		t.Errorf("state = %v", got)
	}
}

func TestSave_BadDetailsAreExplainedAndNotSaved(t *testing.T) {
	for name, form := range map[string]string{
		"no address":        `{"enabled":true,"scheme":"http","host":"","port":"80"}`,
		"port not a number": `{"enabled":true,"scheme":"http","host":"1.2.3.4","port":"abc"}`,
		"port too large":    `{"enabled":true,"scheme":"http","host":"1.2.3.4","port":"70000"}`,
		"unknown type":      `{"enabled":true,"scheme":"ftp","host":"1.2.3.4","port":"21"}`,
		"socks5 with login": `{"enabled":true,"scheme":"socks5","host":"1.2.3.4","port":"1080","username":"u","password":"p"}`,
		"not JSON":          `not json`,
	} {
		t.Run(name, func(t *testing.T) {
			tt := newTester(t, nil)
			got := tt.post("save", form)
			if message, _ := got["error"].(string); message == "" {
				t.Errorf("no message: %v", got)
			}
			if tt.srv.wasSaved() {
				t.Error("marked as saved")
			}
			if _, err := os.Stat(tt.path); !errors.Is(err, os.ErrNotExist) {
				t.Error("the file was written")
			}
		})
	}
}

func TestParse_FillsTheBoxes(t *testing.T) {
	tt := newTester(t, nil)
	got := tt.post("parse", `{"text":"1.2.3.4:8080:user:s3cret-value"}`)
	if got["host"] != "1.2.3.4" || got["port"] != "8080" || got["username"] != "user" || got["password"] != "s3cret-value" || got["scheme"] != "http" {
		t.Errorf("got %v", got)
	}
	if got := tt.post("parse", `{"text":"nonsense"}`); got["error"] == nil {
		t.Errorf("no message for nonsense: %v", got)
	}
}

func TestTest_UsesTheFormAndTheSavedPassword(t *testing.T) {
	tt := newTester(t, nil)
	got := tt.post("test", proxyForm)
	if got["address"] != "198.51.100.7" {
		t.Errorf("got %v", got)
	}
	if len(tt.checks) != 1 || tt.checks[0] != "http://user:s3cret-value@1.2.3.4:8080" {
		t.Errorf("checked %q", tt.checks)
	}
	if tt.srv.wasSaved() {
		t.Error("a test counted as saving")
	}

	tt.post("save", proxyForm)
	tt.post("test", `{"enabled":true,"scheme":"http","host":"1.2.3.4","port":"8080","username":"user","password":""}`)
	if last := tt.checks[len(tt.checks)-1]; last != "http://user:s3cret-value@1.2.3.4:8080" {
		t.Errorf("checked %q", last)
	}
}

func TestTest_FailureNeverRepeatsTheError(t *testing.T) {
	tt := newTester(t, func(string) (string, error) {
		return "", errors.New(`Get "https://x": proxyconnect tcp: http://user:s3cret-value@1.2.3.4:8080: 407 Proxy Authentication Required`)
	})
	got := tt.post("test", proxyForm)
	message, _ := got["error"].(string)
	if !strings.Contains(message, "refused this username or password") {
		t.Errorf("message = %q", message)
	}
	if strings.Contains(message, "s3cret-value") {
		t.Errorf("message contains the password: %q", message)
	}
}

func TestExplain(t *testing.T) {
	tests := map[string]string{
		"Proxy Authentication Required":                           "username or password",
		"context deadline exceeded (Client.Timeout exceeded)":     "did not answer",
		"dial tcp 1.2.3.4:80: connectex: connection was refused":  "Nothing answered",
		"lookup proxy.example: no such host":                      "could not be found",
		"something else altogether with http://u:p@1.2.3.4:8080/": "Could not connect",
	}
	for input, want := range tests {
		got := Explain(errors.New(input))
		if !strings.Contains(got, want) {
			t.Errorf("Explain(%q) = %q, want it to contain %q", input, got, want)
		}
		if strings.Contains(got, "u:p@") {
			t.Errorf("Explain repeats the error: %q", got)
		}
	}
}

func TestWindowArgs_CannotReachTheInternet(t *testing.T) {
	args := strings.Join(windowArgs("http://127.0.0.1:1/x/", `C:\p`), " ")
	for _, want := range []string{"--app=http://127.0.0.1:1/x/", "--user-data-dir=C:\\p", "--no-proxy-server", "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"} {
		if !strings.Contains(args, want) {
			t.Errorf("missing %q in %s", want, args)
		}
	}
}

func TestSave_WorksWithNoConnectionToKIASAYet(t *testing.T) {
	tt := newTester(t, nil)
	if got := tt.post("save", proxyForm); got["ok"] != true {
		t.Fatalf("save: %v", got)
	}
	if saved, _ := settings.Load(tt.path); saved.Link != "" || saved.Proxy.Host != "1.2.3.4" {
		t.Errorf("saved %+v", saved)
	}
}

func TestSave_KeepsTheConnectionToKIASA(t *testing.T) {
	tt := newTester(t, nil)
	if err := settings.Save(tt.path, settings.Settings{Link: "KIASA-APP1.saved-secret"}); err != nil {
		t.Fatal(err)
	}
	if got := tt.post("save", proxyForm); got["ok"] != true {
		t.Fatalf("save: %v", got)
	}
	if saved, _ := settings.Load(tt.path); saved.Link != "KIASA-APP1.saved-secret" {
		t.Errorf("the connection was lost: %q", saved.Link)
	}
	raw, _ := json.Marshal(tt.state())
	if strings.Contains(string(raw), "saved-secret") {
		t.Errorf("state contains the code: %s", raw)
	}
}
