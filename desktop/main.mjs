// Wickline desktop app (Electron).
// Runs the built-in server on this computer — so stocks, ETFs, forex and futures work without
// any key, using the user's own internet connection — and shows the app in its own window.

import { app, BrowserWindow, ipcMain, Menu, safeStorage, session, shell } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, cpSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, setOandaConfig, setCapitalConfig } from '../server.mjs';
import { setupProxy } from './proxy.mjs';
import { applyGpuSwitches, watchGpu, gpuState, setGpuBackend } from './gpu.mjs';
import { oandaStatus } from '../lib/oanda.mjs';
import { capitalStatus } from '../lib/capital.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(HERE, '..', 'build', 'icon.png');
const isMac = process.platform === 'darwin';
// A fixed port keeps the page's address the same between launches, so saved charts,
// drawings, scripts and settings (stored by the page) are still there next time.
const PREFERRED_PORT = 41573;
const BG = '#0F0F11';

// Automated check used by developers: starts hidden, records what loaded, saves a screenshot, quits.
const SMOKE = process.env.WICKLINE_SMOKE_TEST === '1';
if (SMOKE) {
  // A fresh profile every run, so the check sees exactly what a new user sees.
  const profile = path.join(os.tmpdir(), 'wickline-smoke-profile');
  rmSync(profile, { recursive: true, force: true });
  app.setPath('userData', profile);
}

// Datos de versiones anteriores (Wickline CFD): watchlist, dibujos, layouts, backtesting y
// ajustes se copian una vez a la carpeta de AlbertosCharts. Las credenciales de los brókers
// estaban cifradas con la llave del nombre anterior en el llavero, así que se vuelven a pedir.
function migrateUserData() {
  if (SMOKE) return;
  try {
    const dest = app.getPath('userData');
    if (existsSync(path.join(dest, '.migrated')) || existsSync(path.join(dest, 'Local Storage'))) return;
    for (const old of ['Wickline CFD', 'Wickline']) {
      const src = path.join(app.getPath('appData'), old);
      if (!existsSync(path.join(src, 'Local Storage'))) continue;
      mkdirSync(dest, { recursive: true });
      for (const item of ['Local Storage', 'IndexedDB', 'gpu.json', 'proxy.json', 'window-state.json', 'journal']) {
        const from = path.join(src, item);
        if (existsSync(from)) cpSync(from, path.join(dest, item), { recursive: true, errorOnExist: false });
      }
      writeFileSync(path.join(dest, '.migrated'), old);
      return;
    }
  } catch (e) { console.error('No se pudieron migrar los datos anteriores:', e); }
}
migrateUserData();

// GPU: Metal (Mac), Direct3D 11 (Windows) o Vulkan (Linux), antes de que arranque Chromium.
applyGpuSwitches();
watchGpu();

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.lucasalberto.albertoscharts'); // desktop notifications on Windows

let origin = null;
let mainWindow = null;

async function startLocalServer() {
  for (let p = PREFERRED_PORT; p < PREFERRED_PORT + 20; p++) {
    try {
      const { port } = await startServer({ port: p, host: '127.0.0.1' });
      return `http://127.0.0.1:${port}`;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  const { port } = await startServer({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${port}`;
}

// --- window size and position are remembered ------------------------------------
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try { return JSON.parse(readFileSync(statePath(), 'utf8')); } catch { return {}; }
}
function saveState(win) {
  if (win.isDestroyed()) return;
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(statePath(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch { /* not important */ }
}

// The preload gives the page one thing from the app itself: the network proxy setting.
const webPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(HERE, 'preload.cjs') };

function createMainWindow() {
  const s = loadState();
  const win = new BrowserWindow({
    width: s.width || 1440, height: s.height || 900, x: s.x, y: s.y,
    minWidth: 820, minHeight: 560,
    title: 'AlbertosCharts', icon: ICON, backgroundColor: BG, show: false,
    webPreferences,
  });
  if (s.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  for (const ev of ['resize', 'move', 'close']) win.on(ev, () => saveState(win));
  win.loadURL(SMOKE ? `${origin}/#s=${process.env.WICKLINE_SMOKE_SYMBOL || 'YAHOO:AAPL'}&tf=${process.env.WICKLINE_SMOKE_TF || '1D'}` : `${origin}/`);
  if (SMOKE) runSmokeTest(win);
  return win;
}

/** True for a URL on the app's own local server (compared as origins: `http://127.0.0.1:41573@evil.example/` is not). */
function isAppUrl(url) {
  if (!origin) return false;
  try { return new URL(url).origin === origin; } catch { return false; }
}

// Permissions the page may use, and only on the app's own pages: alert notifications and copying
// a script to the clipboard (Publish). Everything else (camera, microphone, location, …) is refused.
const ALLOWED_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write']);
function allowPermission(permission, url) {
  return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(url);
}

// Every window: pop-out charts open as app windows; any other link opens in the system browser.
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 1100, height: 720, backgroundColor: BG, icon: ICON, webPreferences } };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    if (origin && !isAppUrl(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  // Windows/Linux have no menu bar (Alt+letter menus would steal the drawing shortcuts),
  // so the usual keys for reload, zoom, full screen and developer tools are handled here.
  if (!isMac) {
    contents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      const key = input.key.toLowerCase();
      const win = BrowserWindow.fromWebContents(contents);
      if (key === 'f5' || (ctrl && key === 'r')) { contents.reload(); e.preventDefault(); }
      else if (key === 'f12' || (ctrl && input.shift && key === 'i')) { contents.toggleDevTools(); e.preventDefault(); }
      else if (key === 'f11' && win) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
      else if (ctrl && (key === '=' || key === '+')) { contents.setZoomLevel(contents.getZoomLevel() + 0.5); e.preventDefault(); }
      else if (ctrl && key === '-') { contents.setZoomLevel(contents.getZoomLevel() - 0.5); e.preventDefault(); }
      else if (ctrl && key === '0') { contents.setZoomLevel(0); e.preventDefault(); }
    });
  }
});


