'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Local single-user desktop app. Keep Chromium startup reliable on Windows
// machines where the AppContainer sandbox is blocked by policy.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-features', 'Translate');

app.setName('MOSS CORE');

const gotLock = app.requestSingleInstanceLock();
let win = null;

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(createWindow);
}

function createWindow() {
  app.setAppUserModelId('com.550c.mosscore');
  Menu.setApplicationMenu(null);

  const icon = path.join(__dirname, 'icon.ico');
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    frame: true,
    backgroundColor: '#04060a',
    title: 'MOSS CORE · 异动监测',
    icon: fs.existsSync(icon) ? icon : undefined,
    autoHideMenuBar: true,
    roundedCorners: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'), { hash: 'neural' }).catch((error) => {
    // Never open a dialog on launch. The error is written beside the app.
    try {
      fs.appendFileSync(path.join(app.getPath('userData'), 'startup.log'),
        `[${new Date().toISOString()}] load failed: ${error && error.stack ? error.stack : error}\n`);
    } catch {
      // Logging is optional.
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  app.on('activate', () => {
    if (!win) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
