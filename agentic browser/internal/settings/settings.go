// Package settings keeps what a person sets in the app: for now, their proxy.
package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Proxy is the proxy the browser goes through.
type Proxy struct {
	// Enabled is false for a direct connection.
	Enabled  bool
	Scheme   string // http, https or socks5
	Host     string
	Port     int
	Username string
	Password string
}

// Settings is everything the app remembers.
type Settings struct {
	Proxy Proxy
	// Link is the connection code from KIASA's Auto apply page; empty when this
	// browser is not connected.
	Link string
}

// stored is the file's layout. The password is sealed, so the file alone gives
// nothing away to another Windows account or to someone who copies it.
type stored struct {
	Proxy      storedProxy `json:"proxy"`
	SealedLink []byte      `json:"sealedLink,omitempty"`
}

type storedProxy struct {
	Enabled  bool   `json:"enabled"`
	Scheme   string `json:"scheme,omitempty"`
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Username string `json:"username,omitempty"`
	Sealed   []byte `json:"sealedPassword,omitempty"`
}

// ErrNotSet means the settings have never been saved, as on a first run.
var ErrNotSet = errors.New("settings not saved yet")

// Load reads the settings file.
func Load(path string) (Settings, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Settings{}, ErrNotSet
	}
	if err != nil {
		return Settings{}, err
	}
	var file stored
	if err := json.Unmarshal(data, &file); err != nil {
		return Settings{}, fmt.Errorf("reading %s: %w", filepath.Base(path), err)
	}
	p := file.Proxy
	s := Settings{Proxy: Proxy{Enabled: p.Enabled, Scheme: p.Scheme, Host: p.Host, Port: p.Port, Username: p.Username}}
	if len(p.Sealed) > 0 {
		plain, err := unseal(p.Sealed)
		if err != nil {
			// Happens when the file came from another Windows account or computer.
			return Settings{}, fmt.Errorf("the saved proxy password cannot be read here: %w", err)
		}
		s.Proxy.Password = string(plain)
	}
	if len(file.SealedLink) > 0 {
		plain, err := unseal(file.SealedLink)
		if err != nil {
			return Settings{}, fmt.Errorf("the saved KIASA code cannot be read here: %w", err)
		}
		s.Link = string(plain)
	}
	return s, nil
}

// Save writes the settings file, replacing it in one step so a crash cannot leave
// half a file behind.
func Save(path string, s Settings) error {
	p := s.Proxy
	file := stored{Proxy: storedProxy{Enabled: p.Enabled, Scheme: p.Scheme, Host: p.Host, Port: p.Port, Username: p.Username}}
	if p.Password != "" {
		sealed, err := seal([]byte(p.Password))
		if err != nil {
			return fmt.Errorf("protecting the proxy password: %w", err)
		}
		file.Proxy.Sealed = sealed
	}
	if s.Link != "" {
		sealed, err := seal([]byte(s.Link))
		if err != nil {
			return fmt.Errorf("protecting the KIASA code: %w", err)
		}
		file.SealedLink = sealed
	}
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// URL returns the proxy as a URL for the browser engine, or "" for a direct
// connection. It contains the password, so it must not be logged or put on a command
// line.
func (p Proxy) URL() string {
	if !p.Enabled {
		return ""
	}
	u := url.URL{Scheme: p.Scheme, Host: net.JoinHostPort(p.Host, strconv.Itoa(p.Port))}
	if p.Username != "" {
		u.User = url.UserPassword(p.Username, p.Password)
	}
	return u.String()
}

// Validate says what is wrong with a proxy, in words for the person typing it.
func (p Proxy) Validate() error {
	if !p.Enabled {
		return nil
	}
	switch p.Scheme {
	case "http", "https", "socks5":
	default:
		return fmt.Errorf("Choose HTTP, HTTPS or SOCKS5 as the type, not %q.", p.Scheme)
	}
	if p.Host == "" || strings.ContainsAny(p.Host, " /\\@") {
		return errors.New("Enter the proxy's address, such as 45.80.96.177 or proxy.example.com.")
	}
	if p.Port < 1 || p.Port > 65535 {
		return errors.New("Enter the proxy's port, a number from 1 to 65535.")
	}
	if p.Scheme == "socks5" && (p.Username != "" || p.Password != "") {
		return errors.New("The browser cannot log in to a SOCKS5 proxy. Use an HTTP proxy, or a SOCKS5 proxy with no login.")
	}
	if p.Password != "" && p.Username == "" {
		return errors.New("Enter the username that goes with this password.")
	}
	return nil
}

// ParseProxy reads a proxy written in any of the ways sellers and people write them:
//
//	45.80.96.177:29842
//	45.80.96.177:29842:username:password
//	username:password@45.80.96.177:29842
//	http://username:password@45.80.96.177:29842
//	socks5://45.80.96.177:1080
func ParseProxy(text string) (Proxy, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Proxy{}, errors.New("Enter the proxy's address.")
	}
	if strings.ContainsAny(text, " \t\r\n") {
		return Proxy{}, errors.New("A proxy address has no spaces in it.")
	}

	if !strings.Contains(text, "://") && !strings.Contains(text, "@") {
		parts := strings.SplitN(text, ":", 4)
		switch len(parts) {
		case 2, 4:
			port, err := strconv.Atoi(parts[1])
			if err != nil {
				return Proxy{}, errors.New("The part after the address must be the port, a number.")
			}
			p := Proxy{Enabled: true, Scheme: "http", Host: parts[0], Port: port}
			if len(parts) == 4 {
				p.Username, p.Password = parts[2], parts[3]
			}
			return p, p.Validate()
		default:
			return Proxy{}, errors.New("Write the proxy as address:port or address:port:username:password.")
		}
	}

	if !strings.Contains(text, "://") {
		text = "http://" + text
	}
	u, err := url.Parse(text)
	if err != nil {
		// The parse error repeats the text, which may contain the password.
		return Proxy{}, errors.New("This does not look like a proxy address.")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme == "socks5h" {
		scheme = "socks5"
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		return Proxy{}, errors.New("The address needs a port, as in 45.80.96.177:29842.")
	}
	p := Proxy{Enabled: true, Scheme: scheme, Host: u.Hostname(), Port: port}
	if u.User != nil {
		p.Username = u.User.Username()
		p.Password, _ = u.User.Password()
	}
	return p, p.Validate()
}
