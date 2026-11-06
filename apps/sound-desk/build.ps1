$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$dist = Join-Path $here 'dist'
dotnet publish (Join-Path $here 'KiasaSoundDesk.csproj') -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
  -p:DebugType=none -o $dist -v q --nologo
if ($LASTEXITCODE -ne 0) { throw 'The build failed.' }
$runtimes = Join-Path $dist 'runtimes'
if (Test-Path $runtimes) { Remove-Item -Recurse -Force $runtimes }
Move-Item -Force (Join-Path $dist 'KiasaSoundDesk.exe') (Join-Path $dist 'KIASA Sound Desk.exe')
$file = Get-Item (Join-Path $dist 'KIASA Sound Desk.exe')
'{0}  {1:N1} MB' -f $file.FullName, ($file.Length / 1MB)
# Signed when this computer is set up for it (see sign.ps1); otherwise it says it is unsigned.
& (Join-Path $here 'sign.ps1') -File $file.FullName
