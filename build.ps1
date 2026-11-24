# Builds dist\mmWaveConfigLab.exe (Windows). Needs Python 3.10+.
#   powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path .venv)) { python -m venv .venv }
$py = ".\.venv\Scripts\python.exe"
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r desktop\requirements.txt

node tests\engine.test.js
if ($LASTEXITCODE -ne 0) { throw "engine tests failed" }

& $py desktop\make_icon.py
& $py -m PyInstaller --noconfirm --clean --onefile --windowed `
    --name mmWaveConfigLab `
    --icon desktop\icon.ico `
    --add-data "app;app" `
    desktop\launcher.py

Get-Item dist\mmWaveConfigLab.exe | Select-Object Name, Length, LastWriteTime
