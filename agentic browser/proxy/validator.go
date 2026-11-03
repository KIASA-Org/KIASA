package proxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// unexported checkURL allows httptest overrides during unit testing
var checkURL = "https://httpbin.org/ip"

// unexported defaultTimeout allows shorter timeouts during unit testing.
// A failed check stops the program, and a working proxy can take a while to open a
// connection now and then (5 s or 25 s has been measured), so this is generous.
var defaultTimeout = 30 * time.Second

type ipResponse struct {
	Origin string `json:"origin"`
}

// ValidateProxy checks if a proxy server is reachable and returns the egress IP.
func ValidateProxy(proxyURL string) (string, error) {
	if strings.TrimSpace(proxyURL) == "" {
		return "Direct Connection", nil
	}

	parsedURL, err := url.Parse(proxyURL)
	if err != nil || parsedURL.Host == "" {
		return "", errors.New("invalid proxy URL or missing host")
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" && parsedURL.Scheme != "socks5" && parsedURL.Scheme != "socks5h" {
		return "", fmt.Errorf("unsupported proxy scheme: %s", parsedURL.Scheme)
	}

	client := &http.Client{
		Transport: &http.Transport{
			Proxy:             http.ProxyURL(parsedURL),
			DisableKeepAlives: true,
		},
		Timeout: defaultTimeout,
	}

	resp, err := client.Get(checkURL)
	if err != nil {
		return "", fmt.Errorf("proxy connection check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("proxy validation returned non-200 status: %d", resp.StatusCode)
	}

	var res ipResponse
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil || res.Origin == "" {
		return "", errors.New("proxy check failed: invalid or empty IP response payload")
	}

	return res.Origin, nil
}
