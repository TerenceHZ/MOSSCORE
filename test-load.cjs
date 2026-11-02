const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1600, height: 900, webPreferences: { sandbox: false } });
  win.webContents.on('console-message', (_e, level, message) => console.log('CONSOLE', level, message));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log('FAIL', code, desc, url));
  win.webContents.on('render-process-gone', (_e, details) => console.log('GONE', JSON.stringify(details)));
  win.webContents.on('did-finish-load', () => console.log('LOADED', win.webContents.getURL()));
  await win.loadFile(path.join(process.cwd(), 'vendor/agent-display/index.html'), { hash: 'forge' });
  setTimeout(() => {
    console.log('TITLE', win.webContents.getTitle());
    app.quit();
  }, 5000);
});
