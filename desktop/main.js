if(process.argv.includes('--draftdrion-browser-worker')){require('./browser-worker');}
else {
const {app, BrowserWindow, dialog, Menu} = require('electron');
const path = require('node:path');

app.setName('Draftdrion');
app.setAppUserModelId('io.balajedrion.draftdrion');
let window, server, origin;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
  });
  app.whenReady().then(start).catch(() => {
    dialog.showErrorBox('Draftdrion could not start', 'Check that desktop.env is valid and your local data folder is writable, then try again.');
    app.quit();
  });
}

async function start() {
  if (app.isPackaged) {
    const data = process.env.CODEBENCH_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(app.getPath('home'),'.local','share'),'GwensCodebench');
    process.env.DRAFTDRION_ENV_FILE = path.join(data,'desktop.env');
  }
  const {app:backend} = require('../server');
  backend.locals.desktop = true;
  server = await new Promise((resolve,reject) => {
    const listener = backend.listen(0,'127.0.0.1',() => resolve(listener));
    listener.once('error',reject);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    title:'Draftdrion', width:1440, height:960, minWidth:720, minHeight:540,
    backgroundColor:'#151719', show:false,
    webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true},
  });
  const session = window.webContents.session;
  session.setPermissionCheckHandler((contents,permission) => contents?.getURL().startsWith(origin+'/') && ['clipboard-sanitized-write','fullscreen'].includes(permission));
  session.setPermissionRequestHandler((contents,permission,callback) => callback(contents.getURL().startsWith(origin+'/') && ['clipboard-sanitized-write','fullscreen'].includes(permission)));
  session.webRequest.onHeadersReceived({urls:[origin+'/*']}, (details,callback) => {
    const headers = {...details.responseHeaders};
    if (details.resourceType === 'mainFrame') headers['Content-Security-Policy'] = ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"];
    callback({responseHeaders:headers});
  });
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  window.webContents.on('will-navigate', (event,url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, {
      type:'question', title:'Close Draftdrion?', message:'You have unsaved edits or a save is still in progress.',
      detail:'Stay to save your work, or close the window anyway.', buttons:['Stay','Close anyway'], defaultId:0, cancelId:0,
    });
    if (choice === 1) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => { window = null; });
  await window.loadURL(origin);
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { server?.closeAllConnections(); server?.close(); });

}
