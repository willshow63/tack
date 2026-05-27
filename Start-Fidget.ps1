# Start-Fidget.ps1
# Launches the Fidget widget in dev mode (no installer needed).
# Once running, press Ctrl+Alt+T anywhere to summon the widget.

$ErrorActionPreference = 'Stop'
$root = 'C:\Projects\fidget'

if (-not (Test-Path -LiteralPath $root)) {
    Write-Error "Project directory not found: $root"
    return
}

Set-Location -LiteralPath $root

# --- Tray icon (created once, 256x256 so the installer can also use it) ---
$iconPath = Join-Path $root 'icon.png'
if (-not (Test-Path -LiteralPath $iconPath)) {
    Write-Host "Creating app icon..."
    Add-Type -AssemblyName System.Drawing
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $coral = [System.Drawing.Color]::FromArgb(233, 75, 60)
    $brush = New-Object System.Drawing.SolidBrush $coral
    $pad = 16
    $g.FillEllipse($brush, $pad, $pad, $size - 2*$pad, $size - 2*$pad)
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 24
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $pts = @(
        (New-Object System.Drawing.Point  72, 136),
        (New-Object System.Drawing.Point 112, 176),
        (New-Object System.Drawing.Point 184,  88)
    )
    $g.DrawLines($pen, $pts)
    $bmp.Save($iconPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $pen.Dispose()
}

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
    Write-Host "Fidget is already running (PID $(($existing | Select-Object -First 1).ProcessId)). Press Ctrl+Alt+T to summon."
    return
}

# --- Launch ---
$electronExe = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $electronExe)) {
    Write-Error "electron.exe not found at $electronExe. Try deleting node_modules and re-running."
    return
}

$proc = Start-Process -FilePath $electronExe -ArgumentList $root -WorkingDirectory $root -PassThru
Write-Host "Started Fidget (PID $($proc.Id)). Press Ctrl+Alt+T to summon."
