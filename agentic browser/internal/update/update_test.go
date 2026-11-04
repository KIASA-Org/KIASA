package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fixture struct {
	public  string
	private ed25519.PrivateKey
	setup   []byte
	body    string
	status  int
	server  *httptest.Server
	dir     string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	public, private, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{public: base64.StdEncoding.EncodeToString(public), private: private, setup: []byte("pretend installer"), status: 200, dir: t.TempDir()}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latest.json":
			w.WriteHeader(f.status)
			w.Write([]byte(f.body))
		case "/setup.exe":
			w.Write(f.setup)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fixture) manifest(version string) Manifest {
	sum := sha256.Sum256(f.setup)
	m := Manifest{Version: version, URL: f.server.URL + "/setup.exe", SHA256: hex.EncodeToString(sum[:])}
	m.Sign(f.private)
	return m
}

func (f *fixture) serve(m Manifest) {
	packed, _ := json.Marshal(m)
	f.body = string(packed)
}

func (f *fixture) config(current string) Config {
	return Config{ManifestURL: f.server.URL + "/latest.json", PublicKey: f.public, Current: current, WorkDir: f.dir, AllowPlainHTTP: true, Client: f.server.Client()}
}

func TestNewer(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.3.0", "1.2.0", true}, {"1.2.0", "1.3.0", false}, {"1.2.0", "1.2.0", false},
		{"1.10.0", "1.9.9", true}, {"2.0.0", "1.99.99", true}, {"1.2.1", "1.2.0", true},
		{"dev", "1.2.0", false}, {"1.2.0", "dev", false}, {"1.2", "1.1.0", false}, {"", "", false}, {"1.2.x", "1.2.0", false}, {"-1.0.0", "0.0.1", false},
	}
	for _, c := range cases {
		if got := Newer(c.a, c.b); got != c.want {
			t.Errorf("Newer(%q, %q) = %v", c.a, c.b, got)
		}
	}
}

func TestFind_DownloadsASignedNewerVersion(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("1.3.0"))
	ready, err := Find(context.Background(), f.config("1.2.0"))
	if err != nil || ready == nil {
		t.Fatalf("ready = %v, err = %v", ready, err)
	}
	got, err := os.ReadFile(ready.Setup)
	if err != nil || string(got) != string(f.setup) {
		t.Errorf("download = %q, %v", got, err)
	}
	if ready.Manifest.Version != "1.3.0" {
		t.Errorf("version = %q", ready.Manifest.Version)
	}
}

func TestFind_NothingToDo(t *testing.T) {
	f := newFixture(t)
	for _, current := range []string{"1.3.0", "1.4.0"} {
		f.serve(f.manifest("1.3.0"))
		if ready, err := Find(context.Background(), f.config(current)); ready != nil || err != nil {
			t.Errorf("on %s: ready = %v, err = %v", current, ready, err)
		}
	}
	// No file on the site yet.
	f.status = http.StatusNotFound
	if ready, err := Find(context.Background(), f.config("1.2.0")); ready != nil || err != nil {
		t.Errorf("no file: ready = %v, err = %v", ready, err)
	}
}

func TestFind_BuildsWithNoVersionOfTheirOwnDoNotUpdate(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("9.9.9"))
	for _, current := range []string{"dev", "local-test", ""} {
		if ready, err := Find(context.Background(), f.config(current)); ready != nil || err != nil {
			t.Errorf("%q: ready = %v, err = %v", current, ready, err)
		}
	}
	noKey := f.config("1.0.0")
	noKey.PublicKey = ""
	if ready, err := Find(context.Background(), noKey); ready != nil || err != nil {
		t.Errorf("no key: ready = %v, err = %v", ready, err)
	}
}

func TestFind_RefusesAnythingNotSignedWithTheReleaseKey(t *testing.T) {
	f := newFixture(t)
	_, otherKey, _ := ed25519.GenerateKey(nil)

	tamper := map[string]func(*Manifest){
		"another key":          func(m *Manifest) { m.Sign(otherKey) },
		"no signature":         func(m *Manifest) { m.Signature = "" },
		"a garbled signature":  func(m *Manifest) { m.Signature = "!!!" },
		"a changed version":    func(m *Manifest) { m.Version = "9.9.9" },
		"a changed address":    func(m *Manifest) { m.URL = "https://evil.example/setup.exe" },
		"a changed checksum":   func(m *Manifest) { m.SHA256 = strings.Repeat("0", 64) },
		"made into a rollback": func(m *Manifest) { m.Rollback = true },
	}
	for name, change := range tamper {
		m := f.manifest("1.3.0")
		change(&m)
		f.serve(m)
		ready, err := Find(context.Background(), f.config("1.2.0"))
		if ready != nil || !errors.Is(err, ErrNotSigned) {
			t.Errorf("%s: ready = %v, err = %v", name, ready, err)
		}
	}
}

func TestFind_RefusesADownloadThatIsNotWhatWasSigned(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("1.3.0"))
	f.setup = []byte("something else entirely")
	ready, err := Find(context.Background(), f.config("1.2.0"))
	if ready != nil || err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Errorf("ready = %v, err = %v", ready, err)
	}
	if found, _ := filepath.Glob(filepath.Join(f.dir, "*.exe")); len(found) != 0 {
		t.Errorf("a download that does not match should not be left behind: %v", found)
	}
}

