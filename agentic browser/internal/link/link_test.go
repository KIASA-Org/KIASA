package link

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"stealth-app/internal/brand"
	"strings"
	"sync"
	"testing"
	"time"
)

func code(url, key, secret string) string {
	packed := base64.RawURLEncoding.EncodeToString([]byte(`{"u":"` + url + `","k":"` + key + `","s":"` + secret + `"}`))
	return codePrefix + packed
}

func TestParse(t *testing.T) {
	got, err := Parse("  " + code("https://x.supabase.co/", "pub", "kapp_secret") + "\n")
	if err != nil || got.URL != "https://x.supabase.co" || got.Key != "pub" || got.Secret != "kapp_secret" {
		t.Fatalf("Parse = %+v, %v", got, err)
	}
	for _, bad := range []string{"", "KIASA-BOT1.abc", codePrefix + "!!!", codePrefix + base64.RawURLEncoding.EncodeToString([]byte(`{}`)), code("http://plain.example", "k", "s")} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("Parse(%q) accepted a bad code", bad)
		}
	}
}

func TestParse_ALocalDatabaseOnlyInTheLocalTestBuild(t *testing.T) {
	local := code("http://127.0.0.1:54321", "pub", "kapp_secret")
	if _, err := Parse(local); err == nil {
		t.Fatal("the real build must refuse a local database")
	}
	saved := brand.LocalTest
	brand.LocalTest = "on"
	defer func() { brand.LocalTest = saved }()
	if _, err := Parse(local); err != nil {
		t.Errorf("the local test build should accept it: %v", err)
	}
	if _, err := Parse(code("http://evil.example", "pub", "kapp_secret")); err == nil {
		t.Error("even the local test build takes plain http only from this PC")
	}
}

func TestReport_AlwaysSendsAList(t *testing.T) {
	var got []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]json.RawMessage
		json.NewDecoder(r.Body).Decode(&body)
		got = append(got, string(body["asks"]))
		w.Write([]byte("null"))
	}))
	defer server.Close()
	code := Code{URL: server.URL, Key: "pub", Secret: "kapp_secret"}
	var none []struct{ Label string }
	for _, asks := range []any{nil, none, []struct{}{}} {
		if err := Report(context.Background(), code, "job", "filled", "done", asks); err != nil {
			t.Fatal(err)
		}
	}
	for i, sent := range got {
		if sent != "[]" {
			t.Errorf("report %d sent %s, want an empty list", i, sent)
		}
	}
	if err := Report(context.Background(), code, "job", "waiting", "", []struct {
		Label string `json:"label"`
	}{{"A question"}}); err != nil {
		t.Fatal(err)
	}
	if got[len(got)-1] != `[{"label":"A question"}]` {
		t.Errorf("sent %s", got[len(got)-1])
	}
}

func TestResumeName(t *testing.T) {
	cases := map[string]string{
		`attachment; filename="Ana Silva Resume.pdf"`:                  "Ana Silva Resume.pdf",
		`attachment; filename="../../evil.pdf"`:                        "evil.pdf",
		`attachment; filename="C:\\Windows\\evil.pdf"`:                 "evil.pdf",
		`attachment; filename="run.exe"`:                               "Resume.pdf",
		`attachment; filename=".pdf"`:                                  "Resume.pdf",
		`attachment; filename="_"; filename*=UTF-8''Jos%C3%A9%20R.pdf`: "José R.pdf",
		``: "Resume.pdf",
	}
	for header, want := range cases {
		if got := resumeName(header); got != want {
			t.Errorf("resumeName(%q) = %q, want %q", header, got, want)
		}
	}
}

