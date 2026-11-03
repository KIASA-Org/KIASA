package settings

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseProxy_TheWaysPeopleWriteIt(t *testing.T) {
	tests := []struct {
		text string
		want Proxy
	}{
		{"45.80.96.177:29842", Proxy{Enabled: true, Scheme: "http", Host: "45.80.96.177", Port: 29842}},
		{"  45.80.96.177:29842  ", Proxy{Enabled: true, Scheme: "http", Host: "45.80.96.177", Port: 29842}},
		{"45.80.96.177:29842:user:s3cret", Proxy{Enabled: true, Scheme: "http", Host: "45.80.96.177", Port: 29842, Username: "user", Password: "s3cret"}},
		{"45.80.96.177:29842:user:pa:ss", Proxy{Enabled: true, Scheme: "http", Host: "45.80.96.177", Port: 29842, Username: "user", Password: "pa:ss"}},
		{"user:s3cret@45.80.96.177:29842", Proxy{Enabled: true, Scheme: "http", Host: "45.80.96.177", Port: 29842, Username: "user", Password: "s3cret"}},
		{"http://user:s3cret@proxy.example.com:8080", Proxy{Enabled: true, Scheme: "http", Host: "proxy.example.com", Port: 8080, Username: "user", Password: "s3cret"}},
		{"https://user:p%40ss@proxy.example.com:443", Proxy{Enabled: true, Scheme: "https", Host: "proxy.example.com", Port: 443, Username: "user", Password: "p@ss"}},
		{"HTTP://proxy.example.com:8080", Proxy{Enabled: true, Scheme: "http", Host: "proxy.example.com", Port: 8080}},
		{"socks5://127.0.0.1:1080", Proxy{Enabled: true, Scheme: "socks5", Host: "127.0.0.1", Port: 1080}},
		{"socks5h://127.0.0.1:1080", Proxy{Enabled: true, Scheme: "socks5", Host: "127.0.0.1", Port: 1080}},
		{"http://[2001:db8::1]:8080", Proxy{Enabled: true, Scheme: "http", Host: "2001:db8::1", Port: 8080}},
	}
	for _, tt := range tests {
		t.Run(tt.text, func(t *testing.T) {
			got, err := ParseProxy(tt.text)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestParseProxy_Rejected(t *testing.T) {
	const secret = "s3cret-value"
	for _, text := range []string{
		"",
		"   ",
		"just-a-host",
		"1.2.3.4:abc",
		"1.2.3.4:0",
		"1.2.3.4:70000",
		"1.2.3.4:80:only-user",
		"1.2.3.4:80 extra",
		"ftp://1.2.3.4:21",
		"http://1.2.3.4",
		"socks5://user:" + secret + "@1.2.3.4:1080",
		"http://user:bad%zz" + secret + "@1.2.3.4:80",
		":8080",
	} {
		t.Run(text, func(t *testing.T) {
			if p, err := ParseProxy(text); err == nil {
				t.Fatalf("expected an error, got %+v", p)
			} else if strings.Contains(err.Error(), secret) {
				t.Errorf("the message repeats the password: %v", err)
			}
		})
	}
}

func TestProxyURL(t *testing.T) {
	tests := []struct {
		proxy Proxy
		want  string
	}{
		{Proxy{}, ""},
		{Proxy{Scheme: "http", Host: "1.2.3.4", Port: 80}, ""},
		{Proxy{Enabled: true, Scheme: "http", Host: "1.2.3.4", Port: 80}, "http://1.2.3.4:80"},
		{Proxy{Enabled: true, Scheme: "http", Host: "1.2.3.4", Port: 80, Username: "u", Password: "p@ss:w/rd"}, "http://u:p%40ss%3Aw%2Frd@1.2.3.4:80"},
		{Proxy{Enabled: true, Scheme: "http", Host: "2001:db8::1", Port: 80}, "http://[2001:db8::1]:80"},
	}
	for _, tt := range tests {
		if got := tt.proxy.URL(); got != tt.want {
			t.Errorf("%+v: got %q, want %q", tt.proxy, got, tt.want)
		}
	}
}

func TestParseThenURL_KeepsAwkwardPasswords(t *testing.T) {
	const awkward = "p@ss:w/rd?#%&"
	first := Proxy{Enabled: true, Scheme: "http", Host: "1.2.3.4", Port: 80, Username: "u", Password: awkward}
	again, err := ParseProxy(first.URL())
	if err != nil {
		t.Fatal(err)
	}
	if again != first {
		t.Errorf("got %+v, want %+v", again, first)
	}
}

func TestSaveAndLoad(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "settings.json")
	want := Settings{Proxy: Proxy{Enabled: true, Scheme: "http", Host: "1.2.3.4", Port: 80, Username: "user", Password: "s3cret-value"}}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestSave_ThePasswordIsNotReadableInTheFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	const secret = "s3cret-value"
	if err := Save(path, Settings{Proxy: Proxy{Enabled: true, Scheme: "http", Host: "1.2.3.4", Port: 80, Username: "user", Password: secret}}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), secret) {
		t.Errorf("the file contains the password: %s", data)
	}
	if _, err := os.Stat(path + ".tmp"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("a temporary file was left behind: %v", err)
	}
}

func TestSave_NoPasswordNoSealedField(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := Save(path, Settings{}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "sealedPassword") {
		t.Errorf("unexpected sealed field: %s", data)
	}
}

func TestLoad_NothingSavedYet(t *testing.T) {
	_, err := Load(filepath.Join(t.TempDir(), "settings.json"))
	if !errors.Is(err, ErrNotSet) {
		t.Errorf("got %v, want ErrNotSet", err)
	}
}

func TestLoad_DamagedFiles(t *testing.T) {
	dir := t.TempDir()
	for name, content := range map[string]string{
		"not-json.json":   "not json",
		"bad-sealed.json": `{"proxy":{"enabled":true,"sealedPassword":"AAAA"}}`,
	} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		_, err := Load(path)
		if err == nil || errors.Is(err, ErrNotSet) {
			t.Errorf("%s: got %v, want a real error", name, err)
		}
	}
}
