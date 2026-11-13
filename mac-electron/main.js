'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('MOSS CORE');

const ROOT = app.getAppPath();
const CONFIG_PATH = path.join(ROOT, 'data-source.json');
const CACHE_PATH = () => path.join(app.getPath('userData'), 'live-snapshot.json');
const LICENSE_PATH = () => path.join(app.getPath('userData'), 'license.dat');
const LOG_PATH = () => path.join(app.getPath('userData'), 'mac.log');
const POLL_MS = 60 * 1000;

let win = null;
let timer = null;
let busy = false;
let stopped = false;
let licenseKey = null;
let gateBusy = false;

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

// ---------- 设备标识 ----------
function buildDeviceId() {
  let input = os.hostname();
  try {
    const idPath = '/Library/Preferences/com.apple.computerInfo.plist';
    if (fs.existsSync(idPath)) input = idPath;
  } catch {}
  // macOS 上使用硬件 UUID
  try {
    const out = require('node:child_process')
      .execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', { encoding: 'utf8', timeout: 3000 })
      .toString();
    const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (m && m[1]) input = m[1];
  } catch {}
  return crypto.createHash('sha256').update('MOSS-CORE:' + input).digest('hex');
}

const DEVICE_ID = buildDeviceId();

// ---------- 许可证存储 ----------
function saveLicense(license, expires) {
  try {
    const p = LICENSE_PATH();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ license, deviceId: DEVICE_ID, expiresAt: expires || '' }), { mode: 0o600 });
  } catch (e) {
    log('license save error', e.message);
  }
}

function loadLicense() {
  try {
    const p = LICENSE_PATH();
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || !data.license) return null;
    if (data.deviceId && data.deviceId !== DEVICE_ID) return null;
    return data;
  } catch {
    return null;
  }
}

function clearLicense() {
  try { fs.unlinkSync(LICENSE_PATH()); } catch {}
  licenseKey = null;
}

// ---------- 激活 ----------
async function activate(code) {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: '配置缺失' };
  try {
    log('activating:', code);
    const resp = await fetch(cfg.url + '/license/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: String(code || '').trim(),
        device_id: DEVICE_ID,
        device_name: os.hostname()
      }),
      signal: AbortSignal.timeout(20000)
    });
    const text = await resp.text();
    log('activate response', resp.status, text.slice(0, 200));

    if (!resp.ok) {
      let msg = `激活失败：HTTP ${resp.status}`;
      try {
        const j = JSON.parse(text);
        if (j.error === 'already_bound') msg = '邀请码已绑定其他电脑，请先在旧电脑解绑或联系管理员。';
        else if (j.error === 'invalid_code') msg = '邀请码无效。';
        else if (j.error === 'code_expired_or_revoked') msg = '邀请码已过期或被停用。';
      } catch {}
      return { ok: false, error: msg };
    }

    const data = JSON.parse(text);
    if (!data.license) return { ok: false, error: '服务器没有返回许可证。' };
    saveLicense(data.license, data.expires_at);
    licenseKey = data.license;
    return { ok: true, error: '', expires: data.expires_at || '' };
  } catch (e) {
    log('activate error', e.message);
    return { ok: false, error: '无法连接激活服务器：' + e.message };
  }
}

async function validateLicense() {
  const cfg = readConfig();
  if (!cfg || !licenseKey) return false;
  try {
    const resp = await fetch(cfg.url + '/license/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license: licenseKey }),
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return !!data.ok;
  } catch (e) {
    log('validate error', e.message);
    return true; // 网络问题时放行，避免断网踢人
  }
}

// ---------- 页面注入 ----------
async function sendToPage(eventName, detail) {
  if (!win || win.isDestroyed()) return;
  try {
    const json = JSON.stringify(detail);
    await win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('${eventName}',{detail:${json}}));`, true
    );
  } catch (e) {
    log('sendToPage error', e.message);
  }
}

async function sendGate(mode, error) {
  // 模拟 WebView2 的 activation-state 消息
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
      `(function(){try{var m=JSON.parse(${json});window.dispatchEvent(new MessageEvent('message',{data:m}));var n=window.chrome&&window.chrome.webview;if(n&&n.__dispatch)n.__dispatch(m);}catch(e){}})();`,
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
  } catch (e) {
    log('inject error', e.message);
  }
}

// ---------- 数据轮询 ----------
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

// ---------- 消息处理 ----------
async function handleMessage(payload) {
  const type = payload && payload.type;

  if (type === 'quit') {
    app.quit();
    return;
  }

  if (type === 'activate') {
    if (gateBusy) return;
    gateBusy = true;
    try {
      await sendGate('busy', '');
      const result = await activate(payload.code);
      if (result.ok) {
        await sendGate('ok', '');
        await poll();
      } else {
        await sendGate('need', result.error);
      }
    } finally {
      gateBusy = false;
    }
    return;
  }

  if (type === 'gateCheck') {
    const ok = await validateLicense();
    await sendGate(ok ? 'ok' : 'need', '');
    return;
  }

  if (type === 'trade' || type === 'tradeConfig') {
    // macOS 版暂不支持币安下单
    await sendToPage('moss:trade', { type: 'error', ok: false, message: 'macOS 版暂不支持自动下单' });
    return;
  }
}

// ---------- 窗口 ----------
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
    // 检查许可证
    const stored = loadLicense();
    if (stored) {
      licenseKey = stored.license;
      const ok = await validateLicense();
      if (ok) {
        await sendGate('ok', '');
        const cached = readCache();
        if (cached) await inject(cached);
        await poll();
        schedule();
        return;
      }
      clearLicense();
    }
    await sendGate('need', '');
  });

  win.on('closed', () => {
    win = null;
    stopped = true;
    clearTimeout(timer);
  });
}

ipcMain.on('moss-message', (event, payload) => {
  handleMessage(payload).catch((e) => log('handleMessage error', e.message));
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
