package proxy

import (
	"bufio"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

const testLogin = "user:s3cret"

func basicLogin(login string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(login))
}

// rawProxy is a stand-in for the real proxy. It records every request head exactly
// as received and hands each connection to the given function.
type rawProxy struct {
	ln    net.Listener
	mu    sync.Mutex
	heads []string
}

func startRawProxy(t *testing.T, serve func(p *rawProxy, c net.Conn, r *bufio.Reader)) *rawProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &rawProxy{ln: ln}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				serve(p, c, bufio.NewReader(c))
			}()
		}
	}()
	return p
}

func (p *rawProxy) readHead(r *bufio.Reader) (string, error) {
	head, err := readHead(r)
	if err != nil {
		return "", err
	}
	p.mu.Lock()
	p.heads = append(p.heads, string(head))
	p.mu.Unlock()
	return string(head), nil
}

func (p *rawProxy) received() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.heads...)
}

func startForwarder(t *testing.T, p *rawProxy) *Forwarder {
	t.Helper()
	f, err := NewForwarder("http://" + testLogin + "@" + p.ln.Addr().String())
	if err != nil {
		t.Fatalf("NewForwarder: %v", err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func dialForwarder(t *testing.T, f *Forwarder) (net.Conn, *bufio.Reader) {
	t.Helper()
	c, err := net.Dial("tcp", strings.TrimPrefix(f.URL(), "http://"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	c.SetDeadline(time.Now().Add(10 * time.Second))
	return c, bufio.NewReader(c)
}

func TestForwarder_ListensOnlyOnThisComputer(t *testing.T) {
	p := startRawProxy(t, func(*rawProxy, net.Conn, *bufio.Reader) {})
	f := startForwarder(t, p)
	if !strings.HasPrefix(f.URL(), "http://127.0.0.1:") {
		t.Errorf("URL = %q, want an address on 127.0.0.1", f.URL())
	}
	if strings.Contains(f.URL(), "s3cret") {
		t.Errorf("URL %q contains the password", f.URL())
	}
}

func TestForwarder_TunnelAddsTheLoginAndCarriesBytesBothWays(t *testing.T) {
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		if _, err := p.readHead(r); err != nil {
			return
		}
		io.WriteString(c, "HTTP/1.1 200 Connection established\r\n\r\n")
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		io.WriteString(c, "echo:"+line)
	})
	f := startForwarder(t, p)
	c, r := dialForwarder(t, f)

	const request = "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Connection: keep-alive\r\nUser-Agent: Chrome\r\n\r\n"
	io.WriteString(c, request)
	status, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(status, "200") {
		t.Fatalf("status line = %q", status)
	}
	if _, err := readHead(r); err != nil { // the rest of the response head
		t.Fatal(err)
	}

	io.WriteString(c, "hello\n")
	echo, err := r.ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	if echo != "echo:hello\n" {
		t.Errorf("tunnel returned %q", echo)
	}

	heads := p.received()
	if len(heads) != 1 {
		t.Fatalf("the proxy received %d heads", len(heads))
	}
	want := "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nProxy-Connection: keep-alive\r\nUser-Agent: Chrome\r\nProxy-Authorization: " + basicLogin(testLogin) + "\r\n\r\n"
	if heads[0] != want {
		t.Errorf("the proxy received:\n%q\nwant:\n%q", heads[0], want)
	}
}

func TestForwarder_ClientLoginIsReplaced(t *testing.T) {
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		p.readHead(r)
		io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
	})
	f := startForwarder(t, p)
	c, r := dialForwarder(t, f)

	io.WriteString(c, "CONNECT a.test:443 HTTP/1.1\r\nproxy-authorization: Basic wrong\r\n\r\n")
	if _, err := readHead(r); err != nil {
		t.Fatal(err)
	}
	head := p.received()[0]
	if strings.Contains(head, "wrong") {
		t.Errorf("the client's login was passed on: %q", head)
	}
	if strings.Count(strings.ToLower(head), "proxy-authorization:") != 1 {
		t.Errorf("expected exactly one login in %q", head)
	}
}

func TestForwarder_RefusedLoginBecomesAFailedTunnel(t *testing.T) {
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		p.readHead(r)
		io.WriteString(c, "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"x\"\r\n\r\n")
	})
	f := startForwarder(t, p)
	c, r := dialForwarder(t, f)

	io.WriteString(c, "CONNECT a.test:443 HTTP/1.1\r\n\r\n")
	head, err := readHead(r)
	if err != nil {
		t.Fatal(err)
	}
	if status := statusOf(head); status != http.StatusBadGateway {
		t.Errorf("status = %d, want 502 so the browser does not ask for a password", status)
	}
	if strings.Contains(string(head), "Proxy-Authenticate") {
		t.Errorf("the login challenge reached the browser: %q", head)
	}
}

