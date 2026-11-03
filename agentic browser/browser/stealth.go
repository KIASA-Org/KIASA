package browser

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/mxschmitt/playwright-go"
)

// Each function here removes one way for a page to tell the browser is
// automated. All of them came from comparing the automated browser with a real,
// hand-launched Google Chrome on the same machine: a difference a page can
// observe gets a function, and anything it cannot observe is left alone.

// customChannel is what Engine.Channel reports for a browser given by file.
const customChannel = "custom"

// browserChannel picks the browser to drive. An installed Google Chrome is
// preferred because it is what real visitors run: it reports the "Google Chrome"
// brand in its client hints and has Widevine, and plain Chromium has neither.
func browserChannel(requested string) string {
	switch requested {
	case "chrome", "chromium":
		return requested
	}
	if chromeInstalled() {
		return "chrome"
	}
	return "chromium"
}

func chromeInstalled() bool {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		for _, env := range []string{"ProgramFiles", "ProgramFiles(x86)", "LocalAppData"} {
			if base := os.Getenv(env); base != "" {
				candidates = append(candidates, filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
			}
		}
	case "darwin":
		candidates = []string{"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
	default:
		candidates = []string{"/opt/google/chrome/chrome", "/usr/bin/google-chrome"}
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return true
		}
	}
	return false
}

// ignoredDefaultArgs lists the switches Playwright adds on its own that change
// what a page can observe.
func ignoredDefaultArgs(headless bool) []string {
	ignored := []string{
		// window.open() without a user gesture succeeds, where Chrome blocks it.
		"--disable-popup-blocking",
		// Without these three Chrome loses its built-in speech voices (3 instead
		// of 19) and Widevine, and a page can query both.
		"--disable-extensions",
		"--disable-component-extensions-with-background-pages",
		"--disable-component-update",
	}
	if headless {
		// Headless Chromium hides scrollbars, so a page measures a scrollbar
		// width of 0 where Chrome has 15.
		ignored = append(ignored, "--hide-scrollbars")
	}
	return ignored
}

// setWebRTCPolicy decides whether WebRTC may use addresses other than the
// proxy's. Left alone it sends UDP straight to the internet, which reveals the
// real address behind a proxy, so with a proxy the profile is told to use only
// proxied connections, and without one it goes back to the default. The
// --force-webrtc-ip-handling-policy switch cannot be used for this: it only works
// in the headless shell, and does nothing in the full browser. The profile
// preference is what Chrome's own policy sets, so it is written into the profile
// before launch.
func setWebRTCPolicy(profilePath string, proxied bool) error {
	policy := "default"
	if proxied {
		policy = "disable_non_proxied_udp"
	}
	prefsPath := filepath.Join(profilePath, "Default", "Preferences")

	prefs := map[string]any{}
	data, err := os.ReadFile(prefsPath)
	switch {
	case errors.Is(err, os.ErrNotExist):
		if !proxied {
			return nil // nothing to undo in a profile that has never been used
		}
	case err != nil:
		return err
	case len(bytes.TrimSpace(data)) > 0:
		// UseNumber keeps large integers exactly as Chrome wrote them.
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		if err := decoder.Decode(&prefs); err != nil {
			return fmt.Errorf("reading %s: %w", prefsPath, err)
		}
	}

	webrtc, _ := prefs["webrtc"].(map[string]any)
	current, _ := webrtc["ip_handling_policy"].(string)
	if current == policy || (current == "" && policy == "default") {
		return nil
	}
	if webrtc == nil {
		webrtc = map[string]any{}
	}
	webrtc["ip_handling_policy"] = policy
	prefs["webrtc"] = webrtc

	out, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(prefsPath), 0o755); err != nil {
		return err
	}
	// Write beside the file and rename, so a crash cannot leave half a file.
	tmp := prefsPath + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, prefsPath)
}

// headlessUserAgent returns the user agent headless Chrome should send: its
// own, without "Headless". It is read from a short-lived browser, so the version
// and platform always match the installed build and the client hints (which the
// browser sets by itself) keep agreeing with it. It returns "" when there is
// nothing to remove.
func (e *Engine) headlessUserAgent(channel, executable string) (string, error) {
	options := playwright.BrowserTypeLaunchOptions{
		Headless:        playwright.Bool(true),
		ChromiumSandbox: playwright.Bool(true),
	}
	if executable != "" {
		options.ExecutablePath = playwright.String(executable)
	} else {
		options.Channel = playwright.String(channel)
	}
	browser, err := e.pw.Chromium.Launch(options)
	if err != nil {
		return "", err
	}
	defer browser.Close()

	page, err := browser.NewPage()
	if err != nil {
		return "", err
	}
	value, err := page.Evaluate("navigator.userAgent")
	if err != nil {
		return "", err
	}
	userAgent, _ := value.(string)
	if !strings.Contains(userAgent, "HeadlessChrome") {
		return "", nil
	}
	return strings.Replace(userAgent, "HeadlessChrome", "Chrome", 1), nil
}
