package proxy

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// testCheckURL uses the reserved .invalid TLD, which never resolves. A request
// can only get a response by going through the mock proxy, and no test depends
// on the real network.
const testCheckURL = "http://check.invalid/ip"

// startMockProxy runs a local server that acts as the HTTP proxy and answers
// the check request itself. It returns the proxy URL to pass to ValidateProxy.
// checkURL is a package variable, so tests using this helper must not run in
// parallel.
func startMockProxy(t *testing.T, status int, body string) string {
	t.Helper()

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A request sent through a proxy carries the absolute target URL.
		if got := r.URL.String(); got != testCheckURL {
			t.Errorf("proxy received request for %q, want %q", got, testCheckURL)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		w.Write([]byte(body))
	}))
	t.Cleanup(ts.Close)

	setCheckURL(t, testCheckURL)

	return ts.URL
}

// setCheckURL overrides checkURL for the duration of a test.
func setCheckURL(t *testing.T, url string) {
	t.Helper()

	origURL := checkURL
	checkURL = url
	t.Cleanup(func() { checkURL = origURL })
}

func TestValidateProxy_DirectConnection(t *testing.T) {
	// Testing empty string (Direct Connection)
	ip, err := ValidateProxy("")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if ip != "Direct Connection" {
		t.Errorf("expected 'Direct Connection', got: %s", ip)
	}
}

func TestValidateProxy_WhitespaceIsDirectConnection(t *testing.T) {
	ip, err := ValidateProxy("   ")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if ip != "Direct Connection" {
		t.Errorf("expected 'Direct Connection', got: %s", ip)
	}
}

func TestValidateProxy_InvalidScheme(t *testing.T) {
	// Testing invalid scheme rejection
	_, err := ValidateProxy("ftp://127.0.0.1:8080")
	if err == nil {
		t.Error("expected error for invalid scheme, got nil")
	}
}

func TestValidateProxy_SuccessfulResponse(t *testing.T) {
	proxyURL := startMockProxy(t, http.StatusOK, `{"origin": "198.51.100.42"}`)

	ip, err := ValidateProxy(proxyURL)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip != "198.51.100.42" {
		t.Errorf("expected 198.51.100.42, got %q", ip)
	}
}

func TestValidateProxy_Non200Status(t *testing.T) {
	for _, status := range []int{http.StatusForbidden, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			// The body is valid, so only the status check can reject this response.
			proxyURL := startMockProxy(t, status, `{"origin": "198.51.100.42"}`)

			ip, err := ValidateProxy(proxyURL)
			if err == nil {
				t.Fatalf("expected error for status %d, got IP %q", status, ip)
			}
			if want := fmt.Sprintf("non-200 status: %d", status); !strings.Contains(err.Error(), want) {
				t.Errorf("expected error containing %q, got: %v", want, err)
			}
			if ip != "" {
				t.Errorf("expected empty IP, got %q", ip)
			}
		})
	}
}

func TestValidateProxy_InvalidPayload(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"missing origin", `{}`},
		{"other fields only", `{"ip": "198.51.100.42"}`},
		{"empty origin", `{"origin": ""}`},
		{"null origin", `{"origin": null}`},
		{"malformed JSON", `not json`},
		{"empty body", ``},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proxyURL := startMockProxy(t, http.StatusOK, tt.body)

			ip, err := ValidateProxy(proxyURL)
			if err == nil {
				t.Fatalf("expected error, got IP %q", ip)
			}
			if want := "invalid or empty IP response payload"; !strings.Contains(err.Error(), want) {
				t.Errorf("expected error containing %q, got: %v", want, err)
			}
		})
	}
}

func TestValidateProxy_Unreachable(t *testing.T) {
	setCheckURL(t, testCheckURL)

	ip, err := ValidateProxy("http://127.0.0.1:1")
	if err == nil {
		t.Fatalf("expected error for unreachable proxy, got IP %q", ip)
	}
	if want := "proxy connection check failed"; !strings.Contains(err.Error(), want) {
		t.Errorf("expected error containing %q, got: %v", want, err)
	}
}

func TestValidateProxy_Timeout(t *testing.T) {
	origTimeout := defaultTimeout
	defaultTimeout = 10 * time.Millisecond
	t.Cleanup(func() { defaultTimeout = origTimeout })

	// The response is valid, so without the shorter timeout this call would
	// succeed after the sleep instead of returning a timeout error.
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		w.Write([]byte(`{"origin": "198.51.100.42"}`))
	}))
	t.Cleanup(ts.Close)

	setCheckURL(t, ts.URL)

	start := time.Now()
	ip, err := ValidateProxy(ts.URL)
	t.Logf("returned after %v", time.Since(start))

	if err == nil {
		t.Fatalf("expected timeout error, got IP %q", ip)
	}
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Errorf("expected a timeout error, got: %v", err)
	}
}

func TestValidateProxy_InvalidProxyURL(t *testing.T) {
	const (
		invalidURL  = "invalid proxy URL or missing host"
		badScheme   = "unsupported proxy scheme"
		secretValue = "s3cr%et"
	)

	tests := []struct {
		name     string
		proxyURL string
		wantErr  string
	}{
		{"missing host with http scheme", "http://", invalidURL},
		{"missing host with socks5 scheme", "socks5://", invalidURL},
		{"missing scheme with IP and port", "127.0.0.1:8080", invalidURL},
		{"missing scheme with hostname and port", "localhost:8080", invalidURL},
		{"missing scheme with bare hostname", "proxy.example", invalidURL},
		{"missing scheme with host", "//proxy.example:8080", badScheme},
		{"unsupported scheme", "ftp://proxy.example:8080", badScheme},
		{"unparseable URL with credentials", "http://user:" + secretValue + "@proxy.example:8080", invalidURL},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ip, err := ValidateProxy(tt.proxyURL)
			if err == nil {
				t.Fatalf("expected error, got IP %q", ip)
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
