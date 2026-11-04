param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

if ($Version -notmatch '^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$') {
    throw "Version must be a semantic version, such as 1.0.0."
}

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$temp = Join-Path ([System.IO.Path]::GetTempPath()) ("kiasa-setup-" + [guid]::NewGuid().ToString("N"))
$app = Join-Path $dist "KIASA.exe"
$setup = Join-Path $dist "KIASA-Setup.exe"
$payload = Join-Path $temp "payload.zip"
$icon = Join-Path $root "assets\kiasa.ico"
$ldflags = "-s -w -X stealth-app/internal/brand.Version=$Version"

New-Item -ItemType Directory -Force -Path $dist, $temp | Out-Null

try {
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"

    Push-Location $root
    try {
        # No console window: the app is opened from a button on KIASA, and it says what
        # it needs to in message boxes, on the Auto apply page and in its log file.
        & go build -trimpath -ldflags "$ldflags -H windowsgui" -o $app .
        if ($LASTEXITCODE -ne 0) {
            throw "Building KIASA.exe failed with exit code $LASTEXITCODE."
        }

        Compress-Archive -Path $app, $icon -DestinationPath $payload -CompressionLevel Optimal

        # Go leaves an up-to-date program as it is, which would keep the payload
        # added to it last time and add another. Start from nothing.
        Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
        & go build -trimpath -ldflags $ldflags -o $setup .\cmd\setup
        if ($LASTEXITCODE -ne 0) {
            throw "Building KIASA-Setup.exe failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
        Remove-Item Env:\GOOS, Env:\GOARCH -ErrorAction SilentlyContinue
    }

    $setupStream = [System.IO.File]::Open($setup, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $payloadStream = [System.IO.File]::OpenRead($payload)
        try {
            $payloadStream.CopyTo($setupStream)
            $setupStream.Write([System.Text.Encoding]::ASCII.GetBytes("KIASA001"), 0, 8)
            $length = [System.BitConverter]::GetBytes([uint64]$payloadStream.Length)
            if ([System.BitConverter]::IsLittleEndian -eq $false) {
                [array]::Reverse($length)
            }
            $setupStream.Write($length, 0, $length.Length)
        }
        finally {
            $payloadStream.Dispose()
        }
    }
    finally {
        $setupStream.Dispose()
    }

    & $setup --verify
    if ($LASTEXITCODE -ne 0) {
        throw "The generated installer payload did not verify."
    }

    Write-Output "Built KIASA ${Version}:"
    Get-Item $app, $setup | Select-Object Name, Length, FullName
}
finally {
    Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
