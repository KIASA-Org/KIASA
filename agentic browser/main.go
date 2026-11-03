package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/browser"
	"stealth-app/internal/brand"
	"stealth-app/internal/link"
	"stealth-app/internal/settings"
	"stealth-app/internal/settingsui"
	"stealth-app/proxy"
)

// profileDir keeps an existing ./profiles/<name> folder in use, so saved logins are
// not lost, and otherwise puts the profile in the app's data folder rather than
// wherever the program happened to be started.
func profileDir(name string) string {
	if local := filepath.Join("profiles", name); dirExists(local) {
		return "" // the engine resolves ./profiles/<name> itself
	}
	return filepath.Join(brand.DataDir(), "profiles", name)
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func main() {
	proxyURL := flag.String("proxy", "", "proxy URL, e.g. http://127.0.0.1:8080 or socks5://127.0.0.1:1080 (empty for a direct connection)")
	profile := flag.String("profile", "default_profile", "browser profile directory name under ./profiles")
	headless := flag.Bool("headless", false, "run without a visible browser window")
	channel := flag.String("channel", "auto", "browser to drive: auto (an installed Google Chrome if there is one, otherwise Chromium), chrome or chromium")
	noGeo := flag.Bool("no-geo", false, "do not set the browser's time zone from the proxy's location")
	fixedViewport := flag.Bool("fixed-viewport", false, "give a visible window a fixed 1920x1080 viewport instead of its real size")
	openSettings := flag.Bool("settings", false, "open the settings window (it also opens by itself the first time)")
	stealthCheck := flag.Bool("stealth-check", false, "open the browser-fingerprint test page and save its report instead of KIASA's Auto apply page")
	closeWhenDone := flag.Bool("close-when-done", false, "close a visible browser as soon as the report is saved; by default it stays open until you close it or press Ctrl+C")
	flag.Parse()

	// The browser works only while connected to KIASA: it needs a connection code
	// from the Auto apply page, and KIASA must accept it. Without one the settings
	// window opens, and closing it without a good code ends the program.
	saved, err := settings.Load(brand.SettingsPath())
	if err != nil && !errors.Is(err, settings.ErrNotSet) {
		log.Printf("[!] Saved settings ignored: %v\n", err)
		saved = settings.Settings{}
	}
	needWindow, notice := *openSettings, ""
	for {
		if saved.Link == "" {
			needWindow = true
		} else if !needWindow {
			code, err := link.Parse(saved.Link)
			if err != nil {
				needWindow, notice = true, err.Error()
			} else {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				err = link.CheckIn(ctx, code, link.Status{State: "idle", Detail: "Starting."})
				cancel()
				switch {
				case err == nil:
				case errors.Is(err, link.ErrNotConnected):
					needWindow, notice = true, "KIASA does not accept this browser's code any more. Make a new one on the Auto apply page and paste it here."
				default:
					log.Fatal("[-] Could not reach KIASA. Check your internet connection and open the KIASA Browser again.")
				}
			}
		}
		if !needWindow {
			break
		}
		exe, err := findChrome()
		if err != nil {
			log.Fatalf("[-] %v", err)
		}
		changed, err := settingsui.Show(settingsui.Options{
			BrowserExe:    exe,
			WindowProfile: filepath.Join(brand.DataDir(), "SettingsWindow"),
			SettingsPath:  brand.SettingsPath(),
			Check:         proxy.ValidateProxy,
			Notice:        notice,
		})
		if err != nil {
			log.Fatalf("[-] Could not open the settings window: %v", err)
		}
		if !changed {
			log.Println("[*] The KIASA Browser needs the connection code from the Auto apply page, so it did not start. Open it again and paste the code.")
			return
		}
		if saved, err = settings.Load(brand.SettingsPath()); err != nil && !errors.Is(err, settings.ErrNotSet) {
			log.Fatalf("[-] Saved settings could not be read: %v", err)
		}
		needWindow, notice = false, ""
	}
	// Without -proxy, the proxy saved in the app's settings is used, if there is one.
	if *proxyURL == "" {
		*proxyURL = saved.Proxy.URL()
	}

	// Parsing stops at the first non-flag argument, so "-headless false -proxy URL"
	// would drop the proxy and connect directly. The arguments aren't printed
	// because they may contain proxy credentials.
	if flag.NArg() > 0 {
		log.Fatal("[-] Unexpected argument after the flags. Booleans need =, as in -headless=false")
	}

	// 1. Pre-flight Proxy Check
	log.Println("[*] Running pre-flight network verification...")
	egressIP, err := proxy.ValidateProxy(*proxyURL)
	if err != nil {
		log.Fatalf("[-] Network validation failed: %v", err)
	}
	log.Printf("[+] Connection verified. Egress IP / Mode: %s\n", egressIP)

	// A browser whose time zone disagrees with its IP address stands out, so with
	// a proxy the zone is taken from where the proxy exits. Failing to find it is
	// not worth stopping for: the browser then uses this computer's time zone.
	timezone := ""
	if *proxyURL != "" && !*noGeo {
		zone, err := proxy.LookupTimezone(*proxyURL)
		if err != nil {
			log.Printf("[!] Could not match the time zone to the proxy, using this computer's: %v\n", err)
		} else {
			timezone = zone
			log.Printf("[+] Browser time zone set to %s to match the proxy.\n", timezone)
		}
	}

	// 2. Initialize Browser Engine
	engine := browser.NewEngine()
	closeEngine := func() {
		if err := engine.Close(); err != nil {
			log.Printf("[-] Error closing browser engine: %v\n", err)
		}
	}
	defer closeEngine()

	// A visible browser is left open so it can be used. Headless has no window to
	// wait for, so it always finishes on its own.
	keepOpen := !*headless && !*closeWhenDone
	waitForUser := func() {
		log.Println("[*] The browser stays open. Close its window, or press Ctrl+C here, to finish.")
		stop := make(chan struct{})
		interrupt := make(chan os.Signal, 1)
		signal.Notify(interrupt, os.Interrupt)
		go func() {
			<-interrupt
			close(stop)
		}()
		engine.WaitUntilClosed(stop)
	}
	// endRun stops after a step went wrong. A visible browser is left open first,
	// because the test page it was checking is not what you opened it for. Headless
	// runs and -close-when-done still stop at once.
	endRun := func(message string) {
		if keepOpen {
			log.Println(message)
			waitForUser()
			closeEngine()
			os.Exit(1)
		}
		closeEngine()
		log.Fatal(message)
	}

	// 3. Launch Persistent Context Page
	log.Println("[*] Launching browser persistent context...")
	requestedChannel := *channel
	if requestedChannel == "auto" {
		requestedChannel = ""
	}
	page, err := engine.Start(browser.LaunchOptions{
		ProfileName:   *profile,
		ProfileDir:    profileDir(*profile),
		Headless:      *headless,
		ProxyURL:      *proxyURL,
		Channel:       requestedChannel,
		Timezone:      timezone,
		FixedViewport: *fixedViewport,
	})
	if err != nil {
		log.Fatalf("[-] Browser launch failed: %v", err)
	}
	log.Printf("[+] Browser launched (%s).\n", engine.Channel())

	// 4. Tell KIASA how this browser is, for as long as it is open. Only a short
	// status is sent, never a page. Without a connection code there is nothing to do.
	status := newStatusBoard()
	stopLink := func() {}
	{
		code, _ := link.Parse(saved.Link) // already checked above
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan struct{})
		go func() {
			defer close(done)
			link.Keep(ctx, code, status.current, func(error) {
				// A browser KIASA no longer accepts is closed, not left to be used.
				log.Println("[!] KIASA no longer accepts this browser, so it is closing. Make a new code on the Auto apply page and open the KIASA Browser again.")
				closeEngine()
				os.Exit(1)
			})
		}()
		stopLink = func() { cancel(); <-done }
		log.Println("[+] Connected to KIASA: this browser's status is shown on the Auto apply page.")
	}
	defer stopLink()

	// 5. Open KIASA's Auto apply page, or the fingerprint test when asked.
	if *stealthCheck {
		runStealthCheck(page, endRun)
	} else {
		targetURL := brand.ApplyPage
		log.Printf("[*] Opening %s...\n", targetURL)
		if _, err := page.Goto(targetURL, playwright.PageGotoOptions{Timeout: playwright.Float(60000)}); err != nil {
			status.set("error", "Could not open KIASA's Auto apply page.")
			endRun(fmt.Sprintf("[-] Navigation error: %v", err))
		}
	}
	status.set("idle", "The browser is open and ready.")

	if keepOpen {
		waitForUser()
		log.Println("[+] Done.")
	}
}