// --- OANDA: token cifrado con el llavero del sistema (safeStorage) ------------------------------
const oandaPath = () => path.join(app.getPath('userData'), 'oanda.json');
let oandaCfg = { env: 'practice', token: '' };

function loadOanda() {
  try {
    const j = JSON.parse(readFileSync(oandaPath(), 'utf8'));
    const token = j.enc ? safeStorage.decryptString(Buffer.from(j.token, 'base64')) : (j.token || '');
    oandaCfg = { env: j.env === 'live' ? 'live' : 'practice', token };
  } catch { /* sin configurar */ }
  setOandaConfig(oandaCfg);
}

function saveOanda(cfg) {
  const enc = safeStorage.isEncryptionAvailable();
  const token = enc ? safeStorage.encryptString(cfg.token).toString('base64') : cfg.token;
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(oandaPath(), JSON.stringify({ env: cfg.env, enc, token }), { mode: 0o600 });
}


// --- Capital.com: API key, login y contraseña cifrados con el llavero del sistema -----------------
const capitalPath = () => path.join(app.getPath('userData'), 'capital.json');
let capitalCfg = { env: 'demo', identifier: '', apiKey: '', password: '' };
const seal = (v) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v).toString('base64') : v);
const unseal = (v, enc) => (enc && v ? safeStorage.decryptString(Buffer.from(v, 'base64')) : v || '');

function loadCapital() {
  try {
    const j = JSON.parse(readFileSync(capitalPath(), 'utf8'));
    capitalCfg = {
      env: j.env === 'live' ? 'live' : 'demo',
      identifier: unseal(j.identifier, j.enc),
      apiKey: unseal(j.apiKey, j.enc),
      password: unseal(j.password, j.enc),
    };
  } catch { /* sin configurar */ }
  setCapitalConfig(capitalCfg);
}

function saveCapital(c) {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(capitalPath(), JSON.stringify({
    env: c.env, enc: safeStorage.isEncryptionAvailable(),
    identifier: seal(c.identifier), apiKey: seal(c.apiKey), password: seal(c.password),
  }), { mode: 0o600 });
}

function setupCapital() {
  const fromApp = (e) => isAppUrl(e.senderFrame?.url || '');
  ipcMain.handle('capital:get', (e) => (fromApp(e) ? {
    env: capitalCfg.env, identifier: capitalCfg.identifier, hasApiKey: !!capitalCfg.apiKey, hasPassword: !!capitalCfg.password,
  } : null));
  ipcMain.handle('capital:set', async (e, input) => {
    if (!fromApp(e)) return { ok: false };
    const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const next = {
      env: input?.env === 'live' ? 'live' : 'demo',
      identifier: str(input?.identifier, 200),
      apiKey: str(input?.apiKey, 300) || capitalCfg.apiKey,
      password: (typeof input?.password === 'string' && input.password ? input.password.slice(0, 300) : '') || capitalCfg.password,
    };
    setCapitalConfig(next);
    const st = await capitalStatus();
    if (st.configured && !st.ok) { setCapitalConfig(capitalCfg); return { ok: false, error: st.error }; }
    capitalCfg = next;
    try { saveCapital(next); } catch (err) { return { ok: false, error: err.message }; }
    return { ok: true };
  });
}

// --- Journal de backtesting: un archivo JSON en la carpeta de la app, con copia de seguridad ---------
const journalDir = () => path.join(app.getPath('userData'), 'journal');
const MAX_JOURNAL = 50 * 1024 * 1024;

