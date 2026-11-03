package browser

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// These tests cover the parts of the stealth layer that need no browser.

func prefsFile(profile string) string {
	return filepath.Join(profile, "Default", "Preferences")
}

func readPrefs(t *testing.T, profile string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(prefsFile(profile))
	if err != nil {
		t.Fatalf("reading preferences: %v", err)
	}
	var prefs map[string]any
	if err := json.Unmarshal(data, &prefs); err != nil {
		t.Fatalf("preferences are not valid JSON: %v\n%s", err, data)
	}
	return prefs
}

func writePrefs(t *testing.T, profile, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(prefsFile(profile)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(prefsFile(profile), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func policyOf(prefs map[string]any) any {
	webrtc, _ := prefs["webrtc"].(map[string]any)
	return webrtc["ip_handling_policy"]
}

func TestSetWebRTCPolicy_NewProfileWithProxy(t *testing.T) {
	profile := t.TempDir()

	if err := setWebRTCPolicy(profile, true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := policyOf(readPrefs(t, profile)); got != "disable_non_proxied_udp" {
		t.Errorf("policy = %v, want disable_non_proxied_udp", got)
	}
}

func TestSetWebRTCPolicy_NewProfileWithoutProxyIsLeftAlone(t *testing.T) {
	profile := t.TempDir()

	if err := setWebRTCPolicy(profile, false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := os.Stat(prefsFile(profile)); !os.IsNotExist(err) {
		t.Errorf("a profile that was never used should not get a preferences file (stat error: %v)", err)
	}
}

func TestSetWebRTCPolicy_KeepsEverythingElseExactly(t *testing.T) {
	profile := t.TempDir()
	// A 20-digit integer would lose digits if it passed through a float64.
	writePrefs(t, profile, `{"big":12345678901234567890,"nested":{"keep":[1,2,3],"flag":true},"webrtc":{"other":"x"}}`)

	if err := setWebRTCPolicy(profile, true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	raw, _ := os.ReadFile(prefsFile(profile))
	if !strings.Contains(string(raw), `"big":12345678901234567890`) {
		t.Errorf("a large integer was altered: %s", raw)
	}
	prefs := readPrefs(t, profile)
	if got := policyOf(prefs); got != "disable_non_proxied_udp" {
		t.Errorf("policy = %v", got)
	}
	if webrtc := prefs["webrtc"].(map[string]any); webrtc["other"] != "x" {
		t.Errorf("a neighbouring webrtc setting was lost: %v", webrtc)
	}
	nested := prefs["nested"].(map[string]any)
	if nested["flag"] != true || len(nested["keep"].([]any)) != 3 {
		t.Errorf("other settings changed: %v", nested)
	}
}

func TestSetWebRTCPolicy_DirectConnectionRestoresTheDefault(t *testing.T) {
	profile := t.TempDir()
	writePrefs(t, profile, `{"webrtc":{"ip_handling_policy":"disable_non_proxied_udp"},"other":1}`)

	if err := setWebRTCPolicy(profile, false); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	prefs := readPrefs(t, profile)
	if got := policyOf(prefs); got != "default" {
		t.Errorf("policy = %v, want default so that WebRTC works without a proxy", got)
	}
	if prefs["other"] == nil {
		t.Error("another setting was lost")
	}
}

func TestSetWebRTCPolicy_AlreadyRightIsNotRewritten(t *testing.T) {
	profile := t.TempDir()
	const original = `{"webrtc":{"ip_handling_policy":"disable_non_proxied_udp"}, "spacing": "kept"}`
	writePrefs(t, profile, original)

	if err := setWebRTCPolicy(profile, true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if raw, _ := os.ReadFile(prefsFile(profile)); string(raw) != original {
		t.Errorf("the file was rewritten although the policy was already right:\n%s", raw)
	}
}

func TestSetWebRTCPolicy_CorruptPreferencesFailClosed(t *testing.T) {
	profile := t.TempDir()
	const corrupt = `{"webrtc": {"ip_handling_poli`
	writePrefs(t, profile, corrupt)

	err := setWebRTCPolicy(profile, true)
	if err == nil {
		t.Fatal("expected an error, so that the browser is not launched without the restriction")
	}
	if raw, _ := os.ReadFile(prefsFile(profile)); string(raw) != corrupt {
		t.Errorf("the corrupt file must be left untouched, got %q", raw)
	}
	if _, err := os.Stat(prefsFile(profile) + ".tmp"); !os.IsNotExist(err) {
		t.Error("a temporary file was left behind")
	}
}

func TestIgnoredDefaultArgs(t *testing.T) {
	headed := ignoredDefaultArgs(false)
	headless := ignoredDefaultArgs(true)

	for _, arg := range []string{
		"--disable-popup-blocking",
		"--disable-extensions",
		"--disable-component-extensions-with-background-pages",
		"--disable-component-update",
	} {
		if !slices.Contains(headed, arg) || !slices.Contains(headless, arg) {
			t.Errorf("%s should be ignored in both modes", arg)
		}
	}
	if slices.Contains(headed, "--hide-scrollbars") {
		t.Error("--hide-scrollbars is only a headless switch")
	}
	if !slices.Contains(headless, "--hide-scrollbars") {
		t.Error("headless Chromium hides scrollbars unless that switch is ignored")
	}
}

func TestBrowserChannel(t *testing.T) {
	for _, explicit := range []string{"chrome", "chromium"} {
		if got := browserChannel(explicit); got != explicit {
			t.Errorf("browserChannel(%q) = %q, an explicit choice must be kept", explicit, got)
		}
	}
	for _, auto := range []string{"", "auto", "firefox", "Chrome"} {
		if got := browserChannel(auto); got != "chrome" && got != "chromium" {
			t.Errorf("browserChannel(%q) = %q, want chrome or chromium", auto, got)
		}
	}
}
