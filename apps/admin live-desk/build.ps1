# Builds KIASA Live Desk as one file that needs nothing else installed: dist\KIASA Live Desk.exe
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$dist = Join-Path $here 'dist'
dotnet publish (Join-Path $here 'KiasaLiveDesk.csproj') -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
  -p:DebugType=none -o $dist -v q --nologo
if ($LASTEXITCODE -ne 0) { throw 'The build failed.' }
Move-Item -Force (Join-Path $dist 'KiasaLiveDesk.exe') (Join-Path $dist 'KIASA Live Desk.exe')
$file = Get-Item (Join-Path $dist 'KIASA Live Desk.exe')
'{0}  {1:N1} MB' -f $file.FullName, ($file.Length / 1MB)
