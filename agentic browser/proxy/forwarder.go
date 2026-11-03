package proxy

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// maxHeadSize limits one request or response head.
	maxHeadSize = 256 << 10
	// forwarderDialTimeout limits how long reaching the real proxy may take.
	forwarderDialTimeout = 30 * time.Second
	// forwarderWaitLimit limits how long the real proxy may stay silent while a tunnel
	// waits for its answer, and after the browser has left a tunnel.
	forwarderWaitLimit = 60 * time.Second
)

// Forwarder is a small proxy on this computer that passes everything on to a real
// proxy, adding that proxy's login to each request. The browser then talks to a
// proxy with no login.
//
// That matters because Playwright answers a proxy's login by intercepting every
// request the browser makes, and that interception loses a navigation that Chrome
// restarts. Chrome restarts navigations to sites that send an ACCEPT_CH frame, such
// as Google, so through a proxy with a login Google and Gmail never finish loading.
// Chrome's background requests also fail with a 407 that way.
type Forwarder struct {
	listener net.Listener
	upstream *url.URL
	address  string // host:port of the real proxy
	login    string // value of the Proxy-Authorization header

	waitLimit time.Duration

	mu     sync.Mutex
	conns  map[net.Conn]struct{}
	closed bool
	wg     sync.WaitGroup
}

// NewForwarder starts a Forwarder for an http or https proxy URL that contains a
// login. It listens on a free port of 127.0.0.1, so only this computer can use it.
func NewForwarder(proxyURL string) (*Forwarder, error) {
	return newForwarder(proxyURL, forwarderWaitLimit)
}

func newForwarder(proxyURL string, waitLimit time.Duration) (*Forwarder, error) {
	parsed, err := url.Parse(proxyURL)
	if err != nil || parsed.Hostname() == "" {
		// The parse error quotes the URL, which may contain the password.
		return nil, errors.New("invalid proxy URL or missing host")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("cannot forward to a proxy with scheme: %s", parsed.Scheme)
	}
	if parsed.User == nil {
		return nil, errors.New("proxy URL has no login to add")
	}

	port := parsed.Port()
	if port == "" {
		port = "80"
		if parsed.Scheme == "https" {
			port = "443"
		}
	}
	password, _ := parsed.User.Password()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	f := &Forwarder{
		listener:  listener,
		upstream:  parsed,
		address:   net.JoinHostPort(parsed.Hostname(), port),
		login:     "Basic " + base64.StdEncoding.EncodeToString([]byte(parsed.User.Username()+":"+password)),
		waitLimit: waitLimit,
		conns:     map[net.Conn]struct{}{},
	}
	f.wg.Add(1)
	go f.serve()
	return f, nil
}

// URL returns the address to give the browser as its proxy.
func (f *Forwarder) URL() string {
	return "http://" + f.listener.Addr().String()
}

// Close stops the Forwarder and every connection going through it. It is safe to
// call more than once.
func (f *Forwarder) Close() error {
	f.mu.Lock()
	if f.closed {
		f.mu.Unlock()
		return nil
	}
	f.closed = true
	conns := make([]net.Conn, 0, len(f.conns))
	for c := range f.conns {
		conns = append(conns, c)
	}
	f.mu.Unlock()

	err := f.listener.Close()
	for _, c := range conns {
		c.Close()
	}
	f.wg.Wait()
	return err
}

func (f *Forwarder) serve() {
	defer f.wg.Done()
	for {
		conn, err := f.listener.Accept()
		if err != nil {
			return
		}
		if !f.track(conn) {
			conn.Close()
			return
		}
		f.wg.Add(1)
		go func() {
			defer f.wg.Done()
			defer f.untrack(conn)
			defer conn.Close()
			f.handle(conn)
		}()
	}
}

func (f *Forwarder) track(c net.Conn) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false
	}
	f.conns[c] = struct{}{}
	return true
}

func (f *Forwarder) untrack(c net.Conn) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.conns, c)
}

func (f *Forwarder) handle(client net.Conn) {
	clientReader := bufio.NewReader(client)
	head, err := readHead(clientReader)
	if err != nil {
		return
	}
	connect := bytes.HasPrefix(head, []byte("CONNECT "))
	if !connect && !isPlainRequest(head) {
		// A browser talks to a proxy with CONNECT or a full URL. Anything else, such
		// as a web page that found this port, must not reach the real proxy with the
		// login attached.
		writeStatus(client, http.StatusBadRequest)
		return
	}

	upstream, err := f.dial()
	if err != nil {
		writeStatus(client, http.StatusBadGateway)
		return
	}
	if !f.track(upstream) {
		upstream.Close()
		return
	}
	defer f.untrack(upstream)
	defer upstream.Close()
	upstreamReader := bufio.NewReader(upstream)

	if connect {
		f.tunnel(client, clientReader, upstream, upstreamReader, head)
		return
	}
	f.plain(client, clientReader, upstream, upstreamReader, head)
}

// tunnel handles a CONNECT request, which is how all https traffic travels.
func (f *Forwarder) tunnel(client net.Conn, clientReader *bufio.Reader, upstream net.Conn, upstreamReader *bufio.Reader, head []byte) {
	if _, err := upstream.Write(f.withLogin(head)); err != nil {
		writeStatus(client, http.StatusBadGateway)
		return
	}
	upstream.SetReadDeadline(time.Now().Add(f.waitLimit))
	response, err := readHead(upstreamReader)
	if err != nil {
		writeStatus(client, http.StatusBadGateway)
		return
	}
	upstream.SetReadDeadline(time.Time{})

	status := statusOf(response)
	if status == http.StatusProxyAuthRequired {
		// The real proxy refused the login. Passing this on would make the browser
		// ask for a password for this local proxy, so report a failed tunnel.
		writeStatus(client, http.StatusBadGateway)
		return
	}
	if _, err := client.Write(response); err != nil {
		return
	}
	if status < 200 || status >= 300 {
		return
	}

	go func() {
		io.Copy(upstream, clientReader)
		closeWrite(upstream)
		upstream.SetReadDeadline(time.Now().Add(f.waitLimit))
	}()
	io.Copy(client, upstreamReader)
}