func TestFromAppLink(t *testing.T) {
	const host = "kiasa.supabase.co"
	good := code("https://"+host, "pub", "kapp_secret")
	for _, arg := range []string{"kiasa-browser://start?code=" + good, "KIASA-BROWSER://start/?code=" + good} {
		if !IsAppLink(arg) {
			t.Errorf("IsAppLink(%q) = false", arg)
		}
		if got, err := FromAppLink(arg, host); err != nil || got != good {
			t.Errorf("FromAppLink(%q) = %q, %v", arg, got, err)
		}
	}
	if got, err := FromAppLink("kiasa-browser://start", host); err != nil || got != "" {
		t.Errorf("a link with no code = %q, %v", got, err)
	}
	for name, arg := range map[string]string{
		"another database":         "kiasa-browser://start?code=" + code("https://evil.example", "pub", "kapp_secret"),
		"a host ending in KIASA's": "kiasa-browser://start?code=" + code("https://evil"+host, "pub", "kapp_secret"),
		"a damaged code":           "kiasa-browser://start?code=KIASA-APP1.!!!",
		"another program":          "kiasa-live://start?code=" + good,
	} {
		if _, err := FromAppLink(arg, host); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	if IsAppLink("-settings") || IsAppLink("kiasa-live://start") {
		t.Error("IsAppLink accepted something else")
	}
}

// keepServer accepts only the current secret and counts the check-ins by secret.
type keepServer struct {
	mu     sync.Mutex
	accept string
	seen   map[string]int
	last   string
}

func (s *keepServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	var in struct {
		Key  string `json:"agent_key"`
		Info Status `json:"info"`
	}
	json.Unmarshal(body, &in)
	s.mu.Lock()
	defer s.mu.Unlock()
	if in.Key != s.accept {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"code":"28000"}`))
		return
	}
	s.seen[in.Key]++
	s.last = in.Info.State + ": " + in.Info.Detail
	w.Write([]byte(`{}`))
}

func (s *keepServer) count(key string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.seen[key]
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()
	for deadline := time.Now().Add(3 * time.Second); time.Now().Before(deadline); time.Sleep(5 * time.Millisecond) {
		if done() {
			return
		}
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestKeep(t *testing.T) {
	old := beat
	beat = 5 * time.Millisecond
	defer func() { beat = old }()
	state := &keepServer{accept: "new", seen: map[string]int{}}
	server := httptest.NewTLSServer(state)
	defer server.Close()
	client = server.Client()
	status := func() Status { return Status{State: "idle", Detail: "Open."} }

	t.Run("a new code takes over from a refused one", func(t *testing.T) {
		var mu sync.Mutex
		secret := "old"
		now := func() Code {
			mu.Lock()
			defer mu.Unlock()
			return Code{URL: server.URL, Key: "pub", Secret: secret}
		}
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			defer close(done)
			Keep(ctx, now, status, func() bool {
				mu.Lock()
				defer mu.Unlock()
				secret = "new"
				return true
			})
		}()
		waitFor(t, "check-ins with the new code", func() bool { return state.count("new") >= 3 })
		cancel()
		<-done
		state.mu.Lock()
		defer state.mu.Unlock()
		if !strings.HasPrefix(state.last, "paused") {
			t.Errorf("last status = %q, want the closing one", state.last)
		}
	})

	t.Run("with no new code it stops", func(t *testing.T) {
		now := func() Code { return Code{URL: server.URL, Key: "pub", Secret: "gone"} }
		refused := make(chan struct{})
		done := make(chan struct{})
		go func() {
			defer close(done)
			Keep(context.Background(), now, status, func() bool { close(refused); return false })
		}()
		<-refused
		<-done
	})

	t.Run("a problem is said as it ends", func(t *testing.T) {
		now := func() Code { return Code{URL: server.URL, Key: "pub", Secret: "new"} }
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			defer close(done)
			Keep(ctx, now, func() Status { return Status{State: "error", Detail: "No Chrome."} }, nil)
		}()
		cancel()
		<-done
		state.mu.Lock()
		defer state.mu.Unlock()
		if state.last != "error: No Chrome." {
			t.Errorf("last status = %q", state.last)
		}
	})
}

func TestCheckIn(t *testing.T) {
	var path, key, body string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, key = r.URL.Path, r.Header.Get("apikey")
		buf := new(strings.Builder)
		b := make([]byte, 512)
		n, _ := r.Body.Read(b)
		buf.Write(b[:n])
		body = buf.String()
		if strings.Contains(body, "refused") {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"code":"28000"}`))
			return
		}
		w.Write([]byte(`{}`))
	}))
	defer server.Close()
	client = server.Client()

	c := Code{URL: server.URL, Key: "pub", Secret: "kapp_ok"}
	if err := CheckIn(context.Background(), c, Status{State: "idle"}); err != nil {
		t.Fatal(err)
	}
	if path != "/rest/v1/rpc/browser_agent_check_in" || key != "pub" || !strings.Contains(body, `"agent_key":"kapp_ok"`) || !strings.Contains(body, `"state":"idle"`) {
		t.Errorf("unexpected request: %s %s %s", path, key, body)
	}
	c.Secret = "refused"
	if err := CheckIn(context.Background(), c, Status{State: "idle"}); !errors.Is(err, ErrNotConnected) {
		t.Errorf("err = %v, want ErrNotConnected", err)
	}
}
