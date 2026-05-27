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
const WIN_W   = 380;
const H_FULL  = 540;
const H_ROLL  = 96;

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
    resizable: true,            // programmatic resize requires true on Windows
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  win.loadFile('index.html');
  win.on('blur', () => {
    if (!pinned && !rolled && win.isVisible()) hideWindow();
  });
  win.on('close', (e) => { e.preventDefault(); hideWindow(); });
  win.on('moved', () => {
    if (movingProgrammatically) return;
    const [x, y] = win.getPosition();
    anchorPos = [x, y];     // user dragged: trust the new spot
  });
  // resizable:true is needed so setSize works on Windows, but block user-initiated resizes
  win.on('will-resize', (e) => {
    if (!movingProgrammatically) e.preventDefault();
  });
}

function positionAtCursor() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const [w] = win.getSize();
  const nx = Math.round(x + width / 2 - w / 2);
  const ny = Math.round(y + height * 0.18);
  movingProgrammatically = true;
  win.setPosition(nx, ny);
  anchorPos = [nx, ny];        // re-anchor on every fresh show
  setTimeout(() => { movingProgrammatically = false; }, 80);
}

let resizeFrame = null;
function applyHeight(h) {
  if (!anchorPos) {
    const [x, y] = win.getPosition();
    anchorPos = [x, y];
  }
  if (resizeFrame) clearTimeout(resizeFrame);
  const startH = win.getSize()[1];
  if (startH === h) return;
  const startTime = Date.now();
  const duration = 150;
  movingProgrammatically = true;
  const step = () => {
    const t = Math.min((Date.now() - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const curH = Math.max(1, Math.round(startH + (h - startH) * eased));
    // setBounds is atomic: width + height + position update in one call,
    // so Windows can't briefly flash a different width
    win.setBounds({
      x: anchorPos[0],
      y: anchorPos[1],
      width: WIN_W,
      height: curH,
    });
    if (t < 1) resizeFrame = setTimeout(step, 16);
    else {
      resizeFrame = null;
      setTimeout(() => { movingProgrammatically = false; }, 40);
    }
  };
  step();
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
    rebuildMenu();
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
