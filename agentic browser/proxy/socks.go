package proxy

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"sync"
	"time"
)

// socksDialTimeout limits how long reaching the real proxy and logging in may take.
const socksDialTimeout = 30 * time.Second

// SocksForwarder is a SOCKS5 proxy on this computer that passes everything on to a real
// SOCKS5 proxy, logging in to it for the browser. The browser then talks to a SOCKS5
// proxy with no login.
//
// It exists because Chrome cannot log in to a SOCKS5 proxy at all — it has no way to
// send a username and password over SOCKS5, and refuses to launch with one. So the login
// is done here, on this computer, and the browser is given a local SOCKS5 proxy that
// needs none. The browser still sends host NAMES for the proxy to resolve (ATYP=domain),
// and those are passed on untouched, so DNS still leaves only through the real proxy —
// nothing is resolved on this computer, and the real exit IP is unchanged. The tunnel
// carries the browser's own bytes unaltered, so its fingerprint is untouched.
type SocksForwarder struct {
	listener net.Listener
	address  string // host:port of the real proxy
	username string
	password string

	mu     sync.Mutex
	conns  map[net.Conn]struct{}
	closed bool
	wg     sync.WaitGroup
}

// NewSocksForwarder starts a SocksForwarder for a socks5 proxy URL that contains a login.
// It listens on a free port of 127.0.0.1, so only this computer can use it.
func NewSocksForwarder(proxyURL string) (*SocksForwarder, error) {
	parsed, err := url.Parse(proxyURL)
	if err != nil || parsed.Hostname() == "" {
		// The parse error quotes the URL, which may contain the password.
		return nil, errors.New("invalid proxy URL or missing host")
	}
	if parsed.Scheme != "socks5" && parsed.Scheme != "socks5h" {
		return nil, fmt.Errorf("cannot forward to a proxy with scheme: %s", parsed.Scheme)
	}
	if parsed.User == nil {
		return nil, errors.New("proxy URL has no login to add")
	}
	port := parsed.Port()
	if port == "" {
		port = "1080"
	}
	username := parsed.User.Username()
	password, _ := parsed.User.Password()
	if len(username) > 255 || len(password) > 255 {
		return nil, errors.New("the proxy login is too long for SOCKS5")
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	f := &SocksForwarder{
		listener: listener,
		address:  net.JoinHostPort(parsed.Hostname(), port),
		username: username,
		password: password,
		conns:    map[net.Conn]struct{}{},
	}
	f.wg.Add(1)
	go f.serve()
	return f, nil
}

// URL returns the address to give the browser as its proxy: a local SOCKS5 proxy, no login.
func (f *SocksForwarder) URL() string {
	return "socks5://" + f.listener.Addr().String()
}

// Close stops the SocksForwarder and every connection going through it. It is safe to
// call more than once.
func (f *SocksForwarder) Close() error {
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

func (f *SocksForwarder) serve() {
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

func (f *SocksForwarder) track(c net.Conn) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return false
	}
	f.conns[c] = struct{}{}
	return true
}

func (f *SocksForwarder) untrack(c net.Conn) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.conns, c)
}

func (f *SocksForwarder) handle(client net.Conn) {
	// 1. Greet the browser and tell it no login is needed.
	if err := greetNoAuth(client); err != nil {
		return
	}
	// 2. Read the browser's connect request exactly as written, so the host NAME in it,
	//    if any, is passed on untouched for the real proxy to resolve.
	request, err := readSocksRequest(client)
	if err != nil {
		return
	}
	// 3. Reach the real proxy and log in to it.
	upstream, err := f.dialUpstream()
	if err != nil {
		writeSocksFailure(client)
		return
	}
	if !f.track(upstream) {
		upstream.Close()
		return
	}
	defer f.untrack(upstream)
	defer upstream.Close()
	// 4. Hand the browser's request to the real proxy, then let its reply and all that
	//    follows flow straight through, both ways, byte for byte.
	if _, err := upstream.Write(request); err != nil {
		return
	}
	go func() {
		io.Copy(upstream, client)
		closeWrite(upstream)
	}()
	io.Copy(client, upstream)
}

