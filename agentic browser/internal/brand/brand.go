// Package brand holds the names and places that make this browser KIASA.
package brand

import (
	"os"
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
	// StartPage opens when the browser starts.
	StartPage = "https://www.kiasa.tech/"
	// ApplyPage is where the browser opens: KIASA's Auto apply page.
	ApplyPage = "https://www.kiasa.tech/apply"
	// MutexName keeps a second copy of the app from starting.
	MutexName = `Local\KIASA-Browser-App`
	// BrowserExeName is the renamed browser inside the browser folder.
	BrowserExeName = "kiasa-browser.exe"
	// UninstallKey is the installed app's entry under HKEY_CURRENT_USER.
	UninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\KIASA`
	// PolicyKey is where the installer sets the browser's own policies, under
	// HKEY_CURRENT_USER. Google Chrome reads a different key, so it is not affected.
	PolicyKey = `Software\Policies\Chromium`
)

// Version is set when the installer is built.
var Version = "dev"

// InstallDir is where the installer puts the app, for this Windows user only.
func InstallDir() string {
	return filepath.Join(localAppData(), "Programs", Name)
}

// DataDir holds what belongs to the person and survives an update: settings, the
// browser profile and logs.
func DataDir() string {
	return filepath.Join(localAppData(), Name)
}

// SettingsPath is the settings file.
func SettingsPath() string {
	return filepath.Join(DataDir(), "settings.json")
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

func localAppData() string {
	if dir := os.Getenv("LOCALAPPDATA"); dir != "" {
		return dir
	}
	if dir, err := os.UserCacheDir(); err == nil {
		return dir
	}
	return os.TempDir()
}
