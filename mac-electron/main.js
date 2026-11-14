'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { execSync } = require('node:child_process');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.setName('MOSS CORE');

const ROOT = app.getAppPath();
const RES = process.resourcesPath || path.join(ROOT, '..');
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

// ---------- 日志 ----------
function log(...parts) {
  try {
    const logPath = LOG_PATH();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${parts.map(String).join(' ')}\n`);
  } catch {}
}

// ---------- 配置 ----------
function findConfig() {
  const candidates = [
    path.join(RES, 'data-source.json'),
    path.join(ROOT, 'data-source.json'),
    path.join(path.dirname(app.getPath('exe')), '..', 'Resources', 'data-source.json'),
    path.join(app.getPath('userData'), 'data-source.json')
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
    log('using built-in config');
    return DEFAULT_CONFIG;
  } catch (e) {
    log('config error', e.message, '- using default');
    return DEFAULT_CONFIG;
  }
}

// ---------- 缓存 ----------
function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH(), 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(data) {
  try {
    const p = CACHE_PATH();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data));
  } catch (e) {
    log('cache write error', e.message);
  }
}

// ---------- 设备 ID ----------
function buildDeviceId() {
  let input = os.hostname();
  try {
    const out = execSync(
      'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
      { encoding: 'utf8', timeout: 3000 }
    ).toString();
    const m = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    if (m && m[1]) input = m[1];
  } catch {}
  const id = crypto.createHash('sha256').update('MOSS-CORE:' + input).digest('hex');
  log('device id', id.slice(0, 16));
  return id;
}

const DEVICE_ID = buildDeviceId();

// ---------- 许可证 ----------
function saveLicense(license, expires) {
  try {
    const p = LICENSE_PATH();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ license, deviceId: DEVICE_ID, expiresAt: expires || '' }), { mode: 0o600 });
    log('license saved');
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
    if (data.deviceId && data.deviceId !== DEVICE_ID) {
      log('stored license device mismatch');
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function clearLicense() {
  try { fs.unlinkSync(LICENSE_PATH()); } catch {}
  licenseKey = null;
  log('license cleared');
}

// ---------- 激活 ----------
async function activate(code) {
  const cfg = readConfig();
  const url = cfg.url + '/license/activate';
  log('POST', url, 'code=', code);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: String(code || '').trim().toUpperCase(),
        device_id: DEVICE_ID,
        device_name: os.hostname()
      }),
      signal: AbortSignal.timeout(25000)
    });
    const text = await resp.text();
    log('activate status', resp.status, 'body:', text.slice(0, 200));

    if (!resp.ok) {
      let msg = `激活失败（HTTP ${resp.status}）`;
      try {
        const j = JSON.parse(text);
        if (j.error === 'already_bound') msg = '邀请码已绑定其他电脑，请联系管理员解绑。';
        else if (j.error === 'invalid_code') msg = '邀请码无效，请检查后重试。';
        else if (j.error === 'code_expired_or_revoked') msg = '邀请码已过期或被停用。';
      } catch {}
      return { ok: false, error: msg };
    }

    const data = JSON.parse(text);
    if (!data.license) {
      return { ok: false, error: '服务器未返回许可证。' };
    }
    saveLicense(data.license, data.expires_at);
    licenseKey = data.license;
    log('activated ok, expires', data.expires_at);
    return { ok: true, error: '', expires: data.expires_at || '' };
  } catch (e) {
    log('activate error', e.message);
    return { ok: false, error: '无法连接激活服务器：' + e.message };
  }
}

// ---------- 授权（features） ----------
const entitlement = { trade: false };

async function pushEntitlement() {
  if (!win || win.isDestroyed()) return;
  const payload = { type: 'config', entitled: !!entitlement.trade, preview: false, configured: false, autoTrade: false };
  try {
    const json = JSON.stringify(JSON.stringify(payload));
    const code = "(function(){try{var d=JSON.parse(" + json + ");window.dispatchEvent(new CustomEvent('moss:trade',{detail:d}));}catch(e){}})();";
    await win.webContents.executeJavaScript(code, true);
    await win.webContents.executeJavaScript(entitlementDomScript(), true);
  } catch (e) { log('pushEntitlement error', e.message); }
}

function entitlementDomScript() {
  // macOS 版：API 面板统一提示“功能暂未开放”
  return "(function(){" +
    "var deep=function(id){var walk=function(root){try{if(root.getElementById){var el=root.getElementById(id);if(el)return el;}" +
    "var e2=root.querySelector?root.querySelector('#'+id):null;if(e2)return e2;" +
    "var all=root.querySelectorAll?root.querySelectorAll('*'):[];" +
    "for(var i=0;i<all.length;i++){var h=all[i];if(h.shadowRoot){var r=walk(h.shadowRoot);if(r)return r;}}}catch(e){}return null;};return walk(document);};" +
    "var setup=deep('nvBinanceSetup');var key=deep('nvBsKey');var sec=deep('nvBsSecret');" +
    "var test=deep('nvBsTest');var save=deep('nvBsSave');var lock=deep('nvBsLockPage');" +
    "if(setup){setup.classList.add('locked');var rows=setup.querySelectorAll('.nv-bs-row,.nv-bs-status,.nv-bs-actions,.nv-bs-tip');" +
    "for(var i=0;i<rows.length;i++){rows[i].style.display='none';}}" +
    "if(lock){lock.style.display='block';" +
    "var t=lock.querySelector('.nv-lp-title');var d=lock.querySelector('.nv-lp-desc');var h=lock.querySelector('.nv-lp-hint');" +
    "if(t)t.textContent='功能暂未开放';if(d)d.textContent='macOS 版暂不支持 API 配置与下单';if(h)h.textContent='如需自动下单，请使用 Windows 版客户端';}" +
    "[key,sec,test,save].forEach(function(el){if(el){el.disabled=true;if('readOnly' in el)el.readOnly=true;}});" +
    "if(!window.__MOSS_MAC_LOCKED){window.__MOSS_MAC_LOCKED=true;" +
    "var orig=window.__MOSS_OPEN_SETUP;window.__MOSS_OPEN_SETUP=function(){try{if(orig)orig();}catch(e){}" +
    "setTimeout(function(){try{var st=deep('nvBinanceSetup');if(st)st.classList.add('locked');var lk=deep('nvBsLockPage');if(lk)lk.style.display='block';}catch(e){}},30);};}" +
    "})();";
}
async function validateLicense() {
  const cfg = readConfig();
  if (!licenseKey) return false;
  try {
    const resp = await fetch(cfg.url + '/license/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license: licenseKey }),
      signal: AbortSignal.timeout(15000)
    });
    const text = await resp.text();
    log('validate status', resp.status, text.slice(0, 120));
    if (!resp.ok) return false;
    const data = JSON.parse(text);
    if (data && data.features && typeof data.features === 'object') {
      entitlement.trade = !!data.features.trade;
    }
    return !!data.ok;
  } catch (e) {
    log('validate error', e.message, '- allowing offline');
    return true;
  }
}

// ---------- 页面通信 ----------
async function sendGate(mode, error) {
  if (!win || win.isDestroyed()) return;
  const payload = {
    type: 'activation-state',
    show: mode !== 'ok',
    error: mode === 'need' ? (error || '') : '',
    loading: mode === 'busy'
  };
  log('sendGate', mode, error || '');
  try {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('moss-to-page', payload);
    }
    const json = JSON.stringify(JSON.stringify(payload));
    await win.webContents.executeJavaScript(
      `(function(){try{var m=JSON.parse(${json});` +
      `if(window.chrome&&window.chrome.webview&&window.chrome.webview.__dispatch){window.chrome.webview.__dispatch(m);}` +
      `else{window.dispatchEvent(new MessageEvent('message',{data:m}));}}catch(e){}})();`,
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

// ---------- 轮询 ----------
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

function startDataFlow() {
  const cached = readCache();
  if (cached) {
    inject(cached).catch(() => {});
  }
  poll().then(() => schedule()).catch((e) => log('start data error', e.message));
}

// ---------- 消息处理 ----------
async function handleMessage(payload) {
  const type = payload && payload.type;
  log('handleMessage type=', type);

  if (type === 'quit') {
    app.quit();
    return;
  }

  if (type === 'activate') {
    if (gateBusy) {
      log('activation already in progress');
      return;
    }
    gateBusy = true;
    try {
      await sendGate('busy', '');
      const result = await activate(payload.code);
      if (result.ok) {
        await sendGate('ok', '');
        startDataFlow();
      } else {
        await sendGate('need', result.error);
      }
    } catch (e) {
      log('activate flow error', e.message);
      await sendGate('need', '激活出错：' + e.message);
    } finally {
      gateBusy = false;
    }
    return;
  }

  if (type === 'gateCheck') {
    const ok = await validateLicense();
    await sendGate(ok ? 'ok' : 'need', '');
      await pushEntitlement();
    if (ok) startDataFlow();
    return;
  }

  if (type === 'trade' || type === 'tradeConfig') {
    if (win && !win.isDestroyed()) {
      await win.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('moss:trade',{detail:{type:'error',ok:false,message:'macOS 版暂不支持自动下单'}}));`,
        true
      ).catch(() => {});
    }
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
    setTimeout(() => { pushEntitlement().catch(() => {}); }, 1200);
    log('page loaded');
    const stored = loadLicense();
    if (stored) {
      licenseKey = stored.license;
      log('found stored license, validating...');
      const ok = await validateLicense();
      if (ok) {
        log('license valid, entering main');
        await sendGate('ok', '');
        startDataFlow();
        return;
      }
      log('license invalid, clearing');
      clearLicense();
    }
    log('showing activation gate');
    await sendGate('need', '');
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
  log('ipc:', JSON.stringify(msg).slice(0, 120));
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
