package proxy

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type geoAnswer struct {
	status int
	body   string
}

// startGeoProxy runs a local server acting as an HTTP proxy that answers the
// geolocation requests itself, by path. It returns the proxy URL to pass to
// LookupTimezone and the list of request URLs it received.
func startGeoProxy(t *testing.T, answers map[string]geoAnswer) (string, func() []string) {
	t.Helper()

	var (
		mu   sync.Mutex
		seen []string
	)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.URL.String())
		mu.Unlock()
		a, ok := answers[r.URL.Path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(a.status)
		w.Write([]byte(a.body))
	}))
	t.Cleanup(ts.Close)
	return ts.URL, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), seen...)
	}
}

// setGeoEndpoints replaces the service list for the duration of a test. The
// addresses use the reserved .invalid TLD, so only the mock proxy can answer.
func setGeoEndpoints(t *testing.T, paths ...string) {
	t.Helper()

	orig := geoEndpoints
	geoEndpoints = nil
	for _, p := range paths {
		geoEndpoints = append(geoEndpoints, "http://geo.invalid"+p)
	}
	t.Cleanup(func() { geoEndpoints = orig })
}

func TestLookupTimezone_NestedShape(t *testing.T) {
	setGeoEndpoints(t, "/a")
	proxyURL, seen := startGeoProxy(t, map[string]geoAnswer{
		"/a": {200, `{"success": true, "timezone": {"id": "Asia/Tokyo", "utc": "+09:00"}}`},
	})

	zone, err := LookupTimezone(proxyURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if zone != "Asia/Tokyo" {
		t.Errorf("zone = %q, want Asia/Tokyo", zone)
	}
	if len(seen()) != 1 || seen()[0] != "http://geo.invalid/a" {
		t.Errorf("requests through the proxy = %q", seen())
	}
}

func TestLookupTimezone_FlatShape(t *testing.T) {
	setGeoEndpoints(t, "/a")
	proxyURL, _ := startGeoProxy(t, map[string]geoAnswer{
		"/a": {200, `{"status": "success", "timezone": "America/Sao_Paulo"}`},
	})

	zone, err := LookupTimezone(proxyURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if zone != "America/Sao_Paulo" {
		t.Errorf("zone = %q, want America/Sao_Paulo", zone)
	}
}

func TestLookupTimezone_FallsBackToTheNextService(t *testing.T) {
	setGeoEndpoints(t, "/down", "/garbage", "/unknown-zone", "/good")
	proxyURL, seen := startGeoProxy(t, map[string]geoAnswer{
		"/down":         {500, `{"timezone": "Asia/Tokyo"}`},
		"/garbage":      {200, `not json`},
		"/unknown-zone": {200, `{"timezone": "Mars/Olympus_Mons"}`},
		"/good":         {200, `{"timezone": "Europe/Berlin"}`},
	})

	zone, err := LookupTimezone(proxyURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if zone != "Europe/Berlin" {
		t.Errorf("zone = %q, want Europe/Berlin (a 500 answer, garbage and an unknown zone must all be skipped)", zone)
	}
	if len(seen()) != 4 {
		t.Errorf("expected all four services to be asked in order, got %q", seen())
	}
}

func TestLookupTimezone_NoServiceAnswers(t *testing.T) {
	setGeoEndpoints(t, "/a", "/b")
	proxyURL, _ := startGeoProxy(t, map[string]geoAnswer{
		"/a": {200, `{"timezone": ""}`},
		"/b": {200, `{"error": "rate limited"}`},
	})

	zone, err := LookupTimezone(proxyURL)
	if err == nil {
		t.Fatalf("expected an error, got zone %q", zone)
	}
	if want := "no geolocation service answered"; !strings.Contains(err.Error(), want) {
		t.Errorf("expected error containing %q, got: %v", want, err)
	}
	if zone != "" {
		t.Errorf("expected empty zone, got %q", zone)
	}
}

func TestLookupTimezone_EnvironmentOverrideReplacesThePublicServices(t *testing.T) {
	setGeoEndpoints(t, "/public")
	t.Setenv(geoOverrideEnv, "http://geo.invalid/mine")
	proxyURL, seen := startGeoProxy(t, map[string]geoAnswer{
		"/public": {200, `{"timezone": "Asia/Tokyo"}`},
		"/mine":   {200, `{"timezone": "Australia/Sydney"}`},
	})

	zone, err := LookupTimezone(proxyURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if zone != "Australia/Sydney" {
		t.Errorf("zone = %q, want Australia/Sydney", zone)
	}
	if len(seen()) != 1 || !strings.HasSuffix(seen()[0], "/mine") {
		t.Errorf("only the override should be asked, got %q", seen())
	}
}

func TestLookupTimezone_Unreachable(t *testing.T) {
	setGeoEndpoints(t, "/a")

	zone, err := LookupTimezone("http://127.0.0.1:1")
	if err == nil {
		t.Fatalf("expected an error for an unreachable proxy, got zone %q", zone)
	}
	if want := "no geolocation service answered"; !strings.Contains(err.Error(), want) {
		t.Errorf("expected error containing %q, got: %v", want, err)
	}
}

func TestLookupTimezone_InvalidProxyURL(t *testing.T) {
	const secretValue = "s3cr%et"

	tests := []struct {
		name     string
		proxyURL string
		wantErr  string
	}{
		{"empty", "", "invalid proxy URL or missing host"},
		{"missing host", "http://", "invalid proxy URL or missing host"},
		{"missing scheme", "127.0.0.1:8080", "invalid proxy URL or missing host"},
		{"unsupported scheme", "ftp://proxy.example:8080", "unsupported proxy scheme"},
		{"unparseable URL with credentials", "http://user:" + secretValue + "@proxy.example:8080", "invalid proxy URL or missing host"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			zone, err := LookupTimezone(tt.proxyURL)
			if err == nil {
				t.Fatalf("expected error, got zone %q", zone)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("expected error containing %q, got: %v", tt.wantErr, err)
			}
			if strings.Contains(err.Error(), secretValue) {
				t.Errorf("error leaks proxy credentials: %v", err)
			}
		})
	}
}

func TestExtractTimezone(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{"flat", `{"timezone": "Europe/Paris"}`, "Europe/Paris"},
		{"nested id", `{"timezone": {"id": "Europe/Paris"}}`, "Europe/Paris"},
		{"nested name", `{"timezone": {"name": "Europe/Paris"}}`, "Europe/Paris"},
		{"padded", `{"timezone": "  Europe/Paris "}`, "Europe/Paris"},
		{"missing", `{"country": "FR"}`, ""},
		{"wrong type", `{"timezone": 3}`, ""},
		{"empty object", `{"timezone": {}}`, ""},
		{"not json", `<html>`, ""},
		{"empty", ``, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := extractTimezone([]byte(tt.body)); got != tt.want {
				t.Errorf("extractTimezone(%q) = %q, want %q", tt.body, got, tt.want)
			}
		})
	}
}
