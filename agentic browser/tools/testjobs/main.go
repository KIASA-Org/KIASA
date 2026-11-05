// testjobs opens every saved job in the real stealth browser and reads its form, to find where
// the handlers break on real pages. It is READ-ONLY: it opens and scans, never fills or submits,
// so nothing is sent to any company. Supported sites (Greenhouse, Lever, Ashby) are opened and
// scanned; the rest are reported as not-yet-supported.
//
//	go run ./tools/testjobs <urls-file>
package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/browser"
	"stealth-app/internal/agent"
	"stealth-app/internal/ats"
)

type result struct {
	url, site, status, detail string
	questions                 int
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: go run ./tools/testjobs <urls-file>")
		os.Exit(2)
	}
	urls, err := readLines(os.Args[1])
	if err != nil {
		fmt.Println("could not read the urls file:", err)
		os.Exit(2)
	}
	headful := false
	for _, a := range os.Args[2:] {
		if a == "--headful" {
			headful = true
		}
	}

	driver := filepath.Join(os.Getenv("LOCALAPPDATA"), "KIASA", "driver")
	eng := browser.NewEngine()
	if _, err := eng.Start(browser.LaunchOptions{
		ProfileDir: filepath.Join(os.TempDir(), "kiasa-testjobs-profile"),
		Headless:   !headful,
		Channel:    "chrome",
		Driver:     &playwright.RunOptions{DriverDirectory: driver, SkipInstallBrowsers: true},
	}); err != nil {
		fmt.Println("could not start the browser:", err)
		os.Exit(1)
	}
	defer eng.Close()

	var results []result
	for i, url := range urls {
		r := check(eng, url)
		results = append(results, r)
		fmt.Printf("[%3d/%d] %-11s %-10s q=%-3d %s%s\n", i+1, len(urls), r.status, r.site, r.questions, short(url), note(r.detail))
	}
	summarise(results)
}

// check opens one job and scans its form, in a fresh tab that is closed afterwards.
func check(eng *browser.Engine, url string) result {
	site, ok := agent.SiteFor(url)
	if !ok {
		return result{url: url, site: hostOf(url), status: "SKIP", detail: "not supported yet"}
	}
	tab, err := eng.NewTab()
	if err != nil {
		return result{url: url, site: site.Name(), status: "TAB_FAIL", detail: err.Error()}
	}
	defer tab.Close()

	done := make(chan result, 1)
	go func() {
		frame, err := site.Open(tab, url)
		if err == ats.ErrNoForm {
			done <- result{url: url, site: site.Name(), status: "NO_FORM"}
			return
		}
		if err != nil {
			done <- result{url: url, site: site.Name(), status: "OPEN_FAIL", detail: firstLine(err)}
			return
		}
		qs, err := site.Scan(frame)
		if err != nil {
			done <- result{url: url, site: site.Name(), status: "SCAN_FAIL", detail: firstLine(err)}
			return
		}
		empty := 0
		for _, q := range qs {
			if q.Label == "" {
				empty++
			}
		}
		detail := ""
		if empty > 0 {
			detail = fmt.Sprintf("%d unlabelled", empty)
		}
		done <- result{url: url, site: site.Name(), status: "OK", questions: len(qs), detail: detail}
	}()

	select {
	case r := <-done:
		return r
	case <-time.After(90 * time.Second):
		return result{url: url, site: site.Name(), status: "TIMEOUT"}
	}
}

func summarise(results []result) {
	fmt.Println("\n==================== summary ====================")
	byStatus := map[string]int{}
	bySite := map[string]map[string]int{}
	for _, r := range results {
		byStatus[r.status]++
		if bySite[r.site] == nil {
			bySite[r.site] = map[string]int{}
		}
		bySite[r.site][r.status]++
	}
	fmt.Println("By status:")
	for _, s := range sortedKeys(byStatus) {
		fmt.Printf("  %-11s %d\n", s, byStatus[s])
	}
	fmt.Println("By site:")
	for _, s := range sortedKeys2(bySite) {
		parts := []string{}
		for _, st := range sortedKeys(bySite[s]) {
			parts = append(parts, fmt.Sprintf("%s=%d", st, bySite[s][st]))
		}
		fmt.Printf("  %-12s %s\n", s, strings.Join(parts, " "))
	}
	fmt.Println("\nFailures (open/scan/no-form/timeout), for fixing:")
	for _, r := range results {
		switch r.status {
		case "OPEN_FAIL", "SCAN_FAIL", "NO_FORM", "TIMEOUT", "TAB_FAIL":
			fmt.Printf("  %-10s %-10s %s%s\n", r.status, r.site, short(r.url), note(r.detail))
		}
	}
}

func readLines(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line != "" {
			out = append(out, line)
		}
	}
	return out, sc.Err()
}

func hostOf(url string) string {
	s := strings.TrimPrefix(strings.TrimPrefix(url, "https://"), "http://")
	if i := strings.IndexByte(s, '/'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimPrefix(s, "www.")
}

func short(url string) string {
	if len(url) > 70 {
		return url[:67] + "..."
	}
	return url
}

func note(detail string) string {
	if detail == "" {
		return ""
	}
	return "  — " + detail
}

func firstLine(err error) string {
	s := err.Error()
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 160 {
		s = s[:160]
	}
	return s
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedKeys2(m map[string]map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