func TestForwarder_OtherTunnelFailuresArePassedOn(t *testing.T) {
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		p.readHead(r)
		io.WriteString(c, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
	})
	f := startForwarder(t, p)
	c, r := dialForwarder(t, f)

	io.WriteString(c, "CONNECT a.test:443 HTTP/1.1\r\n\r\n")
	head, err := readHead(r)
	if err != nil {
		t.Fatal(err)
	}
	if status := statusOf(head); status != http.StatusForbidden {
		t.Errorf("status = %d, want 403", status)
	}
}

func TestForwarder_SilentProxyBecomesAFailedTunnel(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		p.readHead(r)
		<-release // takes the request and never answers
	})
	f, err := newForwarder("http://"+testLogin+"@"+p.ln.Addr().String(), 100*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	c, r := dialForwarder(t, f)

	io.WriteString(c, "CONNECT a.test:443 HTTP/1.1\r\n\r\n")
	head, err := readHead(r)
	if err != nil {
		t.Fatalf("no answer from the forwarder: %v", err)
	}
	if status := statusOf(head); status != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", status)
	}
}

func TestForwarder_LetsGoOfATunnelTheProxyNeverHangsUp(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		p.readHead(r)
		io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
		<-release // never hangs up, even after the browser has left
	})
	f, err := newForwarder("http://"+testLogin+"@"+p.ln.Addr().String(), 100*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	c, r := dialForwarder(t, f)

	io.WriteString(c, "CONNECT a.test:443 HTTP/1.1\r\n\r\n")
	if _, err := readHead(r); err != nil {
		t.Fatal(err)
	}
	// The tunnel must outlast the limit while the browser is still connected.
	time.Sleep(300 * time.Millisecond)
	f.mu.Lock()
	open := len(f.conns)
	f.mu.Unlock()
	if open != 2 {
		t.Errorf("%d connections tracked while the tunnel is in use, want 2", open)
	}

	c.Close()
	deadline := time.Now().Add(5 * time.Second)
	for {
		f.mu.Lock()
		open = len(f.conns)
		f.mu.Unlock()
		if open == 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d connections still held after the browser left", open)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestForwarder_PlainRequestsOnOneConnectionAllGetTheLogin(t *testing.T) {
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		for {
			head, err := p.readHead(r)
			if err != nil {
				return
			}
			if err := copyBody(io.Discard, r, []byte(head)); err != nil {
				return
			}
			io.WriteString(c, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
		}
	})
	f := startForwarder(t, p)
	c, r := dialForwarder(t, f)

	readResponse := func() {
		t.Helper()
		resp, err := http.ReadResponse(r, nil)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if string(body) != "ok" {
			t.Errorf("body = %q", body)
		}
	}

	// Header case and order must survive, because the site sees them.
	const first = "GET http://a.test/1 HTTP/1.1\r\nHost: a.test\r\nProxy-Connection: keep-alive\r\nsec-ch-ua: \"x\"\r\nUser-Agent: Chrome\r\n\r\n"
	io.WriteString(c, first)
	readResponse()
	io.WriteString(c, "POST http://a.test/2 HTTP/1.1\r\nHost: a.test\r\nContent-Length: 5\r\n\r\nhello")
	readResponse()
	io.WriteString(c, "POST http://a.test/3 HTTP/1.1\r\nHost: a.test\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n")
	readResponse()
	io.WriteString(c, "GET http://a.test/4 HTTP/1.1\r\nHost: a.test\r\n\r\n")
	readResponse()

	heads := p.received()
	if len(heads) != 4 {
		t.Fatalf("the proxy received %d requests, want 4: %q", len(heads), heads)
	}
	for i, head := range heads {
		if !strings.Contains(head, "Proxy-Authorization: "+basicLogin(testLogin)+"\r\n") {
			t.Errorf("request %d has no login: %q", i+1, head)
		}
	}
	want := strings.TrimSuffix(first, "\r\n") + "Proxy-Authorization: " + basicLogin(testLogin) + "\r\n\r\n"
	if heads[0] != want {
		t.Errorf("first request changed:\n%q\nwant:\n%q", heads[0], want)
	}
}

// A web page can reach the local port directly, with a normal request instead of a
// proxy request. Its request must not go to the real proxy with the login attached,
// and malformed input such as a lone blank line must not bring the program down.
func TestForwarder_RefusesRequestsNotMeantForAProxy(t *testing.T) {
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) { p.readHead(r) })
	f := startForwarder(t, p)

	for _, request := range []string{
		"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
		"GET /path?x=http://a.test/ HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
		"\r\n",
		"\n",
		"nonsense\r\n\r\n",
	} {
		c, r := dialForwarder(t, f)
		io.WriteString(c, request)
		resp, err := http.ReadResponse(r, nil)
		if err != nil {
			t.Errorf("request %q: no response: %v", request, err)
			continue
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("request %q: status %d, want %d", request, resp.StatusCode, http.StatusBadRequest)
		}
	}

	if heads := p.received(); len(heads) != 0 {
		t.Errorf("these reached the real proxy: %q", heads)
	}
}

