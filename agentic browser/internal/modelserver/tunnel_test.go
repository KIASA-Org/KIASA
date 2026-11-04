package modelserver

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

func TestTunnelAddress(t *testing.T) {
	cases := map[string]string{
		"2026-11-04 INF |  https://calm-river-12.trycloudflare.com                 |": "https://calm-river-12.trycloudflare.com",
		"Requesting new quick Tunnel on https://api.trycloudflare.com...":             "",
		"https://developers.cloudflare.com/cloudflare-one/connections":                "",
		"https://evil.example/https.trycloudflare.com":                                "",
		"nothing here": "",
	}
	for line, want := range cases {
		if got := tunnelAddress(line); got != want {
			t.Errorf("tunnelAddress(%q) = %q, want %q", line, got, want)
		}
	}
}

// TestFakeCloudflared is not a test: it is what the next test runs in cloudflared's place.
func TestFakeCloudflared(t *testing.T) {
	if os.Getenv("KIASA_FAKE_CLOUDFLARED") == "" {
		t.Skip("only for the test below")
	}
	fmt.Fprintln(os.Stderr, "Requesting new quick Tunnel on https://api.trycloudflare.com...")
	fmt.Fprintf(os.Stderr, "| %s |\n", os.Getenv("KIASA_FAKE_CLOUDFLARED"))
	fmt.Fprintln(os.Stderr, "| https://second-line-is-ignored.trycloudflare.com |")
	time.Sleep(100 * time.Millisecond)
	os.Exit(1)
}

func TestRunTunnel_ReportsItsAddressAndReopensWhenItCloses(t *testing.T) {
	saved, savedAfter := tunnelArgs, tunnelRestartAfter
	tunnelArgs = func(string) []string { return []string{"-test.run=TestFakeCloudflared$"} }
	tunnelRestartAfter = 20 * time.Millisecond
	t.Setenv("KIASA_FAKE_CLOUDFLARED", "https://calm-river-12.trycloudflare.com")
	defer func() { tunnelArgs, tunnelRestartAfter = saved, savedAfter }()

	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var seen []string
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		RunTunnel(ctx, self, "http://127.0.0.1:1", func(address string) {
			mu.Lock()
			defer mu.Unlock()
			seen = append(seen, address)
			if len(seen) >= 4 {
				cancel()
			}
		})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		cancel()
		t.Fatal("the tunnel never reopened")
	}
	mu.Lock()
	defer mu.Unlock()
	want := []string{"https://calm-river-12.trycloudflare.com", "", "https://calm-river-12.trycloudflare.com", ""}
	for i, address := range want {
		if i >= len(seen) || seen[i] != address {
			t.Fatalf("seen = %q, want it to start %q", seen, want)
		}
	}
}

func TestRunTunnel_CarriesOnWhenCloudflaredIsMissing(t *testing.T) {
	savedAfter := tunnelRestartAfter
	tunnelRestartAfter = 10 * time.Millisecond
	defer func() { tunnelRestartAfter = savedAfter }()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	calls := 0
	RunTunnel(ctx, `C:\nowhere\cloudflared.exe`, "http://127.0.0.1:1", func(address string) {
		calls++
		if address != "" {
			t.Errorf("address = %q", address)
		}
	})
	if calls < 2 {
		t.Errorf("it should keep trying: %d", calls)
	}
}
