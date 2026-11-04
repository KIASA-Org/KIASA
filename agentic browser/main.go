package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/browser"
	"stealth-app/internal/agent"
	"stealth-app/internal/brand"
	"stealth-app/internal/link"
	"stealth-app/internal/settings"
	"stealth-app/internal/settingsui"
	"stealth-app/internal/single"
	"stealth-app/internal/winmsg"
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
	openSettings := flag.Bool("settings", false, "open the settings window, to set a proxy, and nothing else")
	stealthCheck := flag.Bool("stealth-check", false, "open the browser-fingerprint test page and save its report instead of KIASA's Auto apply page")
	closeWhenDone := flag.Bool("close-when-done", false, "close a visible browser as soon as the report is saved; by default it stays open until you close it or press Ctrl+C")
	flag.Parse()
	closeLog := keepLog()
	defer closeLog()

	if *openSettings {
		showSettings()
		return
	}

	// Parsing stops at the first non-flag argument, so "-headless false -proxy URL"
	// would drop the proxy and connect directly. The only one allowed is the link
	// the Start button opens. Arguments aren't printed because they may contain proxy
	// credentials or this browser's code.
	appLink := ""
	switch {
	case flag.NArg() == 0:
	case flag.NArg() == 1 && link.IsAppLink(flag.Arg(0)):
		appLink = flag.Arg(0)
	default:
		fatalf("Unexpected argument after the flags. Booleans need =, as in -headless=false")
	}

	saved, err := settings.Load(brand.SettingsPath())
	if err != nil && !errors.Is(err, settings.ErrNotSet) {
		log.Printf("[!] Saved settings ignored: %v\n", err)
		saved = settings.Settings{}
	}
	// The Start button hands over this browser's code. It is saved before anything
	// else, so that a copy already running can pick it up.
	if appLink != "" {
		text, err := link.FromAppLink(appLink, brand.DatabaseHost)
		if err != nil {
			fatalf("This link could not start the KIASA Browser. Press Start the KIASA Browser on the Auto apply page of KIASA.")
		}
		if text != "" {
			saved.Link = text
			if err := settings.Save(brand.SettingsPath(), saved); err != nil {
				fatalf("The KIASA Browser could not save its connection to KIASA: %v", err)
			}
		}
	}

	// One at a time: a copy that is already open comes forward instead.
	wake, first := single.Claim(brand.MutexName)
	if !first {
		log.Println("[*] The KIASA Browser is open already, so it was told to come forward.")
		return
	}

	// The browser works only while connected to KIASA: KIASA must accept its code,
	// which comes from the Start button on the Auto apply page.
	conn := &connection{}
	conn.reload()
	for tries := 0; ; tries++ {
		code := conn.current()
		if code.Secret == "" {
			askForStart()
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		err := link.CheckIn(ctx, code, link.Status{State: "idle", Detail: "Starting."})
		cancel()
		if err == nil {
			break
		}
		if !errors.Is(err, link.ErrNotConnected) {
			fatalf("Could not reach KIASA. Check your internet connection and press Start the KIASA Browser again.")
		}
		// Start may have been pressed again meanwhile, with a newer code.
		if tries >= 2 || !conn.reload() {
			askForStart()
			return
		}
	}
	// Without -proxy, the proxy saved in the app's settings is used, if there is one.
	if *proxyURL == "" {
		*proxyURL = saved.Proxy.URL()
	}

	engine := browser.NewEngine()
	closeEngine := func() {
		if err := engine.Close(); err != nil {
			log.Printf("[-] Error closing browser engine: %v\n", err)
		}
	}

	// 1. Tell KIASA how this browser is, for as long as it is open. Only a short
	// status is sent, never a page. This starts before the slow steps, so the Auto
	// apply page can say what is happening: the app has no window of its own.
	status := newStatusBoard()
	linkCtx, cancelLink := context.WithCancel(context.Background())
	linkDone := make(chan struct{})
	go func() {
		defer close(linkDone)
		link.Keep(linkCtx, conn.current, status.current, func() bool {
			if conn.reload() {
				return true
			}
			// A browser KIASA no longer accepts is closed, not left to be used.
			log.Println("[!] KIASA no longer accepts this browser, so it is closing.")
			closeEngine()
			winmsg.Info("KIASA Browser", "This KIASA Browser was disconnected from KIASA, so it closed. To open it again, press Start the KIASA Browser on the Auto apply page of KIASA.")
			os.Exit(1)
			return false
		})
	}()
	stopLink := func() { cancelLink(); <-linkDone }
	defer stopLink()
	defer closeEngine()
	log.Println("[+] Connected to KIASA: this browser's status is shown on the Auto apply page.")

	// failStart says what went wrong, on the Auto apply page and in a message box.
	failStart := func(detail, format string, args ...any) {
		status.set("error", detail)
		closeEngine()
		stopLink()
		fatalf(format, args...)
	}

	// Start pressed while the browser is open: take the new code, if there is one,
	// and show the window.
	var opened atomic.Bool
	go func() {
		for range wake {
			conn.reload()
			if opened.Load() {
				if err := engine.BringToFront(); err != nil {
					log.Printf("[!] Could not bring the browser forward: %v\n", err)
				}
			}
		}
	}()

	if *channel == "auto" {
		if _, err := findChrome(); err != nil {
			failStart("Google Chrome is not installed on this PC.", "%v", err)
		}
	}

	// 2. Pre-flight Proxy Check
	log.Println("[*] Running pre-flight network verification...")
	status.set("idle", "Checking the connection.")
	egressIP, err := proxy.ValidateProxy(*proxyURL)
	if err != nil {
		log.Printf("[-] Network validation failed: %v\n", err)
		failStart("Could not connect to the internet through its proxy.", "The proxy did not work. %s Open KIASA Settings from the Start menu to change it.", settingsui.Explain(err))
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
	log.Println("[*] Preparing the browser. The first time this downloads about 100 MB, so it can take a minute.")
	status.set("idle", "Preparing the browser. The first start downloads about 100 MB.")
	driver, err := prepareDriver()
	if err != nil {
		log.Printf("[-] Preparing the browser failed: %v\n", err)
		failStart("Could not prepare the browser for first use.", "KIASA could not prepare its browser for first use. Check your internet connection and press Start the KIASA Browser again. If it keeps happening, send the file %s to KIASA.", brand.LogPath())
	}
	status.set("idle", "Opening the browser.")
	page, err := engine.Start(browser.LaunchOptions{
		Driver:        driver,
		ProfileName:   *profile,
		ProfileDir:    profileDir(*profile),
		Headless:      *headless,
		ProxyURL:      *proxyURL,
		Channel:       requestedChannel,
		Timezone:      timezone,
		FixedViewport: *fixedViewport,
	})
	if err != nil {
		log.Printf("[-] Browser launch failed: %v\n", err)
		failStart("The browser could not open.", "The browser could not start. Please try again; if it keeps happening, send the file %s to KIASA.", brand.LogPath())
	}
	opened.Store(true)
	log.Printf("[+] Browser launched (%s).\n", engine.Channel())

	// 4. Open the page showing this browser's IP address, or the fingerprint test when
	// asked. Nothing more to say then: the Auto apply page words this state itself.
	if *stealthCheck {
		runStealthCheck(page, endRun)
		status.set("idle", "")
	} else {
		status.set("idle", "")
		log.Printf("[*] Opening %s...\n", brand.StartPage)
		// That page is someone else's. If it fails, the browser is still open and usable.
		if _, err := page.Goto(brand.StartPage, playwright.PageGotoOptions{
			Timeout:   playwright.Float(60000),
			WaitUntil: playwright.WaitUntilStateDomcontentloaded,
		}); err != nil {
			log.Printf("[!] Could not open the IP page: %v\n", err)
		}
		// The agent works in tabs of its own, for as long as the browser is open.
		go agent.Run(linkCtx, agent.Config{
			Code:    conn.current,
			NewTab:  engine.NewTab,
			Status:  status.set,
			WorkDir: filepath.Join(brand.DataDir(), "work"),
		})
	}

	if keepOpen {
		waitForUser()
		log.Println("[+] Done.")
	}
}

// showSettings opens the settings window and waits for it. What is saved there is
// used the next time the browser starts.
func showSettings() {
	exe, err := findChrome()
	if err != nil {
		fatalf("%v", err)
	}
	_, err = settingsui.Show(settingsui.Options{
		BrowserExe:    exe,
		WindowProfile: filepath.Join(brand.DataDir(), "SettingsWindow"),
		SettingsPath:  brand.SettingsPath(),
		Check:         proxy.ValidateProxy,
	})
	if err != nil {
		fatalf("Could not open the settings window: %v", err)
	}
}

// askForStart explains how the browser is opened, when it was opened any other way
// and has no code KIASA accepts.
func askForStart() {
	log.Println("[*] Not connected to KIASA, so the browser did not start.")
	winmsg.Info("KIASA Browser", "To open the KIASA Browser, press Start the KIASA Browser on the Auto apply page of KIASA. That page opens now.")
	if err := brand.OpenApplyPage(); err != nil {
		log.Printf("[!] Could not open the Auto apply page: %v\n", err)
	}
}

// connection is the code this browser reports with. A new one can arrive while it
// runs, when Start is pressed again.
type connection struct {
	mu   sync.Mutex
	text string
	code link.Code
}

func (c *connection) current() link.Code {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.code
}

// reload takes the saved code if it is a new one, and says whether it did.
func (c *connection) reload() bool {
	saved, err := settings.Load(brand.SettingsPath())
	if err != nil {
		return false
	}
	code, err := link.Parse(saved.Link)
	if err != nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if saved.Link == c.text {
		return false
	}
	c.text, c.code = saved.Link, code
	return true
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
	log.Printf("[*] Navigating to %s...\n", targetURL)
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
		log.Printf("[!] Page still busy after 10s, so the report may be incomplete: %v\n", err)
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
	log.Printf("[+] Report saved to %s\n", reportPath)
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

// fatalf ends the program with a message that stays on the screen until it is read.
func fatalf(format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	log.Println("[-] " + message)
	winmsg.Error("KIASA Browser", message)
	os.Exit(1)
}

// keepLog also writes the log to a file in the app's data folder, which is started
// afresh when it grows past a megabyte. It returns what closes the file.
func keepLog() func() {
	path := brand.LogPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return func() {}
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if info, err := os.Stat(path); err == nil && info.Size() > 1<<20 {
		flags = os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	}
	file, err := os.OpenFile(path, flags, 0o600)
	if err != nil {
		return func() {}
	}
	// The file comes first: a console that is not there must not stop it being written.
	log.SetOutput(io.MultiWriter(file, os.Stderr))
	return func() { file.Close() }
}

// driverOptions says where the driver is. Each use gets its own: the library fills
// in an options value it is given, and one that was filled in earlier makes it take
// over the program's log.
func driverOptions() *playwright.RunOptions {
	return &playwright.RunOptions{
		DriverDirectory: brand.DriverHome(),
		// Chrome itself is already installed, as the settings window needs it.
		SkipInstallBrowsers: true,
	}
}

// prepareDriver makes sure the driver that controls Chrome is on this computer. It
// is downloaded once (about 100 MB), into the app's data folder, so a computer that
// has never run it works too. It returns the options to start the browser with.
func prepareDriver() (*playwright.RunOptions, error) {
	driver, err := playwright.NewDriver(driverOptions())
	if err != nil {
		return nil, err
	}
	if err := driver.DownloadDriver(); err != nil {
		return nil, err
	}
	return driverOptions(), nil
}
