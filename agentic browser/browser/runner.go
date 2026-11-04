package browser

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/mxschmitt/playwright-go"

	"stealth-app/proxy"
)

type LaunchOptions struct {
	// ProfileName is a folder under ./profiles.
	ProfileName string
	// ProfileDir is the full path of the profile folder, used instead of ProfileName.
	ProfileDir string
	Headless   bool
	ProxyURL   string
	// Channel is "chrome", "chromium", or "" to use an installed Google Chrome
	// when there is one.
	Channel string
	// ExecutablePath runs the browser in this file instead of an installed one.
	// Channel is then ignored.
	ExecutablePath string
	// Driver tells Playwright where its driver is and where its output goes. Nil
	// means its usual folder and this program's console.
	Driver *playwright.RunOptions
	// Timezone is an IANA zone name such as "Europe/Berlin", or "" to keep this
	// computer's time zone.
	Timezone string
	// FixedViewport gives a visible window a fixed 1920x1080 viewport instead of
	// its real size. Headless always uses 1920x1080.
	FixedViewport bool
}

type Engine struct {
	pw        *playwright.Playwright
	context   playwright.BrowserContext
	channel   string
	forwarder *proxy.Forwarder
}

func NewEngine() *Engine {
	return &Engine{}
}

// Channel reports which browser Start launched: "chrome", "chromium", or "custom"
// for one given by ExecutablePath.
func (e *Engine) Channel() string {
	return e.channel
}

// BringToFront shows the browser's window, on its newest tab.
func (e *Engine) BringToFront() error {
	if e.context == nil {
		return nil
	}
	pages := e.context.Pages()
	if len(pages) == 0 {
		return nil
	}
	return pages[len(pages)-1].BringToFront()
}

