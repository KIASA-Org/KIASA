package proxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	_ "time/tzdata" // lets time.LoadLocation check zone names on a machine with no zoneinfo database
)

// geoEndpoints are asked in turn, through the proxy, which time zone the
// proxy's exit address is in. They answer with JSON that has a "timezone" field.
var geoEndpoints = []string{
	"https://ipwho.is/",
	"https://ipapi.co/json/",
	"http://ip-api.com/json/?fields=status,timezone",
}

// geoOverrideEnv names an environment variable holding the URL of a service of
// your own (same JSON shape), used instead of the public ones.
const geoOverrideEnv = "STEALTH_GEO_URL"

// geoTimeout limits each service. A failed lookup only leads to a warning, so it is
// not worth holding up the start for long.
const geoTimeout = 10 * time.Second

// LookupTimezone returns the IANA time zone of the address the proxy exits from.
// A browser whose time zone disagrees with its IP address is easy to spot, so
// the browser is given this zone. The lookup goes through the proxy, so the
// service only ever sees the proxy's address.
func LookupTimezone(proxyURL string) (string, error) {
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
		Timeout: geoTimeout,
	}

	endpoints := geoEndpoints
	if custom := strings.TrimSpace(os.Getenv(geoOverrideEnv)); custom != "" {
		endpoints = []string{custom}
	}

	var lastErr error
	for _, endpoint := range endpoints {
		zone, err := fetchTimezone(client, endpoint)
		if err == nil {
			return zone, nil
		}
		lastErr = err
	}
	return "", fmt.Errorf("no geolocation service answered: %w", lastErr)
}

func fetchTimezone(client *http.Client, endpoint string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "stealth-app")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s answered with status %d", req.URL.Host, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return "", err
	}
	zone := extractTimezone(body)
	if zone == "" {
		return "", fmt.Errorf("%s did not return a time zone", req.URL.Host)
	}
	if _, err := time.LoadLocation(zone); err != nil {
		return "", fmt.Errorf("%s returned an unknown time zone %q", req.URL.Host, zone)
	}
	return zone, nil
}

// extractTimezone reads the zone name from either of the shapes the services
// use: {"timezone": "Europe/Berlin"} or {"timezone": {"id": "Europe/Berlin"}}.
func extractTimezone(body []byte) string {
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		return ""
	}
	switch tz := doc["timezone"].(type) {
	case string:
		return strings.TrimSpace(tz)
	case map[string]any:
		for _, key := range []string{"id", "name"} {
			if s, ok := tz[key].(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}
