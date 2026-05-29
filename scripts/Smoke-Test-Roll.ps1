# Smoke test: launch Tack, move the window to a deliberately odd-pixel
# position, trigger a roll, then check the debug log to confirm the
# pre-roll position matches the post-roll position (no shift).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $env:APPDATA 'tack\debug.log'
$electron = Join-Path $root 'node_modules\.bin\electron.cmd'

Add-Type -Namespace Native -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr hWndAfter, int x, int y, int w, int h, uint flags);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT r);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

# Kill any leftover Tack and clear log
Get-Process -Name 'Tack','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
if (Test-Path $logPath) { Remove-Item $logPath -Force }

Write-Host 'Launching Tack...'
$proc = Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $root -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

# Tack starts hidden. Summon it with the global hotkey Ctrl+Alt+T.
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^%t')
Start-Sleep -Seconds 1

# Find Tack window
$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  $hit = @(Get-Process | Where-Object {
    $_.ProcessName -eq 'electron' -and $_.MainWindowTitle -eq 'Tack' -and $_.MainWindowHandle -ne 0
  })
  if ($hit.Count -gt 0) { $hwnd = $hit[0].MainWindowHandle; break }
  Start-Sleep -Milliseconds 200
}
if ($hwnd -eq [IntPtr]::Zero) {
  $proc | Stop-Process -Force -ErrorAction SilentlyContinue
  throw 'Tack window did not appear'
}

# Move to deliberately odd-pixel logical position. We pass physical
# pixels to SetWindowPos; pick numbers that map to odd logical pixels
# at the user's likely DPI scales (1.0x odd, 1.25x odd, 1.5x odd).
# 237 odd directly; at 1.25x = 296.25 physical -> still maps to odd
# logical when read back.
$targetX = 237
$targetY = 153
$SWP_NOSIZE = 0x0001
$SWP_NOZORDER = 0x0004
$flags = $SWP_NOSIZE -bor $SWP_NOZORDER
[void][Native.Win32]::SetWindowPos($hwnd, [IntPtr]::Zero, $targetX, $targetY, 0, 0, $flags)
Start-Sleep -Milliseconds 400

# Confirm position after the move
$r = New-Object Native.Win32+RECT
[void][Native.Win32]::GetWindowRect($hwnd, [ref] $r)
Write-Host ("After move:  ({0},{1})  size=({2}x{3})" -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))

# Bring Tack to foreground and send Ctrl+R to trigger roll
[void][Native.Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 200
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^r')
Start-Sleep -Milliseconds 500

[void][Native.Win32]::GetWindowRect($hwnd, [ref] $r)
Write-Host ("After roll1: ({0},{1})  size=({2}x{3})" -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))

# Roll again (back to full)
[void][Native.Win32]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('^r')
Start-Sleep -Milliseconds 500

[void][Native.Win32]::GetWindowRect($hwnd, [ref] $r)
Write-Host ("After roll2: ({0},{1})  size=({2}x{3})" -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))

# Read the debug log for moved + applyHeight lines
Write-Host '--- debug.log ---'
if (Test-Path $logPath) {
  Get-Content $logPath
} else {
  Write-Warning 'No debug log found'
}

# Clean up
$proc | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name 'Tack','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
