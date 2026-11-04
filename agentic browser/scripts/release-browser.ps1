# Gets a KIASA Browser release ready: builds the installer, zips it for people installing by hand,
# and signs the file that tells browsers to update. It publishes nothing: the setup and zip still
# have to go on a GitHub release, and members only get it once apps/web/public/browser/latest.json
# reaches the live site. Publish the release first, or browsers will find nothing to download.
#
# Usage: scripts\release-browser.ps1 -Version 1.3.0
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [switch]$Rollback
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$setup = Join-Path $dist "KIASA-Setup.exe"
$zip = Join-Path $dist "KIASA-Browser.zip"
$manifest = Join-Path (Split-Path -Parent $root) "apps\web\public\browser\latest.json"
$address = "https://github.com/KIASA-Org/KIASA/releases/download/browser-$Version/KIASA-Setup.exe"

& (Join-Path $PSScriptRoot "build-installer.ps1") -Version $Version
Compress-Archive -Path $setup -DestinationPath $zip -Force

Push-Location $root
try {
    $flags = @("-version", $Version, "-url", $address, "-file", $setup, "-out", $manifest)
    if ($Rollback) { $flags += "-rollback" }
    & go run ./tools/signrelease @flags
    if ($LASTEXITCODE -ne 0) { throw "Signing the release failed." }
}
finally {
    Pop-Location
}

Write-Output "Ready to publish: $setup and $zip, as the GitHub release browser-$Version."