function setupJournal() {
  const fromApp = (e) => isAppUrl(e.senderFrame?.url || '');
  ipcMain.handle('journal:load', (e) => {
    if (!fromApp(e)) return null;
    for (const f of ['journal.json', 'journal.bak.json']) {
      try {
        const text = readFileSync(path.join(journalDir(), f), 'utf8');
        JSON.parse(text); // válido
        return text;
      } catch { /* siguiente */ }
    }
    return null;
  });
  ipcMain.handle('journal:save', (e, text) => {
    if (!fromApp(e) || typeof text !== 'string' || text.length > MAX_JOURNAL) return false;
    try { JSON.parse(text); } catch { return false; }
    const dir = journalDir();
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'journal.json');
    // Guardado atómico: archivo temporal + renombrar; la versión anterior queda como copia.
    try { if (existsSync(file)) cpSync(file, path.join(dir, 'journal.bak.json')); } catch { /* sin copia */ }
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  });
}

function setupDesktopExtras() {
  const fromApp = (e) => isAppUrl(e.senderFrame?.url || '');
  ipcMain.handle('oanda:get', (e) => (fromApp(e) ? { env: oandaCfg.env, hasToken: !!oandaCfg.token } : null));
  ipcMain.handle('oanda:set', async (e, input) => {
    if (!fromApp(e)) return { ok: false };
    const next = {
      env: input?.env === 'live' ? 'live' : 'practice',
      token: typeof input?.token === 'string' && input.token.trim() ? input.token.trim().slice(0, 300) : oandaCfg.token,
    };
    setOandaConfig(next);
    const st = await oandaStatus();
    if (next.token && !st.ok) { setOandaConfig(oandaCfg); return { ok: false, error: st.error }; }
    oandaCfg = next;
    try { saveOanda(next); } catch (err) { return { ok: false, error: err.message }; }
    return { ok: true };
  });
  ipcMain.handle('gpu:get', (e) => (fromApp(e) ? gpuState() : null));
  ipcMain.handle('gpu:set', (e, backend) => (fromApp(e) ? setGpuBackend(String(backend)) : false));
}

function buildMenu() {
  if (!isMac) return null;
  return Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]);
}

function runSmokeTest(win) {
  const errors = [];
  win.webContents.on('console-message', (event, level, message) => {
    const lvl = event?.level ?? level;
    const msg = event?.message ?? message;
    if (lvl === 'error' || lvl === 3) errors.push(String(msg).slice(0, 200));
  });
  // Start from a known theme (WICKLINE_SMOKE_THEME=light|dark), then reload and check the page.
  const theme = process.env.WICKLINE_SMOKE_THEME === 'light' ? 'light' : 'dark';
  win.webContents.once('did-finish-load', async () => {
    await win.webContents.executeJavaScript(`localStorage.setItem('wickline.theme', '"${theme}"')`);
    win.webContents.once('did-finish-load', () => collect());
    win.webContents.reload();
  });
  const collect = async () => {
    await new Promise((r) => setTimeout(r, 9000));
    const info = await win.webContents.executeJavaScript(`({
      title: document.title,
      mode: document.body.dataset.mode,
      chart: document.querySelector('.cell .lg-title')?.innerText.replace(/\\n/g, ' '),
      ohlc: document.querySelector('.cell .lg-ohlc')?.innerText.replace(/\\s+/g, ' '),
      chartError: [...document.querySelectorAll('.cell .overlay.error')].filter((e) => !e.hidden).map((e) => e.innerText)[0] || null,
      markets: document.querySelector('#mk-count')?.textContent,
    })`);
    const shot = process.env.WICKLINE_SMOKE_SHOT;
    if (shot) writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    const gpu = await gpuState().catch(() => null);
    console.log(`SMOKE ${JSON.stringify({ origin, ...info, gpu: gpu && { active: gpu.active, renderer: gpu.renderer, canvas: gpu.status?.['2d_canvas'], raster: gpu.status?.rasterization, compositing: gpu.status?.gpu_compositing }, errors })}`);
    app.quit();
  };
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => { if (!isMac || SMOKE) app.quit(); });
app.on('activate', () => { if (origin && !BrowserWindow.getAllWindows().length) mainWindow = createMainWindow(); });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu());
  loadOanda();
  loadCapital();
  setupDesktopExtras();
  setupCapital();
  setupJournal();
  try {
    origin = await startLocalServer();
  } catch (e) {
    console.error('Could not start the local server:', e);
    app.quit();
    return;
  }
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowPermission(permission, details?.requestingUrl || contents?.getURL() || ''));
  });
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => (
    allowPermission(permission, requestingOrigin || details?.requestingUrl || contents?.getURL() || '')
  ));
  ses.setDevicePermissionHandler?.(() => false); // no USB, serial or HID devices
  // Network proxy (Data sources), for places where the data sources are blocked: set before anything connects.
  await setupProxy({ ses, ipcMain, dir: app.getPath('userData'), isAppUrl }).ready;
  mainWindow = createMainWindow();
});