// greetNoAuth reads the browser's SOCKS5 greeting and answers that no login is needed.
func greetNoAuth(c net.Conn) error {
	head := make([]byte, 2) // VER, NMETHODS
	if _, err := io.ReadFull(c, head); err != nil {
		return err
	}
	if head[0] != 0x05 {
		return errors.New("not a SOCKS5 client")
	}
	if _, err := io.CopyN(io.Discard, c, int64(head[1])); err != nil { // the offered method bytes
		return err
	}
	_, err := c.Write([]byte{0x05, 0x00}) // SOCKS5, "no authentication required"
	return err
}

// readSocksRequest reads one SOCKS5 request head: VER CMD RSV ATYP, the address and the
// port, returning the exact bytes so they can be forwarded unchanged (host names included).
func readSocksRequest(c net.Conn) ([]byte, error) {
	head := make([]byte, 4) // VER CMD RSV ATYP
	if _, err := io.ReadFull(c, head); err != nil {
		return nil, err
	}
	if head[0] != 0x05 {
		return nil, errors.New("not a SOCKS5 request")
	}
	switch head[3] {
	case 0x01: // IPv4: four address bytes and the port
		return readTail(c, head, 4+2)
	case 0x04: // IPv6: sixteen address bytes and the port
		return readTail(c, head, 16+2)
	case 0x03: // a host name: one length byte, the name, then the port
		lenByte := make([]byte, 1)
		if _, err := io.ReadFull(c, lenByte); err != nil {
			return nil, err
		}
		head = append(head, lenByte[0])
		return readTail(c, head, int(lenByte[0])+2)
	default:
		return nil, errors.New("unknown SOCKS5 address type")
	}
}

func readTail(c net.Conn, head []byte, n int) ([]byte, error) {
	tail := make([]byte, n)
	if _, err := io.ReadFull(c, tail); err != nil {
		return nil, err
	}
	return append(head, tail...), nil
}

// dialUpstream reaches the real proxy and logs in with the saved username and password.
func (f *SocksForwarder) dialUpstream() (net.Conn, error) {
	conn, err := net.DialTimeout("tcp", f.address, socksDialTimeout)
	if err != nil {
		return nil, err
	}
	conn.SetDeadline(time.Now().Add(socksDialTimeout))
	// Offer username/password and no-auth; take whichever the proxy chooses.
	if _, err := conn.Write([]byte{0x05, 0x02, 0x02, 0x00}); err != nil {
		conn.Close()
		return nil, err
	}
	reply := make([]byte, 2) // VER, METHOD
	if _, err := io.ReadFull(conn, reply); err != nil {
		conn.Close()
		return nil, err
	}
	if reply[0] != 0x05 {
		conn.Close()
		return nil, errors.New("the proxy is not SOCKS5")
	}
	switch reply[1] {
	case 0x00: // the proxy wants no login
	case 0x02:
		if err := f.login(conn); err != nil {
			conn.Close()
			return nil, err
		}
	default:
		conn.Close()
		return nil, fmt.Errorf("the proxy asked for an unsupported login method (%d)", reply[1])
	}
	conn.SetDeadline(time.Time{})
	return conn, nil
}

// login does the SOCKS5 username/password exchange (RFC 1929).
func (f *SocksForwarder) login(conn net.Conn) error {
	msg := []byte{0x01, byte(len(f.username))}
	msg = append(msg, f.username...)
	msg = append(msg, byte(len(f.password)))
	msg = append(msg, f.password...)
	if _, err := conn.Write(msg); err != nil {
		return err
	}
	reply := make([]byte, 2) // VER, STATUS (0x00 is success)
	if _, err := io.ReadFull(conn, reply); err != nil {
		return err
	}
	if reply[1] != 0x00 {
		return errors.New("the proxy rejected the login")
	}
	return nil
}

// writeSocksFailure tells the browser the connection could not be made (general failure).
func writeSocksFailure(c net.Conn) {
	c.Write([]byte{0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
}
