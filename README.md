# Tack

A minimalist desktop to-do widget for Windows and macOS. Frameless, hotkey-summoned, multi-list, dark/light themes.

## Install

### Windows

1. Download `Tack.exe` from the [latest release](https://github.com/willshow63/tack/releases/latest).
2. Double-click the installer. It adds a Desktop and Start Menu shortcut, launches Tack at the end, and registers Tack to start with Windows.
3. Press **Ctrl+Alt+T** anywhere to summon the widget. Tack lives in your system tray (bottom-right of the taskbar).

If your tray icon is hidden behind the `^` chevron, drag it out to keep it visible.

### macOS

Tack is not signed with an Apple Developer ID (would cost $99/yr), so macOS will warn you the first time. The bypass is two clicks.

1. Find out which Mac you have: **Apple menu → About This Mac**. Look at the **Chip** or **Processor** line.
   - "Apple M1 / M2 / M3 / M4 …" → download `Tack-mac-arm64.zip`
   - "Intel …" → download `Tack-mac-x64.zip`
2. Download the right zip from the [latest release](https://github.com/willshow63/tack/releases/latest).
3. Double-click the zip to extract `Tack.app`.
4. Drag `Tack.app` into your **Applications** folder.
5. **First launch only:** right-click `Tack.app` → **Open** → click **Open** in the warning dialog. (Double-clicking the app instead of right-clicking will not work the first time.)
6. Tack appears in your menu bar (top-right of your screen, near the wifi / clock icons).
7. In Tack's menu-bar dropdown, the "Start at login" item is on by default — Tack will appear in your menu bar every time you boot.

Press **Cmd+Option+T** anywhere on macOS to summon the widget. Press it again (or Esc) to dismiss.

## Use

Press the global hotkey to summon (**Ctrl+Alt+T** on Windows, **Cmd+Option+T** on Mac). Press again or Esc to dismiss.

| | |
|---|---|
| **type + Enter** | add a task to the current list |
| **type "buy milk @groceries"** | route the task to a specific list (creates the list if missing) |
| **click circle** | mark complete |
| **click text** | edit inline (Enter saves, Esc cancels, empty save deletes) |
| **click flag** | toggle important (red bar on left) |
| **click ×** | delete |
| **header** | drag to move the window |
| **^ button** | roll up to just the date strip + input |
| **📌 button** | toggle "stay visible" (pinned by default) |
| **☰ button** | switch lists, create / rename / delete lists, settings |

## Settings (☰ → bottom of menu)

- **Theme** — Light / Dark
- **Show completed** — when off, the Done section disappears entirely
- **Show time** — show the current time next to the date in the header

## Lists

The hamburger opens a list switcher. **All Lists** at the top shows every task from every list, grouped by list name. Create as many lists as you want; each keeps its own collapsed-group state.

The `@list-name` shorthand at the end of a task routes it to that list, and creates the list if it doesn't exist yet. Useful from All Lists view.

## Where data lives

- **Windows:** `%APPDATA%\tack\tasks.json`
- **macOS:** `~/Library/Application Support/tack/tasks.json`

Auto-saved on every change (debounced 200 ms, atomic write).

## Build from source

```powershell
git clone https://github.com/willshow63/tack.git
cd tack
npm install

# Windows installer
npm run build         # writes dist\Tack Setup 1.1.0.exe

# Mac app bundles (build from Windows or Mac; first run downloads the
# Mac electron binary, ~150 MB)
npm run build:mac     # writes dist\Tack-darwin-{arm64,x64}\Tack.app
```

Building Mac bundles from Windows requires **Developer Mode** turned on (Settings → System → For developers → Developer Mode). Without it Windows can't create the symlinks inside the `.app` bundle.

The Mac build does not produce a `.zip`; pack the resulting `Tack.app` with a tool that preserves symlinks (7-Zip with `-snl`, or `tar -cf` from a Unix shell). The Windows `Compress-Archive` cmdlet does NOT preserve symlinks and will produce a `.app` that crashes on macOS.

## Stack

Electron 33, vanilla HTML / CSS / JS, Inter font.
- Windows installer: NSIS via electron-builder
- macOS app bundle: @electron/packager, hand-rolled `.icns` via png2icons, manual `LSUIElement` plist patch for menu-bar-only behavior
