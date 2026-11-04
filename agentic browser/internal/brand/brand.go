// Package brand holds the names and places that make this browser KIASA.
package brand

import (
	"os"
	"os/exec"
	"path/filepath"
)

const (
	// Name is the product name people see.
	Name = "KIASA"
	// Publisher is shown in the list of installed apps.
	Publisher = "KIASA"
	// AppID is how Windows recognises the app. The shortcuts and the browser's
	// windows share it, so they appear as one app on the taskbar.
	AppID = "KIASA.Browser"
	// StartPage opens when the browser starts: it shows the IP address and location
	// websites see, so a member can check their connection at a glance.
	StartPage = "https://browserleaks.com/ip"
	// BrowserExeName is the renamed browser inside the browser folder.
	BrowserExeName = "kiasa-browser.exe"
	// PolicyKey is where the installer sets the browser's own policies, under
	// HKEY_CURRENT_USER. Google Chrome reads a different key, so it is not affected.
	PolicyKey = `Software\Policies\Chromium`
)

// Version is set when the installer is built.
var Version = "dev"

// These are KIASA's own. Only the local test build (scripts/build-local-test.ps1) sets them
// differently, when it is compiled: nothing that runs afterwards can change them.
var (
	// SiteURL is KIASA's website.
	SiteURL = "https://www.kiasa.tech"
	// AppLinkScheme is the kind of link that opens the app, as the Start button on the
	// Auto apply page does. Setup registers it.
	AppLinkScheme = "kiasa-browser"
	// DatabaseHost is where KIASA's database is. A link that opens the app may only
	// connect it to this one.
	DatabaseHost = "lghgwvqgigbmcnxbhdwi.supabase.co"
	// MutexName keeps a second copy of the app from starting.
	MutexName = `Local\KIASA-Browser-App`
	// DataFolder is the folder of the app's own data, under the user's local app data.
	DataFolder = Name
	// LocalTest is "on" only in the local test build.
	LocalTest = ""
	// InstallFolder is the folder of the program itself, under the user's Programs folder.
	InstallFolder = Name
	// UninstallKey is the installed app's entry under HKEY_CURRENT_USER.
	UninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\KIASA`
	// UpdateKey is the public half of the release key: the browser installs an update only if
	// that key's private half signed it. The private half is on the owner's PC, and nowhere else.
	UpdateKey = "5CBLYAOfaTjwKYvR8w4Tb6dBIAUOU6obDKoaTLp3AoA="
	// UpdateFile is where the browser reads which version is current. Empty means the site's.
	UpdateFile = ""
)

// UpdateAddress is where the browser reads which version is current.
func UpdateAddress() string {
	if UpdateFile != "" {
		return UpdateFile
	}
	return SiteURL + "/browser/latest.json"
}

// UpdateDir holds a downloaded update until it is installed.
func UpdateDir() string {
	return filepath.Join(DataDir(), "update")
}

// IsLocalTest says this is the build for trying the app against a local copy of KIASA.
func IsLocalTest() bool { return LocalTest == "on" }

// InstallDir is where the installer puts the app, for this Windows user only.
func InstallDir() string {
	return filepath.Join(localAppData(), "Programs", InstallFolder)
}

// DataDir holds what belongs to the person and survives an update: settings, the
// browser profile and logs.
func DataDir() string {
	return filepath.Join(localAppData(), DataFolder)
}

// DriverHome is where the driver that controls Chrome is kept. It is a 100 MB download, so
// the local test build shares the one the app already has.
func DriverHome() string {
	return filepath.Join(localAppData(), Name, "driver")
}

// SettingsPath is the settings file.
func SettingsPath() string {
	return filepath.Join(DataDir(), "settings.json")
}

// LogPath is the log file.
func LogPath() string {
	return filepath.Join(LogDir(), "kiasa.log")
}

// ProfileDir is the browser profile.
func ProfileDir() string {
	return filepath.Join(DataDir(), "Profile")
}

// LogDir holds the app's log files.
func LogDir() string {
	return filepath.Join(DataDir(), "logs")
}

// AppExe is the program people start, inside an install folder.
func AppExe(installDir string) string {
	return filepath.Join(installDir, "KIASA.exe")
}

// UninstallExe is the uninstaller, inside an install folder.
func UninstallExe(installDir string) string {
	return filepath.Join(installDir, "Uninstall KIASA.exe")
}

// BrowserExe is the renamed browser, inside an install folder.
func BrowserExe(installDir string) string {
	return filepath.Join(installDir, "browser", BrowserExeName)
}

// DriverDir is Playwright's driver, inside an install folder.
func DriverDir(installDir string) string {
	return filepath.Join(installDir, "driver")
}

// OpenApplyPage opens KIASA's Auto apply page in the person's usual browser, where
// they are signed in and can press Start.
func OpenApplyPage() error {
	return exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", SiteURL+"/apply").Start()
}

func localAppData() string {
	if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
		return dir
	}
	if dir, err := os.UserCacheDir(); err == nil {
		return dir
	}
	return os.TempDir()
}
