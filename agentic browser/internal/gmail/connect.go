package gmail

import (
	cryptorand "crypto/rand"
	"errors"
	"html"
	"net"
	"net/http"
	"net/url"
	"time"
)

func randRead(b []byte) (int, error) { return cryptorand.Read(b) }

// listenForCode starts a one-off local page that Google sends the sign-in code back to. It returns
// the page's address, a wait for the code, and a stop. Nothing leaves this PC: the code arrives on
// 127.0.0.1 and is exchanged from here.
func listenForCode(state string) (redirect string, wait func(time.Duration) (string, error), stop func(), err error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", nil, nil, err
	}
	got := make(chan string, 1)
	fail := make(chan string, 1)
	handler := http.NewServeMux()
	handler.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		// Google always sends the state back; a request without it is something else (a favicon,
		// say) and is ignored so it cannot end the wait.
		if query.Get("state") != state {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		code, reason := query.Get("code"), query.Get("error")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if code != "" {
			w.Write([]byte("<p style='font:16px system-ui'>Gmail is connected. You can close this tab.</p>"))
			select {
			case got <- code:
			default:
			}
			return
		}
		w.Write([]byte("<p style='font:16px system-ui'>Gmail was not connected (" + html.EscapeString(reason) + "). You can close this tab.</p>"))
		select {
		case fail <- reason:
		default:
		}
	})
	server := &http.Server{Handler: handler}
	go server.Serve(listener)

	redirect = "http://localhost:" + portOf(listener) + "/"
	wait = func(timeout time.Duration) (string, error) {
		select {
		case code := <-got:
			if code == "" {
				return "", errors.New("Google did not send a sign-in code; Allow may have been declined")
			}
			return code, nil
		case reason := <-fail:
			if reason == "" {
				reason = "it was declined"
			}
			return "", errors.New("Gmail was not connected: " + reason)
		case <-time.After(timeout):
			return "", errors.New("timed out waiting for Google's Allow page")
		}
	}
	stop = func() { server.Close() }
	return redirect, wait, stop, nil
}

func portOf(listener net.Listener) string {
	_, port, _ := net.SplitHostPort(listener.Addr().String())
	return port
}

// SanitizeHost pulls the host out of a URL, for SiteHints.
func SanitizeHost(address string) string {
	u, err := url.Parse(address)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
