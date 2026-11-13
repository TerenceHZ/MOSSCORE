'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('MOSS CORE');

const ROOT = app.getAppPath();
const RES = process.resourcesPath || path.join(ROOT, '..');

// 跳过激活验证（调试版）
const SKIP_ACTIVATION = true;

function findConfig() {
  const candidates = [
    path.join(RES, 'data-source.json'),
    path.join(ROOT, 'data-source.json'),
    path.join(app.getPath('userData'), 'data-source.json'),
    path.join(path.dirname(app.getPath('exe')), '..', 'Resources', 'data-source.json')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        log('config found at', c);
        return c;
      }
    } catch {}
  }
  return null;
}

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

// 内置默认配置（找不到文件时使用）
const DEFAULT_CONFIG = {
  url: 'https://43-160-232-254.sslip.io',
  token: 'yb4m3bG30ZIW0v4CwBzgGxoidZhRllej8vAmfxk6jzo'
};

function readConfig() {
  try {
    const cfgPath = findConfig();
    if (cfgPath) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (cfg && cfg.url) {
        return { url: String(cfg.url).replace(/\/+$/, ''), token: String(cfg.token || '') };
      }
    }
    log('using built-in default config');
    return DEFAULT_CONFIG;
  } catch (e) {
    log('config error', e.message, '- using default');
    return DEFAULT_CONFIG;
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

async function sendGate(mode, error) {
  if (!win || win.isDestroyed()) return;
  try {
    const payload = {
      type: 'activation-state',
      show: mode !== 'ok',
      error: mode === 'need' ? (error || '') : '',
      loading: mode === 'busy'
    };
    const json = JSON.stringify(JSON.stringify(payload));
    await win.webContents.executeJavaScript(
      `(function(){try{var m=JSON.parse(${json});window.dispatchEvent(new MessageEvent('message',{data:m}));}catch(e){}})();`,
      true
    );
  } catch (e) {
    log('sendGate error', e.message);
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
    log('injected rows', (data.rows || []).length);
  } catch (e) {
    log('inject error', e.message);
  }
}

async function poll() {
  if (stopped || busy) return;
  const cfg = readConfig();
  busy = true;
  try {
    const res = await fetch(cfg.url + '/snapshot', {
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {},
      signal: AbortSignal.timeout(25000),
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.rows)) throw new Error('invalid snapshot');
    saveCache(data);
    await inject(data);
    log('snapshot ok', data.updatedAt, 'rows', data.rows.length);
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

async function handleMessage(payload) {
  const type = payload && payload.type;
  if (type === 'quit') {
    app.quit();
    return;
  }
  if (type === 'activate' || type === 'gateCheck') {
    // 调试版：直接放行
    await sendGate('ok', '');
    await poll();
    schedule();
    return;
  }
  if (type === 'trade' || type === 'tradeConfig') {
    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('moss:trade',{detail:{type:'error',ok:false,message:'macOS 版暂不支持自动下单'}}));`,
      true
    ).catch(() => {});
  }
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
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'index.html'));

  win.webContents.on('did-finish-load', async () => {
    log('page loaded');
    if (SKIP_ACTIVATION) {
      log('SKIP_ACTIVATION enabled, entering main directly');
      await sendGate('ok', '');
      const cached = readCache();
      if (cached) await inject(cached);
      await poll();
      schedule();
      return;
    }
  });

  win.on('closed', () => {
    win = null;
    stopped = true;
    clearTimeout(timer);
  });
}

ipcMain.on('moss-message', (event, payload) => {
  let msg = payload;
  if (typeof msg === 'string') {
    try { msg = JSON.parse(msg); } catch { return; }
  }
  handleMessage(msg).catch((e) => log('handleMessage error', e.message));
});

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