func (e *Engine) Start(opts LaunchOptions) (playwright.Page, error) {
	profilePath := opts.ProfileDir
	if profilePath == "" {
		if opts.ProfileName == "" {
			opts.ProfileName = "default"
		}
		var err error
		profilePath, err = filepath.Abs(filepath.Join("profiles", opts.ProfileName))
		if err != nil {
			return nil, fmt.Errorf("invalid profile directory path: %w", err)
		}
	}
	if err := os.MkdirAll(profilePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create profile directory: %w", err)
	}

	var errPw error
	if opts.Driver != nil {
		e.pw, errPw = playwright.Run(opts.Driver)
	} else {
		e.pw, errPw = playwright.Run()
	}
	if errPw != nil {
		return nil, fmt.Errorf("failed to start Playwright driver: %w", errPw)
	}

	// 1. Stealth comes from running the real browser unmodified, not from patching
	// it. Chromium already reports a consistent user agent, client hints, plugins,
	// window.chrome and GPU strings, and overriding any of them makes the
	// fingerprint contradict itself. What does give an automated browser away is
	// removed in stealth.go: the browser build, a few switches Playwright adds,
	// and (in headless) the "Headless" marker in the user agent.
	e.channel = browserChannel(opts.Channel)
	if opts.ExecutablePath != "" {
		e.channel = customChannel
	}

	// A visible window reports its real size, screen and pixel ratio, as a
	// person's browser does. A fixed 1920x1080 viewport cannot fit in a window on
	// a screen that is 1080 pixels tall, so a page would see an inner window
	// larger than the outer one, and on a scaled display the emulation skews the
	// pixel ratio. So a visible window is maximized instead, unless a fixed
	// viewport is asked for.
	native := !opts.Headless && !opts.FixedViewport
	windowArg := "--window-size=1920,1080"
	if native {
		windowArg = "--start-maximized"
	}

	contextOpts := playwright.BrowserTypeLaunchPersistentContextOptions{
		Headless:          playwright.Bool(opts.Headless),
		IgnoreDefaultArgs: ignoredDefaultArgs(opts.Headless),
		// Playwright turns Chrome's sandbox off unless told otherwise. It limits what
		// a dangerous page can do to the computer, and leaving it on changes nothing
		// a page can measure.
		ChromiumSandbox: playwright.Bool(true),
		// Playwright forces prefers-color-scheme to "light" unless told not to,
		// which can disagree with the real setting that Chrome reports elsewhere
		// (the Sec-CH-Prefers-Color-Scheme hint).
		ColorScheme: playwright.ColorSchemeNoOverride,
		Args: []string{
			"--disable-blink-features=AutomationControlled",
			"--disable-infobars",
			windowArg,
		},
	}
	if opts.ExecutablePath != "" {
		contextOpts.ExecutablePath = playwright.String(opts.ExecutablePath)
	} else {
		contextOpts.Channel = playwright.String(e.channel)
	}
	if native {
		contextOpts.NoViewport = playwright.Bool(true)
	} else {
		// 2. Match viewport to window-size to fix inner/outer window mismatch
		contextOpts.Viewport = &playwright.Size{Width: 1920, Height: 1080}
	}

	if opts.Headless {
		userAgent, err := e.headlessUserAgent(e.channel, opts.ExecutablePath)
		if err != nil {
			e.Close()
			return nil, fmt.Errorf("failed to prepare headless browser: %w", err)
		}
		if userAgent != "" {
			// Set through the context rather than the --user-agent flag: the flag
			// blanks the high-entropy client hints (architecture, bitness, full
			// version), which a real Chrome always reports.
			contextOpts.UserAgent = playwright.String(userAgent)
		}
	}

	if opts.Timezone != "" {
		contextOpts.TimezoneId = playwright.String(opts.Timezone)
	}

	if opts.ProxyURL != "" {
		parsedProxy, err := url.Parse(opts.ProxyURL)
		if err == nil && parsedProxy.Host != "" {
			p := &playwright.Proxy{
				Server: opts.ProxyURL,
			}
			if parsedProxy.User != nil {
				if parsedProxy.Scheme == "http" || parsedProxy.Scheme == "https" {
					// The browser gets a local proxy with no login, and the forwarder
					// adds the login. If Playwright handled the login, Google and Gmail
					// would never finish loading; proxy.Forwarder explains why.
					forwarder, err := proxy.NewForwarder(opts.ProxyURL)
					if err != nil {
						e.Close()
						return nil, fmt.Errorf("failed to start the proxy forwarder: %w", err)
					}
					e.forwarder = forwarder
					p.Server = forwarder.URL()
				} else {
					p.Username = playwright.String(parsedProxy.User.Username())
					if pass, ok := parsedProxy.User.Password(); ok {
						p.Password = playwright.String(pass)
					}
				}
			}
			contextOpts.Proxy = p
		}
	}

	// With a proxy, WebRTC must not be able to bypass it, so this fails closed:
	// without the restriction in place the browser is not launched.
	if err := setWebRTCPolicy(profilePath, contextOpts.Proxy != nil); err != nil {
		e.Close()
		return nil, fmt.Errorf("failed to restrict WebRTC in the profile: %w", err)
	}

	var err error
	e.context, err = e.pw.Chromium.LaunchPersistentContext(profilePath, contextOpts)
	if err != nil {
		e.context = nil
		e.Close()
		return nil, fmt.Errorf("failed to launch persistent browser context: %w", err)
	}

	pages := e.context.Pages()
	var page playwright.Page
	if len(pages) > 0 {
		page = pages[0]
	} else {
		page, err = e.context.NewPage()
		if err != nil {
			e.Close()
			return nil, err
		}
	}

	return page, nil
}

func (e *Engine) Close() error {
	var errContext, errPw error
	if e.context != nil {
		errContext = e.context.Close()
	}
	if e.forwarder != nil {
		e.forwarder.Close()
	}
	if e.pw != nil {
		errPw = e.pw.Stop()
	}
	if errContext != nil {
		return errContext
	}
	return errPw
}

// WaitUntilClosed blocks until the browser has no window left, which is what
// closing its last window does, or until stop is closed, whichever comes first.
// Close should still be called afterwards.
func (e *Engine) WaitUntilClosed(stop <-chan struct{}) {
	ctx := e.context
	if ctx == nil {
		return
	}

	gone := make(chan struct{})
	var once sync.Once
	signalGone := func() { once.Do(func() { close(gone) }) }

	ctx.OnClose(func(playwright.BrowserContext) { signalGone() })
	// Chrome can keep running in the background after its last window is closed,
	// and then the context never closes, so an empty page list counts as closed.
	ctx.OnPageClose(func(playwright.Page) {
		go func() {
			time.Sleep(700 * time.Millisecond) // let the page list settle
			if len(ctx.Pages()) == 0 {
				signalGone()
			}
		}()
	})

	select {
	case <-gone:
		// Already closed when the user closed the last window; this finishes the
		// job if Chrome kept running, so the error can be ignored.
		ctx.Close()
		e.context = nil
	case <-stop:
	}
}
