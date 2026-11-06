# Signs a Windows program for release and checks the signature (KIASA-010).
#
#   .\sign.ps1 -File "dist\KIASA Sound Desk.exe"
#
# Nothing secret is kept in this repository. The settings come from environment
# variables on the computer that builds (set them once in Windows: Settings → System →
# About → Advanced system settings → Environment Variables, or in the build session).
#
#   KIASA_SIGN_MODE = artifact | certificate      (not set: the build is left unsigned and says so)
#
#   Microsoft Artifact Signing (Azure; formerly "Trusted Signing"):
#     KIASA_SIGN_ENDPOINT   the account's endpoint, e.g. https://eus.codesigning.azure.net
#     KIASA_SIGN_ACCOUNT    the Artifact Signing account name
#     KIASA_SIGN_PROFILE    the certificate profile name
#     KIASA_SIGN_DLIB       full path to Azure.CodeSigning.Dlib.dll (from Microsoft's signing client tools)
#     Sign-in: `az login` on this computer, or AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
#     for an app registration that has the "Artifact Signing Certificate Profile Signer" role.
#
#   A bought certificate (USB token, or the seller's cloud key such as DigiCert KeyLocker or
#   SSL.com eSigner, which put the certificate in Windows' certificate store):
#     KIASA_SIGN_THUMBPRINT the certificate's SHA-1 thumbprint (certmgr.msc → Personal → the certificate → Details)
#     KIASA_SIGN_TIMESTAMP  the seller's timestamp server (default: http://timestamp.digicert.com)
#
#   Both:
#     KIASA_SIGN_PUBLISHER  text the signer's name must contain, e.g. "KIASA" (checked after signing)
#     KIASA_SIGN_REQUIRED=1 fail instead of leaving the program unsigned (use for releases)
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'

function Find-SignTool {
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  $found = Get-ChildItem $kits -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -like '*\x64' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $found) { throw 'signtool.exe was not found. Install the Windows SDK (its "Signing Tools for Desktop Apps" part).' }
  return $found.FullName
}

if (-not (Test-Path $File)) { throw "Nothing to sign: $File" }
$mode = $env:KIASA_SIGN_MODE
if (-not $mode) {
  if ($env:KIASA_SIGN_REQUIRED -eq '1') { throw 'KIASA_SIGN_REQUIRED=1 but no signing is set up (KIASA_SIGN_MODE).' }
  Write-Warning "UNSIGNED development build: $File. Windows will warn whoever runs it. Set KIASA_SIGN_MODE to sign (see sign.ps1)."
  return
}

$signtool = Find-SignTool
switch ($mode) {
  'artifact' {
    foreach ($name in 'KIASA_SIGN_ENDPOINT', 'KIASA_SIGN_ACCOUNT', 'KIASA_SIGN_PROFILE', 'KIASA_SIGN_DLIB') {
      if (-not [Environment]::GetEnvironmentVariable($name)) { throw "$name is not set (see sign.ps1)." }
    }
    if (-not (Test-Path $env:KIASA_SIGN_DLIB)) { throw "KIASA_SIGN_DLIB does not exist: $env:KIASA_SIGN_DLIB" }
    # The signing library reads the account from a small file; it holds no secret.
    $metadata = Join-Path ([IO.Path]::GetTempPath()) "kiasa-sign-$PID.json"
    @{ Endpoint = $env:KIASA_SIGN_ENDPOINT; CodeSigningAccountName = $env:KIASA_SIGN_ACCOUNT; CertificateProfileName = $env:KIASA_SIGN_PROFILE } |
      ConvertTo-Json | Set-Content -Encoding utf8 $metadata
    try {
      & $signtool sign /v /fd SHA256 /tr 'http://timestamp.acs.microsoft.com' /td SHA256 /dlib $env:KIASA_SIGN_DLIB /dmdf $metadata $File
      if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)." }
    } finally { Remove-Item $metadata -ErrorAction SilentlyContinue }
  }
  'certificate' {
    if (-not $env:KIASA_SIGN_THUMBPRINT) { throw 'KIASA_SIGN_THUMBPRINT is not set (see sign.ps1).' }
    $stamp = if ($env:KIASA_SIGN_TIMESTAMP) { $env:KIASA_SIGN_TIMESTAMP } else { 'http://timestamp.digicert.com' }
    $thumb = ($env:KIASA_SIGN_THUMBPRINT -replace '[^0-9A-Fa-f]', '')
    & $signtool sign /v /fd SHA256 /tr $stamp /td SHA256 /sha1 $thumb $File
    if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE). Is the token plugged in, or the cloud key's tool signed in?" }
  }
  default { throw "Unknown KIASA_SIGN_MODE '$mode' (artifact or certificate)." }
}

# Checked, not assumed: a valid signature, timestamped, by the expected publisher.
$signature = Get-AuthenticodeSignature $File
if ($signature.Status -ne 'Valid') { throw "The signature is not valid: $($signature.Status) $($signature.StatusMessage)" }
if (-not $signature.TimeStamperCertificate) { throw 'The signature has no timestamp: it would stop being trusted when the certificate expires.' }
$signer = $signature.SignerCertificate.Subject
if ($env:KIASA_SIGN_PUBLISHER -and $signer -notlike "*$($env:KIASA_SIGN_PUBLISHER)*") { throw "Signed by '$signer', not by '$env:KIASA_SIGN_PUBLISHER'." }
Write-Host "SIGNED: $File"
Write-Host "  by $signer, timestamped $($signature.TimeStamperCertificate.Subject)"
