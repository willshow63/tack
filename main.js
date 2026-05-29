const { app, BrowserWindow, globalShortcut, ipcMain, Tray, Menu, nativeImage, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = __dirname;
// macOS menu bar wants a "Template" image (black-on-transparent that the
// system tints to match the menu bar's light/dark theme). Windows uses
// the full-color icon for its tray.
const ICON_FILE = path.join(
  ROOT,
  process.platform === 'darwin' ? 'iconTemplate.png' : 'icon.png'
);

// Demo-record mode: --demo-record [outDir]
// - Uses an isolated userData dir so the user's real tasks/prefs are untouched
// - Locks the window to a fixed top-left position so ffmpeg can grab a known region
// - Asks the renderer to auto-advance the demo and quit when done
const RECORD_MODE = process.argv.includes('--demo-record');
if (RECORD_MODE) {
  const recordUserData = path.join(os.tmpdir(), 'tack-demo-record');
  fs.mkdirSync(recordUserData, { recursive: true });
  for (const f of ['tasks.json', 'prefs.json']) {
    try { fs.unlinkSync(path.join(recordUserData, f)); } catch {}
  }
  app.setPath('userData', recordUserData);
}
// Y must be >= 60 (so demo extraTop of 60 doesn't push the top off-screen).
// At 60 the window sits at screen top during the demo and leaves clear
// space above the taskbar at the bottom, so the whole app fits.
const RECORD_POS = { x: 200, y: 60 };
// DATA_FILE is set lazily — app.getPath('userData') is only available after app is ready
let DATA_FILE = null;
function getDataFile() {
  if (DATA_FILE) return DATA_FILE;
  DATA_FILE = path.join(app.getPath('userData'), 'tasks.json');
  // First-run migration: if no userData file but a legacy one sits next to
  // main.js, move it. Skip this entirely in record mode -- we want a
  // guaranteed-clean state, not whatever was in someone's dev directory.
  if (!RECORD_MODE) {
    const legacy = path.join(ROOT, 'tasks.json');
    if (!fs.existsSync(DATA_FILE) && fs.existsSync(legacy)) {
      try { fs.copyFileSync(legacy, DATA_FILE); } catch {}
    }
  }
  return DATA_FILE;
}

const HOTKEY  = 'CommandOrControl+Alt+T';
// In record mode we widen the window so the demo skip (X) button -- which
// is positioned at calc(50% + 184) of a 414-wide window and otherwise gets
// clipped at the right edge -- has room. CSS compensates via --side-pad so
// the card keeps its normal visual width.
const WIN_W   = RECORD_MODE ? 462 : 414;
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
// Extra pixels added to the top of the OS window while the demo caption
// is visible -- keeps the caption ABOVE the card without changing the
// card's position. Zero outside the demo.
let demoExtraTop = 0;

function loadFile() {
  try { return JSON.parse(fs.readFileSync(getDataFile(), 'utf8')); }
  catch { return null; }
}

function getPrefsFile() { return path.join(app.getPath('userData'), 'prefs.json'); }
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(getPrefsFile(), 'utf8')); }
  catch { return {}; }
}
function savePrefs(p) {
  try { fs.writeFileSync(getPrefsFile(), JSON.stringify(p, null, 2)); } catch {}
}

// Reconcile the OS "Run at login" registration with our stored
// preference on every launch. Default is on. Self-heals if the
// registration is cleared, or if the app moves to a new path.
// On macOS we pass openAsHidden so the dock window doesn't pop on login;
// Tack lives in the menu bar.
function applyAutoStart() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const prefs = loadPrefs();
  const want = prefs.autoStart !== false;
  const cur = app.getLoginItemSettings();
  if (cur.openAtLogin !== want) {
    const opts = { openAtLogin: want };
    if (process.platform === 'darwin') opts.openAsHidden = true;
    app.setLoginItemSettings(opts);
  }
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
  win.loadFile('index.html', RECORD_MODE ? { hash: 'auto' } : undefined);
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
      win.setPosition(newX, newY);
      anchorPos = [newX, newY];
      setTimeout(() => { movingProgrammatically = false; }, 80);
    } else {
      anchorPos = [x, y];
    }
    dbg('moved in x=' + x + ' y=' + y + ' newX=' + newX + ' newY=' + newY + ' anchorPos=' + anchorPos.join(','));
  });
}

