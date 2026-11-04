package browser

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/internal/gmail"
)

// gmailFetchJS runs one request from inside the browser, so it leaves with the same address as the
// member's browsing. It answers [status, body text], or [0, error]. Credentials are left out: the
// only identity is the bearer token the caller puts in the headers.
const gmailFetchJS = `(async (reqJson) => {
  const req = JSON.parse(reqJson);
  const opts = { method: req.method, headers: Object.assign({}, req.headers), credentials: "omit" };
  if (req.form) {
    opts.body = new URLSearchParams(req.form).toString();
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  try {
    const r = await fetch(req.url, opts);
    return JSON.stringify([r.status, await r.text()]);
  } catch (e) {
    return JSON.stringify([0, String(e)]);
  }
})`

// fetchInPage runs the request in the given page and reads the answer.
func fetchInPage(page playwright.Page, method, address string, headers, form map[string]string) (int, []byte, error) {
	if headers == nil {
		headers = map[string]string{}
	}
	arg := map[string]any{"method": method, "url": address, "headers": headers}
	if form != nil {
		arg["form"] = form
	}
	packed, err := json.Marshal(arg)
	if err != nil {
		return 0, nil, err
	}
	raw, err := page.Evaluate(gmailFetchJS, string(packed))
	if err != nil {
		return 0, nil, err
	}
	text, ok := raw.(string)
	if !ok {
		return 0, nil, fmt.Errorf("the browser gave an unexpected answer")
	}
	var pair []json.RawMessage
	if err := json.Unmarshal([]byte(text), &pair); err != nil || len(pair) != 2 {
		return 0, nil, fmt.Errorf("the browser's answer could not be read")
	}
	var status int
	json.Unmarshal(pair[0], &status)
	var body string
	json.Unmarshal(pair[1], &body)
	if status == 0 {
		// The fetch itself failed (offline, blocked); body is the reason.
		return 0, nil, fmt.Errorf("the request could not be made: %s", body)
	}
	return status, []byte(body), nil
}

// GmailTransport runs Gmail requests inside the browser, through a quiet tab on Gmail's own API
// origin, so Google sees one address for the account.
func (e *Engine) GmailTransport() gmail.Transport {
	return func(method, address string, headers, form map[string]string) (int, []byte, error) {
		page, err := e.gmailPage()
		if err != nil {
			return 0, nil, err
		}
		return fetchInPage(page, method, address, headers, form)
	}
}

// gmailPage keeps one tab on Gmail's API origin, so reading mail is a same-origin request. The tab
// shows nothing of use and is never brought to the front.
func (e *Engine) gmailPage() (playwright.Page, error) {
	e.gmailMu.Lock()
	defer e.gmailMu.Unlock()
	if e.gmailTab != nil && !e.gmailTab.IsClosed() {
		return e.gmailTab, nil
	}
	if e.context == nil {
		return nil, errors.New("the browser is not open")
	}
	page, err := e.context.NewPage()
	if err != nil {
		return nil, err
	}
	// Establish the origin; the page itself answers 404, which does not matter.
	page.Goto("https://gmail.googleapis.com/", playwright.PageGotoOptions{
		WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		Timeout:   playwright.Float(30000),
	})
	e.gmailTab = page
	return page, nil
}