// plain handles plain http requests, which are sent to the proxy with the full URL
// and can follow each other on one connection, so every request gets the login. The
// responses need no such care and are passed back as they arrive.
func (f *Forwarder) plain(client net.Conn, clientReader *bufio.Reader, upstream net.Conn, upstreamReader *bufio.Reader, head []byte) {
	go func() {
		io.Copy(client, upstreamReader)
		client.Close()
	}()
	for {
		if _, err := upstream.Write(f.withLogin(head)); err != nil {
			return
		}
		if err := copyBody(upstream, clientReader, head); err != nil {
			return
		}
		next, err := readHead(clientReader)
		if err != nil || !isPlainRequest(next) {
			return
		}
		head = next
	}
}

func (f *Forwarder) dial() (net.Conn, error) {
	conn, err := net.DialTimeout("tcp", f.address, forwarderDialTimeout)
	if err != nil {
		return nil, err
	}
	if f.upstream.Scheme != "https" {
		return conn, nil
	}
	secure := tls.Client(conn, &tls.Config{ServerName: f.upstream.Hostname()})
	secure.SetDeadline(time.Now().Add(forwarderDialTimeout))
	if err := secure.Handshake(); err != nil {
		conn.Close()
		return nil, err
	}
	secure.SetDeadline(time.Time{})
	return secure, nil
}

// withLogin returns a request head with the real proxy's login added and any login
// the client sent removed. Everything else stays exactly as the browser wrote it.
func (f *Forwarder) withLogin(head []byte) []byte {
	var out bytes.Buffer
	for _, line := range headLines(head) {
		if name, _ := splitHeader(line); strings.EqualFold(name, "Proxy-Authorization") {
			continue
		}
		out.WriteString(line)
		out.WriteString("\r\n")
	}
	out.WriteString("Proxy-Authorization: " + f.login + "\r\n\r\n")
	return out.Bytes()
}

// isPlainRequest reports whether a request head asks for a full http URL, which is
// the form a browser uses only when it is talking to a proxy.
func isPlainRequest(head []byte) bool {
	line, _, _ := bytes.Cut(head, []byte("\n"))
	fields := strings.Fields(string(line))
	return len(fields) == 3 && strings.HasPrefix(strings.ToLower(fields[1]), "http://")
}

// readHead reads a request or response head, up to and including the blank line.
func readHead(r *bufio.Reader) ([]byte, error) {
	var head []byte
	for {
		line, err := r.ReadBytes('\n')
		if err != nil {
			return nil, err
		}
		head = append(head, line...)
		if len(head) > maxHeadSize {
			return nil, errors.New("head too large")
		}
		if len(bytes.TrimRight(line, "\r\n")) == 0 {
			return head, nil
		}
	}
}

func headLines(head []byte) []string {
	var lines []string
	for _, line := range strings.Split(string(head), "\n") {
		if line = strings.TrimRight(line, "\r"); line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func splitHeader(line string) (name, value string) {
	name, value, _ = strings.Cut(line, ":")
	return strings.TrimSpace(name), strings.TrimSpace(value)
}

func statusOf(response []byte) int {
	fields := strings.Fields(string(bytes.SplitN(response, []byte("\n"), 2)[0]))
	if len(fields) < 2 {
		return 0
	}
	status, _ := strconv.Atoi(fields[1])
	return status
}

// copyBody copies the body that follows a request head, if it has one.
func copyBody(dst io.Writer, src *bufio.Reader, head []byte) error {
	var length int64
	chunked := false
	for _, line := range headLines(head)[1:] {
		name, value := splitHeader(line)
		switch {
		case strings.EqualFold(name, "Content-Length"):
			n, err := strconv.ParseInt(value, 10, 64)
			if err != nil || n < 0 {
				return errors.New("bad Content-Length")
			}
			length = n
		case strings.EqualFold(name, "Transfer-Encoding"):
			chunked = strings.Contains(strings.ToLower(value), "chunked")
		}
	}
	if chunked {
		return copyChunked(dst, src)
	}
	_, err := io.CopyN(dst, src, length)
	return err
}

func copyChunked(dst io.Writer, src *bufio.Reader) error {
	for {
		line, err := src.ReadBytes('\n')
		if err != nil {
			return err
		}
		if _, err := dst.Write(line); err != nil {
			return err
		}
		sizeText, _, _ := strings.Cut(string(line), ";")
		size, err := strconv.ParseInt(strings.TrimSpace(sizeText), 16, 64)
		if err != nil || size < 0 {
			return errors.New("bad chunk size")
		}
		if size == 0 {
			break
		}
		if _, err := io.CopyN(dst, src, size+2); err != nil { // the chunk and its line end
			return err
		}
	}
	for { // trailers, up to a blank line
		line, err := src.ReadBytes('\n')
		if err != nil {
			return err
		}
		if _, err := dst.Write(line); err != nil {
			return err
		}
		if len(bytes.TrimRight(line, "\r\n")) == 0 {
			return nil
		}
	}
}

func writeStatus(w io.Writer, status int) {
	fmt.Fprintf(w, "HTTP/1.1 %d %s\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", status, http.StatusText(status))
}

func closeWrite(c net.Conn) {
	if half, ok := c.(interface{ CloseWrite() error }); ok {
		half.CloseWrite()
		return
	}
	c.Close()
}
