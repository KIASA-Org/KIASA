# Builds the KIASA Browser for trying it against the local test copy of KIASA, and registers its
# own link, so the Start button on the local site (http://127.0.0.1:3002) opens it. It keeps its
# own settings and browser profile, and the real KIASA Browser is left exactly as it is.
#
# Only this build accepts a local database. The installer's build, made by build-installer.ps1,
# is still locked to KIASA's own, so a website cannot point it anywhere else.
param(
    [string]$Database = "127.0.0.1:54321",
    [string]$Site = "http://127.0.0.1:3002"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "dist\local"
$app = Join-Path $outDir "KIASA-local.exe"
$scheme = "kiasa-browser-local"
$brand = "stealth-app/internal/brand"
$flags = @(
    "-X $brand.LocalTest=on",
    "-X $brand.Version=local-test",
    "-X $brand.DatabaseHost=$Database",
    "-X $brand.SiteURL=$Site",
    "-X $brand.AppLinkScheme=$scheme",
    "-X $brand.DataFolder=KIASA-LocalTest",
    "-X 'stealth-app/internal/brand.MutexName=Local\KIASA-Browser-LocalTest'",
    "-H windowsgui"
) -join " "

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Push-Location $root
try {
    & go build -trimpath -ldflags $flags -o $app .
    if ($LASTEXITCODE -ne 0) {
        throw "Building the local test browser failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

$key = "HKCU:\Software\Classes\$scheme"
New-Item -Path $key -Force | Out-Null
Set-Item -Path $key -Value "URL:KIASA Browser (local test)"
New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-Item -Path "$key\shell\open\command" -Value "`"$app`" `"%1`""

Write-Output "Built $app and registered the $scheme link."
