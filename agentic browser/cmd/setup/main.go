package main

import (
	"archive/zip"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"unicode/utf16"

	"stealth-app/internal/brand"
	"stealth-app/internal/winmsg"
)

const payloadMarker = "KIASA001"

func main() {
	uninstall := flag.Bool("uninstall", false, "uninstall KIASA")
	verify := flag.Bool("verify", false, "check the embedded installation files")
	installDir := flag.String("dir", "", "installation directory (defaults to the current user's Programs folder)")
	flag.Parse()

	dir := *installDir
	if dir == "" {
		dir = brand.InstallDir()
	}

	var err error
	switch {
	case *verify:
		err = verifyPayload()
	case *uninstall:
		err = uninstallApp(dir)
	default:
		err = installApp(dir)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "KIASA setup failed:", err)
		winmsg.Error("KIASA Setup", "KIASA could not be installed.\n\n"+err.Error()+"\n\nIf the KIASA Browser is open, close it and run this again.")
		os.Exit(1)
	}
	// The browser is opened from the Auto apply page, which connects it to KIASA, so
	// that page is where the person goes next.
	if !*verify && !*uninstall {
		winmsg.Info("KIASA Setup", "KIASA is installed. Go back to the Auto apply page of KIASA and press Start the KIASA Browser.")
		if err := brand.OpenApplyPage(); err != nil {
			fmt.Fprintln(os.Stderr, "Could not open the Auto apply page:", err)
		}
	}
}

func verifyPayload() error {
	files, err := readPayload()
	if err != nil {
		return err
	}
	for _, name := range []string{"KIASA.exe", "kiasa.ico"} {
		if len(files[name]) == 0 {
			return fmt.Errorf("installation package is missing %s", name)
		}
	}
	fmt.Println("Installation package is valid.")
	return nil
}

func installApp(installDir string) error {
	files, err := readPayload()
	if err != nil {
		return err
	}
	if len(files["KIASA.exe"]) == 0 || len(files["kiasa.ico"]) == 0 {
		return errors.New("installation package is missing KIASA.exe or kiasa.ico")
	}
	if runtime.GOOS != "windows" {
		return errors.New("KIASA setup is for Windows")
	}

	if err := os.MkdirAll(installDir, 0o755); err != nil {
		return fmt.Errorf("creating installation folder: %w", err)
	}
	for name, data := range files {
		mode := os.FileMode(0o644)
		if name == "KIASA.exe" {
			mode = 0o755
		}
		if err := writeFile(filepath.Join(installDir, name), data, mode); err != nil {
			return fmt.Errorf("installing %s: %w", name, err)
		}
	}

	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locating setup executable: %w", err)
	}
	if err := copyFile(executable, brand.UninstallExe(installDir)); err != nil {
		return fmt.Errorf("installing the uninstaller: %w", err)
	}

	if err := createShortcuts(installDir); err != nil {
		return fmt.Errorf("creating shortcuts: %w", err)
	}
	if err := registerApp(installDir); err != nil {
		return fmt.Errorf("registering the uninstall entry: %w", err)
	}
	if err := registerLink(installDir); err != nil {
		return fmt.Errorf("registering the link that opens KIASA: %w", err)
	}

	fmt.Printf("KIASA %s was installed to %s\n", brand.Version, installDir)
	fmt.Println("Your settings and browser profiles are stored separately and are not removed by uninstalling.")
	return nil
}