func TestForwarder_BadRequestAfterAGoodOneEndsTheConnection(t *testing.T) {
	for _, bad := range []string{"\r\n", "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n", "CONNECT a.test:443 HTTP/1.1\r\nHost: a.test:443\r\n\r\n"} {
		p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
			for {
				if _, err := p.readHead(r); err != nil {
					return
				}
				io.WriteString(c, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
			}
		})
		f := startForwarder(t, p)
		c, r := dialForwarder(t, f)

		io.WriteString(c, "GET http://a.test/1 HTTP/1.1\r\nHost: a.test\r\n\r\n")
		resp, err := http.ReadResponse(r, nil)
		if err != nil {
			t.Fatalf("the good request failed: %v", err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		io.WriteString(c, bad)
		if rest, err := io.ReadAll(r); err != nil || len(rest) != 0 {
			t.Errorf("after %q: read %q, err %v; want the connection closed", bad, rest, err)
		}
		if heads := p.received(); len(heads) != 1 {
			t.Errorf("after %q: the real proxy received %q, want only the good request", bad, heads)
		}
	}
}

func TestForwarder_UnreachableProxyIsABadGateway(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := ln.Addr().String()
	ln.Close() // nothing listens on this port any more

	f, err := NewForwarder("http://" + testLogin + "@" + address)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	c, r := dialForwarder(t, f)

	io.WriteString(c, "CONNECT a.test:443 HTTP/1.1\r\n\r\n")
	head, err := readHead(r)
	if err != nil {
		t.Fatal(err)
	}
	if status := statusOf(head); status != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", status)
	}
}

func TestForwarder_CloseEndsOpenTunnelsAndIsRepeatable(t *testing.T) {
	p := startRawProxy(t, func(p *rawProxy, c net.Conn, r *bufio.Reader) {
		p.readHead(r)
		io.WriteString(c, "HTTP/1.1 200 OK\r\n\r\n")
		io.Copy(io.Discard, r) // keep the tunnel open until it is closed
	})
	f := startForwarder(t, p)
	c, r := dialForwarder(t, f)
	io.WriteString(c, "CONNECT a.test:443 HTTP/1.1\r\n\r\n")
	if _, err := readHead(r); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() { done <- f.Close() }()
	select {
	case err := <-done:
		if err != nil {
			t.Errorf("Close: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not return while a tunnel was open")
	}
	if _, err := r.ReadByte(); err == nil {
		t.Error("the tunnel stayed open after Close")
	}
	if err := f.Close(); err != nil {
		t.Errorf("second Close: %v", err)
	}
	if _, err := net.DialTimeout("tcp", strings.TrimPrefix(f.URL(), "http://"), time.Second); err == nil {
		t.Error("the port still accepts connections after Close")
	}
}

func TestNewForwarder_LoginEncoding(t *testing.T) {
	tests := []struct {
		name, proxyLogin, want string
	}{
		{"plain", "user:pass", "user:pass"},
		{"percent-encoded", "us%40er:p%3Ass%2F", "us@er:p:ss/"},
		{"username only", "onlyuser", "onlyuser:"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := NewForwarder("http://" + tt.proxyLogin + "@127.0.0.1:1")
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			if f.login != basicLogin(tt.want) {
				t.Errorf("login = %q, want Basic for %q", f.login, tt.want)
			}
		})
	}
}

func TestNewForwarder_DefaultPorts(t *testing.T) {
	tests := []struct{ proxyURL, want string }{
		{"http://u:p@proxy.example", "proxy.example:80"},
		{"https://u:p@proxy.example", "proxy.example:443"},
		{"http://u:p@proxy.example:8080", "proxy.example:8080"},
	}
	for _, tt := range tests {
		f, err := NewForwarder(tt.proxyURL)
		if err != nil {
			t.Fatal(err)
		}
		if f.address != tt.want {
			t.Errorf("%s: address = %q, want %q", tt.proxyURL, f.address, tt.want)
		}
		f.Close()
	}
}

func TestNewForwarder_InvalidInput(t *testing.T) {
	const secretValue = "s3cr%et"
	tests := []struct {
		name, proxyURL, wantErr string
	}{
		{"empty", "", "invalid proxy URL"},
		{"no host", "http://u:p@", "invalid proxy URL"},
		{"no port host", "http://u:p@:8080", "invalid proxy URL"},
		{"socks5", "socks5://u:p@127.0.0.1:1", "cannot forward"},
		{"no login", "http://127.0.0.1:1", "no login"},
		{"unparseable with credentials", "http://user:" + secretValue + "@proxy.example:8080", "invalid proxy URL"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := NewForwarder(tt.proxyURL)
			if err == nil {
				f.Close()
				t.Fatal("expected an error")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %v, want it to contain %q", err, tt.wantErr)
			}
			if strings.Contains(err.Error(), secretValue) {
				t.Errorf("error leaks the password: %v", err)
			}
		})
	}
}