function positionAtCursor() {
  if (RECORD_MODE) {
    movingProgrammatically = true;
    win.setPosition(RECORD_POS.x, RECORD_POS.y);
    anchorPos = [RECORD_POS.x, RECORD_POS.y];
    setTimeout(() => { movingProgrammatically = false; }, 80);
    return;
  }
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

function applyHeight(h, force = false) {
  // Total visible height = content height + demo caption gutter (if any)
  const target = h + demoExtraTop;
  const b = win.getBounds();
  if (!force && b.height === target) return;
  // Pass b.x / b.y through directly. snap() to even logical pixels used
  // to be applied here as a guard against per-roll 1-px drift at
  // fractional DPI, but it caused a worse bug: after the user drags the
  // window to an odd logical pixel (common at 1.25x DPI), the next roll
  // shifted the window by a pixel. setBounds(x) -> getBounds().x is
  // stable on its own in current Electron, so just preserve the position.
  movingProgrammatically = true;
  win.setResizable(true);
  win.setBounds({ x: b.x, y: b.y, width: WIN_W, height: target });
  const fb = win.getBounds();
  dbg('applyHeight h=' + h + ' extra=' + demoExtraTop + ' force=' + force +
      ' in x=' + b.x + ' y=' + b.y +
      ' out x=' + fb.x + ' y=' + fb.y + ' w=' + fb.width + ' h=' + fb.height);
  setTimeout(() => {
    movingProgrammatically = false;
    win.setResizable(false);
  }, 60);
}

// Resize the OS window UPWARD by `top` extra pixels so the demo caption
// has room ABOVE the card, without moving the card. Called from the
// renderer at demo start (top=60) and demo end (top=0).
function setDemoExtraTop(top) {
  top = Math.max(0, Math.round(Number(top) || 0));
  if (top === demoExtraTop) return;
  const delta = top - demoExtraTop;
  const b = win.getBounds();
  const newY = b.y - delta;
  const newH = b.height + delta;
  demoExtraTop = top;
  movingProgrammatically = true;
  win.setResizable(true);
  // Pin width to WIN_W explicitly -- using b.width can drift by 1-2 px
  // due to OS rounding between getBounds and setBounds. Pass x/y
  // unshifted so the card stays exactly where it was.
  win.setBounds({ x: b.x, y: newY, width: WIN_W, height: newH });
  setTimeout(() => {
    movingProgrammatically = false;
    win.setResizable(false);
  }, 60);
}

function showWindow(firstShow = false) {
  const h = rolled ? H_ROLL : H_FULL;
  if (firstShow || !win.isVisible()) positionAtCursor();
  // Force on first show -- electron's reported bounds for a frameless
  // transparent window right after construction don't always match the
  // visible on-screen height, so the short-circuit was leaving the
  // window stuck at a wrong size until the first roll cycle.
  applyHeight(h, firstShow);
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

  applyAutoStart();

  createWindow();

  const trayIcon = fs.existsSync(ICON_FILE)
    ? nativeImage.createFromPath(ICON_FILE)
    : nativeImage.createEmpty();
  if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  // Friendlier tooltip: show platform-native modifier keys
  const tooltipHotkey = process.platform === 'darwin'
    ? 'Cmd+Option+T'
    : 'Ctrl+Alt+T';
  tray.setToolTip('Tack  ·  ' + tooltipHotkey);
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
      { label: process.platform === 'darwin' ? 'Start at login' : 'Start with Windows',
        type: 'checkbox', checked: loginItem.openAtLogin, click: (item) => {
        const p = loadPrefs();
        p.autoStart = item.checked;
        savePrefs(p);
        const opts = { openAtLogin: item.checked };
        if (process.platform === 'darwin') opts.openAsHidden = true;
        app.setLoginItemSettings(opts);
      }},
      { type: 'separator' },
      { label: 'Open data folder', click: () => shell.openPath(ROOT) },
      { label: process.platform === 'darwin'
          ? 'Quit Tack  (reopen from Applications)'
          : 'Quit Tack  (reopen from Start Menu)',
        click: () => app.exit(0) }
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
  ipcMain.on('demo:done', () => {
    if (RECORD_MODE) setTimeout(() => app.exit(0), 800);
  });
  ipcMain.on('demo:extraTop', (_, top) => setDemoExtraTop(top));
  ipcMain.on('dbg:log', (_, msg) => dbg('renderer: ' + msg));
  if (RECORD_MODE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => showWindow(true), 600);
    });
  }
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
