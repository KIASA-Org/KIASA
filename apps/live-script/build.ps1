# Builds dist\KIASA-Live-Script.zip: the app members download from the Interview page.
# Run it on Windows with Python 3.12 in a clean virtual environment:
#   python -m venv <somewhere>; <somewhere>\Scripts\pip install -r requirements.txt pyinstaller
#   .\build.ps1 -Python <somewhere>\Scripts\python.exe
param([string]$Python = "python")
Set-Location $PSScriptRoot

& $Python -m PyInstaller --noconfirm --noconsole --onedir --name "KIASA Live Script" `
  --collect-all sherpa_onnx `
  --add-data "models;models" --add-data "live_demo.html;." `
  --exclude-module tkinter `
  live_server.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

Compress-Archive -Force -ErrorAction Stop -Path "dist\KIASA Live Script" -DestinationPath "dist\KIASA-Live-Script.zip"
Get-Item "dist\KIASA-Live-Script.zip" | Select-Object Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB) } }