func readPayload() (map[string][]byte, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("locating setup executable: %w", err)
	}
	file, err := os.Open(executable)
	if err != nil {
		return nil, fmt.Errorf("opening setup executable: %w", err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("checking setup executable: %w", err)
	}
	const footerSize = 16
	if info.Size() < footerSize {
		return nil, errors.New("setup executable has no installation payload; build it with scripts\\build-installer.ps1")
	}
	footer := make([]byte, footerSize)
	if _, err := file.ReadAt(footer, info.Size()-footerSize); err != nil {
		return nil, fmt.Errorf("reading installation payload footer: %w", err)
	}
	if string(footer[:8]) != payloadMarker {
		return nil, errors.New("setup executable has no valid installation payload; build it with scripts\\build-installer.ps1")
	}
	payloadSize := binary.LittleEndian.Uint64(footer[8:])
	if payloadSize == 0 || payloadSize > uint64(info.Size()-footerSize) {
		return nil, errors.New("setup executable has an invalid installation payload size")
	}
	payloadOffset := info.Size() - footerSize - int64(payloadSize)
	reader, err := zip.NewReader(io.NewSectionReader(file, payloadOffset, int64(payloadSize)), int64(payloadSize))
	if err != nil {
		return nil, fmt.Errorf("opening installation payload: %w", err)
	}

	files := make(map[string][]byte, 2)
	for _, entry := range reader.File {
		if entry.Name != "KIASA.exe" && entry.Name != "kiasa.ico" {
			return nil, fmt.Errorf("unexpected file in installation payload: %q", entry.Name)
		}
		if _, exists := files[entry.Name]; exists {
			return nil, fmt.Errorf("duplicate file in installation payload: %q", entry.Name)
		}
		rc, err := entry.Open()
		if err != nil {
			return nil, fmt.Errorf("opening %s in installation payload: %w", entry.Name, err)
		}
		data, readErr := io.ReadAll(io.LimitReader(rc, 256<<20))
		closeErr := rc.Close()
		if readErr != nil {
			return nil, fmt.Errorf("reading %s in installation payload: %w", entry.Name, readErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("closing %s in installation payload: %w", entry.Name, closeErr)
		}
		if len(data) == 256<<20 {
			return nil, fmt.Errorf("%s in installation payload is too large", entry.Name)
		}
		files[entry.Name] = data
	}
	return files, nil
}

func writeFile(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func copyFile(source, destination string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return writeFile(destination, data, 0o755)
}

func createShortcuts(installDir string) error {
	startMenu := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "KIASA")
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$target = %s
$icon = %s
$working = %s
$startMenu = %s
$desktop = [Environment]::GetFolderPath('Desktop')
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
foreach ($path in @((Join-Path $startMenu 'KIASA.lnk'), (Join-Path $desktop 'KIASA.lnk'))) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $target
  $shortcut.WorkingDirectory = $working
  $shortcut.IconLocation = $icon
  $shortcut.Save()
}
$shortcut = $shell.CreateShortcut((Join-Path $startMenu 'KIASA Settings.lnk'))
$shortcut.TargetPath = $target
$shortcut.Arguments = '-settings'
$shortcut.WorkingDirectory = $working
$shortcut.IconLocation = $icon
$shortcut.Save()
`, psQuote(brand.AppExe(installDir)), psQuote(filepath.Join(installDir, "kiasa.ico")),
		psQuote(installDir), psQuote(startMenu))
	return runPowerShell(script)
}

func registerApp(installDir string) error {
	values := map[string]string{
		"DisplayName":          brand.Name,
		"DisplayVersion":       brand.Version,
		"Publisher":            brand.Publisher,
		"InstallLocation":      installDir,
		"DisplayIcon":          filepath.Join(installDir, "kiasa.ico"),
		"UninstallString":      fmt.Sprintf(`"%s" --uninstall`, brand.UninstallExe(installDir)),
		"QuietUninstallString": fmt.Sprintf(`"%s" --uninstall`, brand.UninstallExe(installDir)),
	}
	key := `HKCU\` + brand.UninstallKey
	for name, value := range values {
		if err := run("reg.exe", "add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"); err != nil {
			return err
		}
	}
	for name, value := range map[string]string{"NoModify": "1", "NoRepair": "1"} {
		if err := run("reg.exe", "add", key, "/v", name, "/t", "REG_DWORD", "/d", value, "/f"); err != nil {
			return err
		}
	}
	return nil
}

// linkKey is where the link that opens the app is registered, for this Windows user.
func linkKey() string {
	return `HKCU\Software\Classes\` + brand.AppLinkScheme
}

// registerLink lets this Windows user's browsers open the app from a link, which is
// what the Start button on the Auto apply page does.
func registerLink(installDir string) error {
	key := linkKey()
	for _, args := range [][]string{
		{"add", key, "/ve", "/t", "REG_SZ", "/d", "URL:KIASA Browser", "/f"},
		{"add", key, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"},
		{"add", key + `\DefaultIcon`, "/ve", "/t", "REG_SZ", "/d", filepath.Join(installDir, "kiasa.ico"), "/f"},
		{"add", key + `\shell\open\command`, "/ve", "/t", "REG_SZ", "/d", fmt.Sprintf(`"%s" "%%1"`, brand.AppExe(installDir)), "/f"},
	} {
		if err := run("reg.exe", args...); err != nil {
			return err
		}
	}
	return nil
}

func uninstallApp(installDir string) error {
	if runtime.GOOS != "windows" {
		return errors.New("KIASA setup is for Windows")
	}
	startMenu := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "KIASA")
	if err := runPowerShell(fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
Remove-Item -LiteralPath %s -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) 'KIASA.lnk') -Force -ErrorAction SilentlyContinue
`, psQuote(startMenu))); err != nil {
		return fmt.Errorf("removing shortcuts: %w", err)
	}
	if err := run("reg.exe", "delete", `HKCU\`+brand.UninstallKey, "/f"); err != nil {
		return fmt.Errorf("removing the uninstall entry: %w", err)
	}
	// Older versions did not register it, so it may not be there.
	if err := run("reg.exe", "delete", linkKey(), "/f"); err != nil {
		fmt.Println("The link that opens KIASA was not removed; it may never have been there.")
	}

	pid := os.Getpid()
	cleanupLog := filepath.Join(os.TempDir(), "KIASA-uninstall.log")
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
try {
  while (Get-Process -Id %d -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }
  Remove-Item -LiteralPath %s -Recurse -Force
  'KIASA application files removed.' | Set-Content -LiteralPath %s
} catch {
  $_ | Out-File -LiteralPath %s
}
`, pid, psQuote(installDir), psQuote(cleanupLog), psQuote(cleanupLog))
	if err := startPowerShellHidden(script); err != nil {
		return fmt.Errorf("starting application-file cleanup: %w", err)
	}
	fmt.Println("KIASA was unregistered. Its application files will be removed after this window closes.")
	fmt.Println("Settings and browser profiles were kept.")
	return nil
}

func run(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w: %s", name, err, strings.TrimSpace(string(output)))
	}
	return nil
}

func runPowerShell(script string) error {
	encoded := encodePowerShell(script)
	return run("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded)
}

func startPowerShellHidden(script string) error {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script))
	return cmd.Start()
}

func encodePowerShell(script string) string {
	units := utf16.Encode([]rune(script))
	data := make([]byte, len(units)*2)
	for i, unit := range units {
		binary.LittleEndian.PutUint16(data[i*2:], unit)
	}
	return base64.StdEncoding.EncodeToString(data)
}

func psQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
