// inspectjob opens one job page in the real stealth browser and prints what its DOM looks like,
// to work out the right selectors for a handler. Read-only.
//
//	go run ./tools/inspectjob <url> [--click-apply]
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/browser"
)

const dump = `() => {
  const forms = [...document.querySelectorAll("form")].map(f => ({
    id: f.id, cls: (f.className || "").slice(0, 100),
    fields: f.querySelectorAll("input,textarea,select,[role=combobox]").length,
  }));
  const buttons = [...document.querySelectorAll("button, a, [role=button]")]
    .filter(b => /apply|application|submit|continue/i.test(b.innerText || ""))
    .slice(0, 12)
    .map(b => ({ tag: b.tagName, role: b.getAttribute("role") || "", text: (b.innerText || "").trim().slice(0, 40), href: (b.getAttribute("href") || "").slice(0, 80) }));
  const controls = {
    inputs: document.querySelectorAll("input").length,
    textareas: document.querySelectorAll("textarea").length,
    selects: document.querySelectorAll("select").length,
    comboboxes: document.querySelectorAll("[role=combobox]").length,
    files: document.querySelectorAll('input[type=file]').length,
    listitems: document.querySelectorAll('[role=listbox],[role=option]').length,
  };
  // shadow DOM and iframes, which querySelectorAll does not see into
  let shadowHosts = 0, shadowControls = 0;
  const walk = root => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) { shadowHosts++; shadowControls += el.shadowRoot.querySelectorAll("input,textarea,select,[role=combobox]").length; walk(el.shadowRoot); }
    }
  };
  walk(document);
  const iframes = [...document.querySelectorAll("iframe")].map(f => (f.src || "").slice(0, 120));
  const bodyText = (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 300);
  const bodyHTMLLen = document.body ? document.body.innerHTML.length : 0;
  const bodyKids = document.body ? [...document.body.children].slice(0, 8).map(c => c.tagName + (c.id ? "#" + c.id : "") + (c.className ? "." + String(c.className).split(" ")[0] : "")) : [];
  const scripts = document.querySelectorAll("script").length;
  let best = null, bestN = 0;
  for (const el of document.querySelectorAll("form,div,section,main")) {
    const n = el.querySelectorAll("input,textarea,select,[role=combobox]").length;
    if (n > bestN) { bestN = n; best = el; }
  }
  const bestInfo = best ? {
    tag: best.tagName, id: best.id, cls: (best.className || "").slice(0, 140), fields: bestN,
    html: (best.outerHTML || "").replace(/\s+/g, " ").slice(0, 1800),
  } : null;
  // a few field labels, to see how questions are worded
  const fields = [...document.querySelectorAll("input,textarea,[role=combobox]")].filter(el => {
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.type !== "hidden";
  }).slice(0, 8).map(el => ({
    tag: el.tagName, type: el.type || "", id: el.id, name: el.name || "", role: el.getAttribute("role") || "",
    label: ((el.labels && el.labels[0] ? el.labels[0].innerText : "") || el.getAttribute("aria-label") || el.placeholder || "").trim().slice(0, 60),
  }));
  return { title: document.title, url: location.href, forms, buttons, controls, shadowHosts, shadowControls, iframes, bodyText, bodyHTMLLen, bodyKids, scripts, best: bestInfo, fields };
}`

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: go run ./tools/inspectjob <url> [--click-apply]")
		os.Exit(2)
	}
	url := os.Args[1]
	clickApply, headful := false, false
	for _, a := range os.Args[2:] {
		switch a {
		case "--click-apply":
			clickApply = true
		case "--headful":
			headful = true
		}
	}

	driver := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "driver")
	eng := browser.NewEngine()
	if _, err := eng.Start(browser.LaunchOptions{
		ProfileDir: filepath.Join(os.TempDir(), "kiasa-inspect-profile"),
		Headless:   !headful,
		Channel:    "chrome",
		Driver:     &playwright.RunOptions{DriverDirectory: driver, SkipInstallBrowsers: true},
	}); err != nil {
		fmt.Println("start:", err)
		os.Exit(1)
	}
	defer eng.Close()

	tab, err := eng.NewTab()
	if err != nil {
		fmt.Println("tab:", err)
		os.Exit(1)
	}
	var consoleMsgs []string
	tab.On("console", func(m playwright.ConsoleMessage) {
		if t := m.Type(); t == "error" || t == "warning" {
			consoleMsgs = append(consoleMsgs, t+": "+m.Text())
		}
	})
	tab.On("pageerror", func(e error) { consoleMsgs = append(consoleMsgs, "pageerror: "+e.Error()) })
	if _, err := tab.Goto(url, playwright.PageGotoOptions{WaitUntil: playwright.WaitUntilStateDomcontentloaded, Timeout: playwright.Float(30000)}); err != nil {
		fmt.Println("goto:", err)
	}
	_ = tab.WaitForLoadState(playwright.PageWaitForLoadStateOptions{State: playwright.LoadStateNetworkidle, Timeout: playwright.Float(12000)})
	tab.WaitForTimeout(8000)
	defer func() {
		fmt.Printf("\n--- console (errors/warnings), %d ---\n", len(consoleMsgs))
		for i, m := range consoleMsgs {
			if i >= 15 {
				break
			}
			if len(m) > 200 {
				m = m[:200]
			}
			fmt.Println("  " + m)
		}
	}()

	report(tab, "AFTER LOAD")

	if clickApply {
		for _, name := range []string{"Apply for this job", "Apply", "Application", "Apply Now"} {
			btn := tab.GetByText(name, playwright.PageGetByTextOptions{Exact: playwright.Bool(false)})
			if n, _ := btn.Count(); n > 0 {
				fmt.Printf("\n>>> clicking %q\n", name)
				if err := btn.First().Click(playwright.LocatorClickOptions{Timeout: playwright.Float(6000)}); err != nil {
					fmt.Println("click:", err)
				}
				tab.WaitForTimeout(4000)
				break
			}
		}
		report(tab, "AFTER CLICK")
	}
}

func report(tab playwright.Page, when string) {
	raw, err := tab.Evaluate(dump)
	if err != nil {
		fmt.Println(when, "evaluate:", err)
		return
	}
	pretty, _ := json.MarshalIndent(raw, "", "  ")
	fmt.Printf("\n========== %s ==========\n%s\n", when, string(pretty))
}
