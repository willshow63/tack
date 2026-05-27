# Start-Tack.ps1
# Launches the Tack widget in dev mode (no installer needed).
# Once running, press Ctrl+Alt+T anywhere to summon the widget.

$ErrorActionPreference = 'Stop'
$root = 'C:\Projects\tack'

if (-not (Test-Path -LiteralPath $root)) {
    Write-Error "Project directory not found: $root"
    return
}

Set-Location -LiteralPath $root

# icon.png + icon.ico ship with the repo

# --- Dependencies (installed once) ---
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host "Installing dependencies (first run only, ~1-2 min)..."
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed'; return }
}

# --- Already running? ---
$existing = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*$root*" }
if ($existing) {
    Write-Host "Tack is already running (PID $(($existing | Select-Object -First 1).ProcessId)). Press Ctrl+Alt+T to summon."
    return
}

# --- Launch ---
$electronExe = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronExe)) {
    Write-Error "electron.exe not found at $electronExe. Try deleting node_modules and re-running."
    return
}

$proc = Start-Process -FilePath $electronExe -ArgumentList $root -WorkingDirectory $root -PassThru
Write-Host "Started Tack (PID $($proc.Id)). Press Ctrl+Alt+T to summon."
