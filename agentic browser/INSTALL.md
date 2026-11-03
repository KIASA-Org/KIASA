# KIASA for Windows

## Build the installer

On Windows with Go installed, run this from the project folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

The script builds `dist\KIASA.exe` and the per-user `dist\KIASA-Setup.exe`.
To set the displayed version, pass a semantic version:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1 -Version 1.2.3
```

## Install

Run `KIASA-Setup.exe`. It installs KIASA under the current user's
`%LOCALAPPDATA%\Programs\KIASA`, creates Start Menu and Desktop shortcuts, and
adds an uninstall entry for that user. It does not require administrator
privileges.

KIASA uses an installed Google Chrome when available. If Chrome is not installed,
the matching Playwright Chromium browser runtime must already be present; the
installer does not download or bundle browser software.

## Uninstall

Use **Uninstall KIASA** from Windows Installed Apps, or run
`Uninstall KIASA.exe` from the installation folder. Uninstall removes the
shortcuts and application files, but preserves settings, browser profiles, and
reports under `%LOCALAPPDATA%\KIASA`.
