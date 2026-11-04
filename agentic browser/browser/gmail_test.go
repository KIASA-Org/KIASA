package browser

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/mxschmitt/playwright-go"
)

// openPage starts a real Chrome and a page at the given origin. Without the driver, it skips.
func openPage(t *testing.T, origin string) playwright.Page {
	t.Helper()
	driver := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "driver")
	if _, err := os.Stat(driver); err != nil {
		t.Skip("the browser driver is not on this computer")
	}
	pw, err := playwright.Run(&playwright.RunOptions{DriverDirectory: driver, SkipInstallBrowsers: true})
	if err != nil {
		t.Skipf("could not start the driver: %v", err)
	}
	t.Cleanup(func() { pw.Stop() })
	chrome, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{Channel: playwright.String("chrome"), Headless: playwright.Bool(true)})
	if err != nil {
		t.Skipf("could not start Chrome: %v", err)
	}
	t.Cleanup(func() { chrome.Close() })
	page, err := chrome.NewPage()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := page.Goto(origin); err != nil {
		t.Fatal(err)
	}
	return page
}

func TestFetchInPage_RunsRequestsInsideTheBrowser(t *testing.T) {
	var gotAuth, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			w.Write([]byte("ok"))
		case "/json":
			gotAuth = r.Header.Get("Authorization")
			w.Write([]byte(`{"ok":true,"who":"me"}`))
		case "/echo":
			body, _ := io.ReadAll(r.Body)
			gotBody = string(body)
			w.WriteHeader(201)
			w.Write([]byte("thanks"))
		case "/missing":
			w.WriteHeader(404)
			w.Write([]byte(`{"error":"not found"}`))
		default:
			w.WriteHeader(500)
		}
	}))
	defer server.Close()

	page := openPage(t, server.URL) // same origin, so the fetches are same-origin

	status, body, err := fetchInPage(page, "GET", server.URL+"/json", map[string]string{"Authorization": "Bearer abc"}, nil)
	if err != nil || status != 200 || string(body) != `{"ok":true,"who":"me"}` {
		t.Fatalf("GET: %d, %q, %v", status, body, err)
	}
	if gotAuth != "Bearer abc" {
		t.Errorf("the Authorization header did not arrive: %q", gotAuth)
	}

	status, body, err = fetchInPage(page, "POST", server.URL+"/echo", nil, map[string]string{"grant_type": "refresh_token", "code": "a b&c"})
	if err != nil || status != 201 || string(body) != "thanks" {
		t.Fatalf("POST: %d, %q, %v", status, body, err)
	}
	// The order of the fields does not matter, only that they are urlencoded.
	if !strings.Contains(gotBody, "grant_type=refresh_token") || !strings.Contains(gotBody, "code=a+b%26c") {
		t.Errorf("the form was not sent urlencoded: %q", gotBody)
	}

	status, _, err = fetchInPage(page, "GET", server.URL+"/missing", nil, nil)
	if err != nil || status != 404 {
		t.Errorf("a 404 should come back as a status, not an error: %d, %v", status, err)
	}
}