// statusBoard is how the browser says it is, read by the reporter.
type statusBoard struct {
	mu     sync.Mutex
	status link.Status
}

func newStatusBoard() *statusBoard {
	computer, _ := os.Hostname()
	return &statusBoard{status: link.Status{State: "idle", Detail: "Starting.", Computer: computer, Version: brand.Version}}
}

func (b *statusBoard) set(state, detail string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.status.State, b.status.Detail = state, detail
}

func (b *statusBoard) current() link.Status {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.status
}

// runStealthCheck opens the fingerprint test page and saves a picture of its report
// on this computer. It is for checking the browser, and sends nothing to KIASA.
func runStealthCheck(page playwright.Page, endRun func(string)) {
	targetURL := "https://bot.sannysoft.com"
	log.Printf("[*] Navigating to %s...\n", targetURL)
	resp, err := page.Goto(targetURL, playwright.PageGotoOptions{
		// Through a slow proxy this page can take longer than the 30 seconds
		// Playwright allows by default.
		Timeout: playwright.Float(60000),
	})
	if err == nil && resp != nil && !resp.Ok() {
		err = fmt.Errorf("HTTP status %d", resp.Status())
	}
	if err != nil {
		endRun(fmt.Sprintf("[-] Navigation error: %v", err))
	}
	// A page that is still busy is worth capturing anyway, so this only warns.
	if err := page.WaitForLoadState(playwright.PageWaitForLoadStateOptions{
		State:   playwright.LoadStateNetworkidle,
		Timeout: playwright.Float(10000),
	}); err != nil {
		log.Printf("[!] Page still busy after 10s, so the report may be incomplete: %v\n", err)
	}
	reportPath := filepath.Join(brand.DataDir(), "stealth_report.png")
	if err := os.MkdirAll(filepath.Dir(reportPath), 0o700); err != nil {
		endRun(fmt.Sprintf("[-] Could not create the report folder: %v", err))
	}
	if _, err := page.Screenshot(playwright.PageScreenshotOptions{
		Path:     playwright.String(reportPath),
		FullPage: playwright.Bool(true),
		// CSS pixels, so a scaled display does not make the report bigger.
		Scale: playwright.ScreenshotScaleCss,
	}); err != nil {
		endRun(fmt.Sprintf("[-] Screenshot failed: %v", err))
	}
	log.Printf("[+] Report saved to %s\n", reportPath)
}

// findChrome returns the installed Google Chrome, which the settings window is shown in.
func findChrome() (string, error) {
	for _, root := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LocalAppData")} {
		if root == "" {
			continue
		}
		path := filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe")
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path, nil
		}
	}
	return "", errors.New("Google Chrome was not found. Install Google Chrome, then open KIASA again.")
}
