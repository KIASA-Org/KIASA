package gmail

import (
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Transport sends one request to Google and returns the status and body. The browser plugs in a
// version that runs the request in its own tab, so it leaves with the same address as the member's
// browsing; tools and tests use a plain HTTP one. form means a urlencoded POST, otherwise a GET.
type Transport func(method, address string, headers map[string]string, form map[string]string) (int, []byte, error)

// HTTPTransport sends requests straight from this program. The browser does not use this; it reads
// Gmail through its own tab so Google sees one consistent address for the account.
func HTTPTransport(client *http.Client) Transport {
	return func(method, address string, headers map[string]string, form map[string]string) (int, []byte, error) {
		var body io.Reader
		if form != nil {
			values := url.Values{}
			for key, value := range form {
				values.Set(key, value)
			}
			body = strings.NewReader(values.Encode())
		}
		req, err := http.NewRequest(method, address, body)
		if err != nil {
			return 0, nil, err
		}
		for key, value := range headers {
			req.Header.Set(key, value)
		}
		if form != nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		res, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer res.Body.Close()
		data, err := io.ReadAll(io.LimitReader(res.Body, 16<<20))
		return res.StatusCode, data, err
	}
}
