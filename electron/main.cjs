'use strict';

const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, nativeImage, screen, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer } = require('../server/index.cjs');
const { drawAppIcon, drawTrayIcon } = require('./icon.cjs');

const isDev = process.argv.includes('--dev');
const startHidden = process.argv.includes('--hidden');

// LPAC / hardened Windows environments can block Chromium's AppContainer
// sandbox and crash Electron at startup with EXCEPTION_BREAKPOINT.
// This is a local-only, single-user terminal, so the process sandbox is
// intentionally disabled to keep startup reliable on those machines.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

let appRoot = process.cwd();
try {
  appRoot = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
} catch {
  // Fall back to the working directory; the launcher sets it to the app root.
}
const portableData = process.env.APP_DATA_DIR || path.join(appRoot, 'data');
try {
  fs.mkdirSync(portableData, { recursive: true });
} catch {
  // The startup log below will show the failure if the path is not writable.
}
try {
  app.setPath('userData', path.join(portableData, 'profile'));
  app.setPath('sessionData', path.join(portableData, 'profile'));
} catch {
  // Older Electron builds may not expose sessionData; userData is enough.
}
const STARTUP_LOG = path.join(portableData, 'startup.log');

function logLine(...parts) {
  try {
    const text = parts
      .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
      .join(' ');
    fs.appendFileSync(STARTUP_LOG, `[${new Date().toISOString()}] ${text}\n`, 'utf8');
  } catch {
    // Logging must never prevent the app from starting.
  }
}

logLine('main loaded', { argv: process.argv, appRoot, portableData, electron: process.versions.electron });

process.on('uncaughtException', (error) => {
  logLine('uncaughtException', error && error.stack ? error.stack : String(error));
  try {
    dialog.showErrorBox('550C 启动异常', error && error.stack ? error.stack : String(error));
  } catch {
    // The process is already unstable; the log is enough.
  }
});
process.on('unhandledRejection', (error) => {
  logLine('unhandledRejection', error && error.stack ? error.stack : String(error));
});

let mainWindow = null;
let tray = null;
let serverInfo = null;
let quitting = false;
let shuttingDown = false;
let windowStateTimer = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logLine('single instance lock not acquired');
  app.quit();
} else {
  app.setAppUserModelId('com.550c.market.terminal');
  app.on('second-instance', () => showWindow());
  app.whenReady().then(boot).catch((error) => {
    logLine('boot rejected', error && error.stack ? error.stack : String(error));
    dialog.showErrorBox('550C 启动失败', error && error.stack ? error.stack : String(error));
    app.quit();
  });
}

function getAppIcon(size = 256) {
  try {
    return nativeImage.createFromBuffer(drawAppIcon(size));
  } catch {
    return nativeImage.createEmpty();
  }
}

function loadWindowState() {
  const file = path.join(app.getPath('userData'), 'window.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && Number.isFinite(raw.width) && Number.isFinite(raw.height)) {
      const bounds = {
        x: Number(raw.x),
        y: Number(raw.y),
        width: Math.max(1080, Math.floor(raw.width)),
        height: Math.max(680, Math.floor(raw.height)),
      };
      if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
        const visible = screen.getAllDisplays().some((display) => {
          const area = display.workArea;
          return bounds.x < area.x + area.width - 80 && bounds.x + bounds.width > area.x + 80
            && bounds.y < area.y + area.height - 60 && bounds.y + bounds.height > area.y + 40;
        });
        if (visible) return { bounds, maximized: Boolean(raw.maximized) };
      }
    }
  } catch {
    // First run or a stale state file.
  }
  return { bounds: { width: 1440, height: 900 }, maximized: false };
}

function saveWindowState() {
  if (!mainWindow) return;
  const file = path.join(app.getPath('userData'), 'window.json');
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...bounds, maximized }), 'utf8');
  } catch {
    // Window position is nice to have, never fatal.
  }
}

function scheduleWindowSave() {
  if (windowStateTimer) clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    windowStateTimer = null;
    saveWindowState();
  }, 250);
}

function applyLoginItem(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'],
    });
  } catch (error) {
    console.error('[550C] 设置开机启动失败：', error.message);
  }
}

function getWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function showWindow() {
  if (!serverInfo) return;
  const win = getWindow();
  if (!win) {
    createWindow(false);
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function hideWindow() {
  const win = getWindow();
  if (win) win.hide();
}

function toggleWindow() {
  if (!serverInfo) return;
  const win = getWindow();
  if (!win) {
    createWindow(false);
  } else if (win.isVisible()) {
    win.hide();
  } else {
    showWindow();
  }
}

function createWindow(hidden = false) {
  if (mainWindow) return mainWindow;
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    ...state.bounds,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#04060a',
    title: '550C Market Terminal',
    icon: getAppIcon(256),
    autoHideMenuBar: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.loadURL(serverInfo.url).catch(() => {
    // `did-fail-load` shows the diagnostic; swallow the rejected promise here.
  });

  let shown = Boolean(hidden || startHidden);
  const showOnce = (reason) => {
    if (shown || !mainWindow || mainWindow.isDestroyed() || startHidden) return;
    shown = true;
    logLine('window show', reason);
    mainWindow.show();
    mainWindow.focus();
  };

  mainWindow.once('ready-to-show', () => {
    showOnce('ready-to-show');
    if (state.maximized) mainWindow.maximize();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logLine('did-finish-load');
    showOnce('did-finish-load');
  });

  setTimeout(() => {
    if (!shown) showOnce('show-timeout');
  }, 4500);

  mainWindow.on('maximize', () => mainWindow.webContents.send('win:state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('win:state', { maximized: false }));
  mainWindow.on('resize', scheduleWindowSave);
  mainWindow.on('move', scheduleWindowSave);
  mainWindow.on('close', (event) => {
    if (quitting) return;
    const settings = serverInfo ? serverInfo.getSettings() : null;
    if (settings && settings.minimizeToTray && tray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    saveWindowState();
    quitting = true;
    app.quit();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    logLine('did-fail-load', { errorCode, errorDescription, validatedURL });
    if (mainWindow && !mainWindow.isDestroyed()) {
      shown = true;
      mainWindow.show();
      dialog.showErrorBox('550C 页面加载失败', `${errorDescription} (${errorCode})\n${validatedURL}`);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (serverInfo && !url.startsWith(serverInfo.url)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'notifications');
  });

  return mainWindow;
}

function notify(notification) {
  if (!serverInfo || !notification) return;
  const settings = serverInfo.getSettings();
  if (!settings.desktopNotifications) return;
  const win = getWindow();
  if (notification.kind !== 'test' && win && win.isFocused()) return;
  try {
    const item = new Notification({
      title: notification.title || '550C ALERT',
      body: notification.body || '',
      silent: !settings.sound,
      icon: getAppIcon(128),
      urgency: 'critical',
    });
    item.on('click', () => {
      showWindow();
      const win = getWindow();
      if (win) {
        win.webContents.send('app:navigate', {
          symbol: notification.symbol || null,
          tab: 'alerts',
        });
      }
    });
    item.show();
  } catch (error) {
    console.error('[550C] 系统通知失败：', error.message);
  }
}

function buildTrayMenu() {
  if (!tray || !serverInfo) return;
  const settings = serverInfo.getSettings();
  const menu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏 550C',
      click: toggleWindow,
    },
    { type: 'separator' },
    {
      label: '暂停预警',
      type: 'checkbox',
      checked: Boolean(settings.alertsMuted),
      click: (item) => {
        const next = serverInfo.setSettings({ alertsMuted: item.checked });
        serverInfo._context.hub.broadcast('settings', next);
        buildTrayMenu();
      },
    },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: Boolean(settings.launchAtLogin),
      click: (item) => {
        applyLoginItem(item.checked);
        const next = serverInfo.setSettings({ launchAtLogin: item.checked });
        serverInfo._context.hub.broadcast('settings', next);
        buildTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '打开数据目录',
      click: () => shell.openPath(serverInfo.getDataDir()),
    },
    {
      label: '550C // MARKET TERMINAL',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  try {
    const image = nativeImage.createFromBuffer(drawTrayIcon(32));
    tray = new Tray(image);
    tray.setToolTip('550C // MARKET TERMINAL');
    tray.on('click', toggleWindow);
    buildTrayMenu();
  } catch (error) {
    tray = null;
    logLine('tray failed', error.message);
    console.error('[550C] 托盘初始化失败：', error.message);
  }
}

function registerIpc() {
  ipcMain.on('win:minimize', () => {
    const win = getWindow();
    if (win) win.minimize();
  });
  ipcMain.on('win:toggle-maximize', () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('win:close', () => {
    const win = getWindow();
    if (!win) return;
    const settings = serverInfo ? serverInfo.getSettings() : null;
    if (settings && settings.minimizeToTray && tray) win.hide();
    else win.close();
  });
  ipcMain.handle('win:is-maximized', () => {
    const win = getWindow();
    return Boolean(win && win.isMaximized());
  });
  ipcMain.handle('app:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return shell.openExternal(url);
    return false;
  });
  ipcMain.handle('app:open-data', () => (serverInfo ? shell.openPath(serverInfo.getDataDir()) : false));
  ipcMain.handle('app:get-launch-at-login', () => {
    try {
      return app.getLoginItemSettings().openAtLogin;
    } catch {
      return Boolean(serverInfo && serverInfo.getSettings().launchAtLogin);
    }
  });
  ipcMain.handle('app:set-launch-at-login', (_event, enabled) => {
    applyLoginItem(Boolean(enabled));
    if (serverInfo) {
      const next = serverInfo.setSettings({ launchAtLogin: Boolean(enabled) });
      serverInfo._context.hub.broadcast('settings', next);
      buildTrayMenu();
    }
    return Boolean(enabled);
  });
  ipcMain.handle('app:test-notification', () => {
    if (!serverInfo) return false;
    const notification = serverInfo._context.alerts.test();
    return Boolean(notification);
  });
}

async function boot() {
  logLine('boot start');
  serverInfo = await startServer({
    dataDir: path.join(portableData, 'store'),
    port: 0,
    host: '127.0.0.1',
    desktop: true,
    onNotify: notify,
  });
  logLine('server started', { url: serverInfo.url, dataDir: serverInfo.getDataDir() });

  applyLoginItem(Boolean(serverInfo.getSettings().launchAtLogin));
  registerIpc();
  createWindow(false);
  logLine('window created');
  createTray();

  app.on('activate', () => showWindow());
  app.on('before-quit', async (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    quitting = true;
    logLine('before-quit');
    saveWindowState();
    try {
      await Promise.race([
        serverInfo.close(),
        new Promise((resolve) => setTimeout(resolve, 2500)),
      ]);
    } catch (error) {
      logLine('server close failed', error.message);
      console.error('[550C] 关闭服务失败：', error.message);
    }
    app.quit();
  });
  app.on('window-all-closed', () => {
    // Keep the collector alive in the tray. Quit is explicit through the tray menu.
  });
}
