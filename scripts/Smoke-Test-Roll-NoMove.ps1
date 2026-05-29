# Smoke test variant: launch Tack, summon it, then roll 4 times WITHOUT
# moving it. Position should not drift across the cycles.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $env:APPDATA 'tack\debug.log'
$electron = Join-Path $root 'node_modules\.bin\electron.cmd'

Add-Type -Namespace Native -Name Win32 -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT r);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

Get-Process -Name 'Tack','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
if (Test-Path $logPath) { Remove-Item $logPath -Force }

$proc = Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $root -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^%t')
Start-Sleep -Seconds 1

$hwnd = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  $hit = @(Get-Process | Where-Object {
    $_.ProcessName -eq 'electron' -and $_.MainWindowTitle -eq 'Tack' -and $_.MainWindowHandle -ne 0
  })
  if ($hit.Count -gt 0) { $hwnd = $hit[0].MainWindowHandle; break }
  Start-Sleep -Milliseconds 200
}
if ($hwnd -eq [IntPtr]::Zero) { throw 'Tack window did not appear' }

$r = New-Object Native.Win32+RECT
[void][Native.Win32]::GetWindowRect($hwnd, [ref] $r)
Write-Host ("Start:   ({0},{1})" -f $r.Left, $r.Top)

for ($i = 1; $i -le 4; $i++) {
  [void][Native.Win32]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 150
  [System.Windows.Forms.SendKeys]::SendWait('^r')
  Start-Sleep -Milliseconds 400
  [void][Native.Win32]::GetWindowRect($hwnd, [ref] $r)
  Write-Host ("Roll {0}: ({1},{2})" -f $i, $r.Left, $r.Top)
}

Write-Host '--- debug.log ---'
if (Test-Path $logPath) { Get-Content $logPath }

$proc | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name 'Tack','electron' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
