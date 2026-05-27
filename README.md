# Tack

A minimalist desktop to-do widget for Windows. Frameless, hotkey-summoned, multi-list, dark/light themes.

## Install

Download the latest `Tack Setup x.x.x.exe` from the [releases](https://github.com/willshow63/tack/releases) (or build your own — see below). Double-click to install. The installer adds a desktop and start-menu shortcut, and launches Tack at the end. On first launch the app enables "start with Windows" automatically.

## Use

Press **Ctrl+Alt+T** anywhere on Windows to summon the widget. Press it again (or Esc) to dismiss.

| | |
|---|---|
| **type + Enter** | add a task to the current list |
| **click circle** | mark complete |
| **click text** | edit inline (Enter saves, Esc cancels, empty save deletes) |
| **click flag** | toggle important (red bar on left) |
| **click ×** | delete |
| **header** | drag to move the window |
| **^ button** | roll up to just the date strip + input |
| **📌 button** | toggle "stay visible" (pinned by default) |
| **☰ button** | switch lists, create / rename / delete lists, settings |

## Settings (☰ → bottom of menu)

- **Dark mode** — toggle Apple Pure light vs Graphite dark
- **Show completed** — when off, the Done section disappears entirely

## Lists

The hamburger opens a list switcher. **All Lists** at the top shows every task from every list, grouped by list name. Create as many lists as you want; each keeps its own collapsed-group state.

## Where data lives

`%APPDATA%\tack\tasks.json`. Auto-saved on every change (debounced 200ms, atomic write).

## Build from source

```powershell
git clone https://github.com/willshow63/tack.git
cd tack
npm install
.\Start-Tack.ps1            # dev mode — runs from source
# or
npm run build                # builds dist\Tack Setup x.x.x.exe
```

## Stack

Electron 33, vanilla HTML / CSS / JS, Inter font. NSIS installer via electron-builder.
