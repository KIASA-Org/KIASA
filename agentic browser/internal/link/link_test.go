package link

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
