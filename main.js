const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = __dirname;
const ICON_FILE = path.join(ROOT, 'icon.png');
// DATA_FILE is set lazily — app.getPath('userData') is only available after app is ready
let DATA_FILE = null;
function getDataFile() {
  if (DATA_FILE) return DATA_FILE;
  DATA_FILE = path.join(app.getPath('userData'), 'tasks.json');
  // First-run migration: if no userData file but a legacy one sits next to main.js, move it
  const legacy = path.join(ROOT, 'tasks.json');
  if (!fs.existsSync(DATA_FILE) && fs.existsSync(legacy)) {
    try { fs.copyFileSync(legacy, DATA_FILE); } catch {}
  }
  return DATA_FILE;
}

const HOTKEY  = 'CommandOrControl+Alt+T';
const WIN_W   = 414;     // 10% narrower
const H_FULL  = 600;
const H_ROLL  = 120;

let win = null;
let tray = null;
let pinned = true;    // default: stay visible
let rolled = false;
let theme = 'light';  // renderer will sync the persisted value on load
let saveTimer = null;
let anchorPos = null;          // canonical position; survives resize drift
let movingProgrammatically = false;

function loadFile() {
  try { return JSON.parse(fs.readFileSync(getDataFile(), 'utf8')); }
  catch { return null; }
}

function dbg(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'debug.log');
    fs.appendFileSync(f, new Date().toISOString().slice(11, 23) + ' ' + msg + '\n');
  } catch {}
}

function saveFile(data) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const f = getDataFile();
    const tmp = f + '.tmp';
    fs.writeFile(tmp, JSON.stringify(data, null, 2), (err) => {
      if (!err) fs.rename(tmp, f, () => {});
    });
  }, 200);
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W,
    height: H_FULL,
    minWidth: 1,
    minHeight: 1,
    frame: false,
    transparent: true,
    resizable: false,           // user can't drag-resize; we toggle on briefly during applyHeight
    maximizable: false,         // disables Aero Snap maximize-on-drag-to-top
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    hasShadow: false,           // CSS provides the shadow; OS shadow can interfere with snap
    thickFrame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  win.loadFile('index.html');
  win.on('blur', () => {
    dbg('blur pinned=' + pinned + ' rolled=' + rolled + ' visible=' + win.isVisible());
    if (!pinned && win.isVisible()) hideWindow();   // ignore rolled state — pin alone controls
  });
  win.on('close', (e) => { e.preventDefault(); hideWindow(); });
  win.on('moved', () => {
    if (movingProgrammatically) return;
    const [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    // Use the display containing the window's center, so multi-monitor drags
    // smoothly transfer the clamp to the new monitor.
    const center = { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
    const wa = screen.getDisplayNearestPoint(center).workArea;
    const HEADER_H = 46;
    const VIS = 80;                                         // min visible horizontally
    const maxY = wa.y + wa.height - HEADER_H - 4;           // header bottom above taskbar
    const minY = wa.y;
    const minX = wa.x - w + VIS;
    const maxX = wa.x + wa.width - VIS;
    const newX = Math.min(Math.max(x, minX), maxX);
    const newY = Math.min(Math.max(y, minY), maxY);
    if (newX !== x || newY !== y) {
      movingProgrammatically = true;
      win.setPosition(snap(newX), snap(newY));
      anchorPos = [snap(newX), snap(newY)];
      setTimeout(() => { movingProgrammatically = false; }, 80);
    } else {
      anchorPos = [x, y];
    }
  });
}

function positionAtCursor() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const [w, h] = win.getSize();
  const nx = snap(x + (width - w) / 2);
  // Vertically center within the work area (above the taskbar)
  const ny = snap(y + Math.max(20, (height - h) / 2));
  movingProgrammatically = true;
  win.setPosition(nx, ny);
  anchorPos = [nx, ny];
  setTimeout(() => { movingProgrammatically = false; }, 80);
}

// Snap to even logical pixels so the physical position lands on an integer
// at 1.5× DPI, preventing setBounds from drifting by 1 each call.
const snap = (n) => Math.round(n / 2) * 2;

function applyHeight(h) {
  const b = win.getBounds();
  if (b.height === h) return;
  const lockedX = snap(b.x);
  const lockedY = snap(b.y);
  movingProgrammatically = true;
  win.setResizable(true);
  win.setBounds({ x: lockedX, y: lockedY, width: WIN_W, height: h });
  const fb = win.getBounds();
  dbg('applyHeight h=' + h + ' end x=' + fb.x + ' y=' + fb.y + ' w=' + fb.width + ' h=' + fb.height);
  setTimeout(() => {
    movingProgrammatically = false;
    win.setResizable(false);
  }, 60);
}

function showWindow(firstShow = false) {
  const h = rolled ? H_ROLL : H_FULL;
  if (firstShow || !win.isVisible()) positionAtCursor();
  applyHeight(h);
  win.show();
  win.focus();
  win.webContents.send('focus-input');
}

function hideWindow() { win.hide(); }

function toggleWindow() {
  if (win.isVisible() && win.isFocused()) hideWindow();
  else showWindow();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => toggleWindow());
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();

  Menu.setApplicationMenu(null);  // removes Ctrl+R reload, F11, etc.

  // First-launch: turn on Start-with-Windows by default
  const firstRun = !fs.existsSync(getDataFile());
  if (firstRun && process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  createWindow();

  const trayIcon = fs.existsSync(ICON_FILE)
    ? nativeImage.createFromPath(ICON_FILE)
    : nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('To-Do  ·  ' + HOTKEY);
  tray.on('click', toggleWindow);

  function rebuildMenu() {
    const loginItem = app.getLoginItemSettings();
    const menu = Menu.buildFromTemplate([
      { label: 'Open To-Do', accelerator: HOTKEY, click: showWindow },
      { type: 'separator' },
      { label: 'Pin (stay visible)', type: 'checkbox', checked: pinned, click: (item) => { pinned = item.checked; win.webContents.send('pinned-changed', pinned); }},
      { label: 'Dark mode', type: 'checkbox', checked: theme === 'dark', click: (item) => {
        theme = item.checked ? 'dark' : 'light';
        win.webContents.send('theme-set', theme);
      }},
      { label: 'Start with Windows', type: 'checkbox', checked: loginItem.openAtLogin, click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      }},
      { type: 'separator' },
      { label: 'Open data folder', click: () => shell.openPath(ROOT) },
      { label: 'Quit', click: () => app.exit(0) }
    ]);
    tray.setContextMenu(menu);
  }
  rebuildMenu();

  const ok = globalShortcut.register(HOTKEY, toggleWindow);
  if (!ok) console.error('Failed to register hotkey: ' + HOTKEY);

  ipcMain.handle('data:load', () => loadFile());
  ipcMain.on('data:save',  (_, data) => saveFile(data));
  ipcMain.on('theme:current', (_, t) => { theme = t; rebuildMenu(); });
  ipcMain.on('window:hide', () => hideWindow());
  ipcMain.on('window:pin',  (_, p) => {
    pinned = !!p;
    dbg('pin set pinned=' + pinned);
    rebuildMenu();
  });
  ipcMain.on('window:ignoreMouse', (_, ignore) => {
    win.setIgnoreMouseEvents(!!ignore, { forward: true });
  });
  ipcMain.on('window:roll', (_, isRolled, customH) => {
    rolled = !!isRolled;
    const target = rolled
      ? (typeof customH === 'number' && customH > 0 ? customH : H_ROLL)
      : H_FULL;
    applyHeight(target);
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
