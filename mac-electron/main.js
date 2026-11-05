'use strict';

const { app, BrowserWindow, Menu, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('MOSS CORE');

const ROOT = app.getAppPath();
const CONFIG_PATH = path.join(ROOT, 'data-source.json');
const CACHE_PATH = () => path.join(app.getPath('userData'), 'live-snapshot.json');
const LOG_PATH = () => path.join(app.getPath('userData'), 'mac.log');
const POLL_MS = 60 * 1000;

let win = null;
let timer = null;
let busy = false;
let stopped = false;

function log(...parts) {
  try {
    const logPath = LOG_PATH();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${parts.map(String).join(' ')}\n`);
  } catch {}
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!cfg || !cfg.url) return null;
    return { url: String(cfg.url).replace(/\/+$/, ''), token: String(cfg.token || '') };
  } catch (e) {
    log('config error', e.message);
    return null;
  }
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH(), 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(data) {
  try {
    const cachePath = CACHE_PATH();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data));
  } catch (e) {
    log('cache write error', e.message);
  }
}

async function inject(data) {
  if (!win || win.isDestroyed() || !data) return;
  try {
    const json = JSON.stringify(data);
    await win.webContents.executeJavaScript(
      `window.__MOSS_LIVE=${json};window.dispatchEvent(new Event('moss:live'));`,
      true
    );
  } catch (e) {
    log('inject error', e.message);
  }
}

async function poll() {
  if (stopped || busy) return;
  const cfg = readConfig();
  if (!cfg) {
    log('remote config missing or invalid');
    return;
  }
  busy = true;
  try {
    const res = await fetch(cfg.url + '/snapshot', {
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
      signal: AbortSignal.timeout(20000),
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.rows)) throw new Error('invalid snapshot');
    saveCache(data);
    await inject(data);
    log('snapshot', data.updatedAt, 'rows', data.rows.length);
  } catch (e) {
    log('poll error', e.message);
  } finally {
    busy = false;
  }
}

function schedule() {
  if (stopped) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    await poll();
    schedule();
  }, POLL_MS);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#050608',
    title: 'MOSS CORE · 异动监测',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'index.html'));

  win.webContents.on('did-finish-load', async () => {
    const cached = readCache();
    if (cached) await inject(cached);
    await poll();
    schedule();
  });

  win.on('closed', () => {
    win = null;
    stopped = true;
    clearTimeout(timer);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'MOSS CORE', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { role: 'windowMenu' }
    ]));
    createWindow();
  }).catch((e) => {
    log('boot error', e.stack || e.message);
    dialog.showErrorBox('MOSS CORE 启动失败', String(e.stack || e.message));
  });

  app.on('window-all-closed', () => app.quit());
}