func TestFind_AnOldManifestCannotTakeABrowserBack(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("1.2.0"))
	if ready, err := Find(context.Background(), f.config("1.3.0")); ready != nil || err != nil {
		t.Errorf("ready = %v, err = %v", ready, err)
	}
}

func TestFind_ARollbackSignedAsOneDoes(t *testing.T) {
	f := newFixture(t)
	m := f.manifest("1.2.0")
	m.Rollback = true
	m.Sign(f.private)
	f.serve(m)
	ready, err := Find(context.Background(), f.config("1.3.0"))
	if err != nil || ready == nil {
		t.Fatalf("ready = %v, err = %v", ready, err)
	}
	// And once there, it stays.
	if ready, err := Find(context.Background(), f.config("1.2.0")); ready != nil || err != nil {
		t.Errorf("already on it: ready = %v, err = %v", ready, err)
	}
}

func TestFind_PlainHTTPIsOnlyForTheLocalTestBuild(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("1.3.0"))
	real := f.config("1.2.0")
	real.AllowPlainHTTP = false
	if ready, err := Find(context.Background(), real); ready != nil || err == nil {
		t.Errorf("ready = %v, err = %v", ready, err)
	}
	c := Config{AllowPlainHTTP: true}
	for address, want := range map[string]bool{
		"http://127.0.0.1:3004/x": true, "http://127.0.0.1.evil.example/x": false, "http://10.0.0.1/x": false,
		"https://kiasa.tech/x": true, "ftp://127.0.0.1/x": false, "https://user:pass@kiasa.tech/x": false, "": false,
	} {
		if got := c.allowedURL(address); got != want {
			t.Errorf("allowedURL(%q) = %v", address, got)
		}
	}
}

func TestFind_ABadOrMissingFileLeavesTheBrowserAlone(t *testing.T) {
	f := newFixture(t)
	for name, set := range map[string]func(){
		"not json":    func() { f.status, f.body = 200, "<html>hello</html>" },
		"server down": func() { f.status, f.body = 500, "" },
		"empty":       func() { f.status, f.body = 200, "{}" },
	} {
		set()
		if ready, err := Find(context.Background(), f.config("1.2.0")); ready != nil || err == nil {
			t.Errorf("%s: ready = %v, err = %v", name, ready, err)
		}
	}
	f.server.Close()
	if ready, err := Find(context.Background(), f.config("1.2.0")); ready != nil || err == nil {
		t.Errorf("no site: ready = %v, err = %v", ready, err)
	}
}

func TestInstall_RunsTheVerifiedDownload(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("1.3.0"))
	saved := startDetached
	defer func() { startDetached = saved }()
	var ran []string
	startDetached = func(path string, args ...string) error {
		ran = append(append([]string{path}, args...), "")
		return nil
	}
	ready, err := Find(context.Background(), f.config("1.2.0"))
	if err != nil || ready == nil {
		t.Fatal(err)
	}
	if err := ready.Install(1234); err != nil {
		t.Fatal(err)
	}
	if len(ran) < 4 || ran[0] != ready.Setup || ran[1] != "-update" || ran[2] != "-wait-pid" || ran[3] != "1234" {
		t.Errorf("ran = %q", ran)
	}
}

func TestARelease_ThatWillNotInstall_StopsBeingTried(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("1.3.0"))
	saved := startDetached
	defer func() { startDetached = saved }()
	starts := 0
	startDetached = func(string, ...string) error { starts++; return nil }
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	c := f.config("1.2.0")
	c.Now = func() time.Time { return now }

	for i := 0; i < triesLimit; i++ {
		ready, err := Find(context.Background(), c)
		if err != nil || ready == nil {
			t.Fatalf("try %d: ready = %v, err = %v", i, ready, err)
		}
		ready.Install(1)
	}
	ready, err := Find(context.Background(), c)
	if ready != nil || err == nil || !strings.Contains(err.Error(), "left for a while") {
		t.Errorf("after %d tries: ready = %v, err = %v", triesLimit, ready, err)
	}
	if starts != triesLimit {
		t.Errorf("started %d times", starts)
	}

	// A newer release is tried at once.
	f.serve(f.manifest("1.3.1"))
	if ready, err := Find(context.Background(), c); ready == nil || err != nil {
		t.Errorf("a newer one: ready = %v, err = %v", ready, err)
	}
	// And after a while the same one is tried again.
	f.serve(f.manifest("1.3.0"))
	now = now.Add(triesReset + time.Minute)
	if ready, err := Find(context.Background(), c); ready == nil || err != nil {
		t.Errorf("later: ready = %v, err = %v", ready, err)
	}
}

func TestTidy_RemovesOldDownloads(t *testing.T) {
	f := newFixture(t)
	f.serve(f.manifest("1.3.0"))
	c := f.config("1.2.0")
	ready, err := Find(context.Background(), c)
	if err != nil || ready == nil {
		t.Fatal(err)
	}
	c.Tidy()
	if _, err := os.Stat(ready.Setup); !os.IsNotExist(err) {
		t.Errorf("the download is still there: %v", err)
	}
}
