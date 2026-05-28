# Record-Demo.ps1
# Records the Tack first-launch demo to an MP4 suitable for sharing.
#
# Approach:
#   - Minimize all other windows so the desktop is just wallpaper.
#   - Body stays transparent in record mode, so the window's shadow halo
#     shows real wallpaper through it.
#   - Capture a region wider than the window so there's wallpaper padding
#     around it -- naturally, no fake dark box.
#   - After ffmpeg finishes, restore the user's windows.
#
# Output: C:\Projects\tack\dist\Tack-demo.mp4

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $root 'dist'
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

$outMp4 = Join-Path $distDir 'Tack-demo.mp4'
if (Test-Path $outMp4) { Remove-Item $outMp4 -Force }

# 12 steps; ~38 s end-to-end, ffmpeg starts ~4 s in. 40 s leaves room
# for the final "Summon Tack anytime" caption plus its hold tail.
$durationSec = 40

# Padding (in physical px) of wallpaper area around the window in the
# captured frame.
$padX = 110; $padY = 80

# --- Win32 helper: read the window's actual visible bounds, query physical
# screen dimensions (gdigrab uses physical px), and per-window minimize. ---
Add-Type -Namespace Native -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT lpRect);
[System.Runtime.InteropServices.DllImport("dwmapi.dll")]
public static extern int DwmGetWindowAttribute(System.IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsIconic(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetDpiForSystem();
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

# Kill any leftover Tack/electron
Get-Process -Name 'Tack','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$electron = Join-Path $root 'node_modules\.bin\electron.cmd'
if (-not (Test-Path $electron)) { throw "electron not found at $electron. Run 'npm install' first." }

# Minimize visible top-level windows ONE AT A TIME (not via MinimizeAll's
# Show-Desktop) so the taskbar stays visible during the recording.
Write-Host 'Minimizing visible windows so the desktop is clean...'
$minimizedHwnds = @()
$visible = Get-Process | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and
  -not [string]::IsNullOrEmpty($_.MainWindowTitle) -and
  [Native.Win32]::IsWindowVisible($_.MainWindowHandle) -and
  -not [Native.Win32]::IsIconic($_.MainWindowHandle)
}
foreach ($p in $visible) {
  $minimizedHwnds += $p.MainWindowHandle
  [void][Native.Win32]::ShowWindow($p.MainWindowHandle, 6)  # SW_MINIMIZE
}
Start-Sleep -Milliseconds 600

$electronProc = $null
$ffProc = $null
try {
  Write-Host 'Launching Tack in --demo-record mode...'
  $electronProc = Start-Process -FilePath $electron -ArgumentList '.','--demo-record' -WorkingDirectory $root -PassThru -WindowStyle Hidden

  # Hold until the window has grown to its demo-state height.
  Start-Sleep -Seconds 4

  $rect = New-Object Native.Win32+RECT
  $hit = @(Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -eq 'electron' -and $_.MainWindowTitle -eq 'Tack' -and $_.MainWindowHandle -ne 0 })
  if ($hit.Count -eq 0) { throw 'Tack window did not appear.' }
  $hwnd = $hit[0].MainWindowHandle
  $dwmHr = [Native.Win32]::DwmGetWindowAttribute($hwnd, 9, [ref] $rect, [System.Runtime.InteropServices.Marshal]::SizeOf([type][Native.Win32+RECT]))
  if ($dwmHr -ne 0) { [void][Native.Win32]::GetWindowRect($hwnd, [ref] $rect) }

  # Capture the FULL primary screen in logical coords. Tack is at a fixed
  # position within it; the surrounding desktop is just wallpaper because
  # other windows were minimized.
  Add-Type -AssemblyName System.Windows.Forms
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $x = 0; $y = 0
  $w = $screen.Width
  $h = $screen.Height
  if ($w % 2 -ne 0) { $w -= 1 }
  if ($h % 2 -ne 0) { $h -= 1 }
  Write-Host ("Capture region: ({0},{1}) {2}x{3}" -f $x,$y,$w,$h)

  Write-Host "Recording for $durationSec s..."
  $ffArgs = @(
    '-y',
    '-f','gdigrab',
    '-framerate','30',
    '-offset_x',$x,'-offset_y',$y,
    '-video_size',("{0}x{1}" -f $w,$h),
    '-i','desktop',
    '-t',$durationSec,
    '-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p',
    '-movflags','+faststart',
    $outMp4
  )
  $ffProc = Start-Process -FilePath 'ffmpeg' -ArgumentList $ffArgs -PassThru -WindowStyle Hidden
  Wait-Process -Id $ffProc.Id

  Start-Sleep -Milliseconds 800
  if (-not $electronProc.HasExited) {
    Stop-Process -Id $electronProc.Id -Force -ErrorAction SilentlyContinue
  }
} finally {
  # Always restore the user's windows
  Get-Process -Name 'Tack','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  foreach ($h in $minimizedHwnds) {
    try { [void][Native.Win32]::ShowWindow($h, 9) } catch {}  # SW_RESTORE
  }
}

if (-not (Test-Path $outMp4)) { throw 'MP4 was not produced.' }

$info = Get-Item $outMp4
$sizeMB = [Math]::Round($info.Length / 1MB, 1)
Write-Host "Done: $outMp4 -- $sizeMB MB"
