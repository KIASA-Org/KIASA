# Sets up the KIASA Model Server on the PC that has the model: builds the program, gets Cloudflare's
# cloudflared for its tunnel (checking it against the checksum Cloudflare publishes), and puts a
# shortcut on the desktop. Run it again after changing the server, to build it afresh.
#
# It needs the owner's master prompt in internal/modelserver/prompts/, which is not in the public
# repository, and KIASA's public key, the one every page of the site has.
param(
    [string]$PublicKey = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$home_ = Join-Path $env:LOCALAPPDATA "KIASA\model-server"
$tunnelDir = Join-Path $home_ "tunnel"
$app = Join-Path $home_ "KIASA-Model-Server.exe"
$cloudflared = Join-Path $tunnelDir "cloudflared.exe"
$icon = Join-Path $home_ "kiasa.ico"

if (-not $PublicKey) {
    $envFile = Join-Path (Split-Path -Parent $root) "apps\web\.env.local"
    $line = Get-Content $envFile | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' } | Select-Object -First 1
    $PublicKey = ($line -replace '^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=', '').Trim('"')
}
if (-not $PublicKey) { throw "KIASA's public key was not found." }

New-Item -ItemType Directory -Force -Path $tunnelDir | Out-Null

# A running copy holds its program open.
Get-Process -Name "KIASA-Model-Server" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

Push-Location $root
try {
    & go build -trimpath -ldflags "-X main.defaultPublicKey=$PublicKey" -o $app .\cmd\modelserver
    if ($LASTEXITCODE -ne 0) { throw "Building the model server failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}

if (-not (Test-Path $cloudflared)) {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/cloudflare/cloudflared/releases/latest" -Headers @{ "User-Agent" = "KIASA" }
    $asset = $release.assets | Where-Object { $_.name -eq "cloudflared-windows-amd64.exe" }
    $published = ($release.body -split "`n" | Where-Object { $_ -match 'cloudflared-windows-amd64\.exe:\s*([0-9a-f]{64})' } | Select-Object -First 1)
    if (-not $asset -or $published -notmatch '([0-9a-f]{64})') { throw "Cloudflare's release did not list cloudflared with a checksum." }
    $expected = $Matches[1]
    Write-Output "Downloading cloudflared $($release.tag_name) ($([math]::Round($asset.size / 1MB)) MB)..."
    $partial = "$cloudflared.download"
    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $partial
    $actual = (Get-FileHash $partial -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
        Remove-Item $partial -Force
        throw "The download does not match Cloudflare's checksum, so it was not used."
    }
    Move-Item $partial $cloudflared -Force
    Write-Output "cloudflared matches Cloudflare's published checksum."
}

Copy-Item (Join-Path $root "assets\kiasa.ico") $icon -Force

$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "KIASA Model Server.lnk"))
$link.TargetPath = $app
$link.Arguments = "-listen 127.0.0.1:8790 -tunnel `"$cloudflared`""
$link.WorkingDirectory = $home_
$link.IconLocation = $icon
$link.Description = "Runs KIASA's model for the team's browsers. Keep its window open."
$link.Save()

Write-Output "Ready: open KIASA Model Server on the desktop, and keep its window open."
