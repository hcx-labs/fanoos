const { app, BrowserWindow, Menu, Notification, ipcMain, nativeTheme, shell, dialog, components, screen, protocol, session } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
if (process.env.FANOOS_DESKTOP_DATA_DIR) {
  require('node:fs').mkdirSync(process.env.FANOOS_DESKTOP_DATA_DIR, { recursive: true });
  app.setPath('userData', path.resolve(process.env.FANOOS_DESKTOP_DATA_DIR));
}
const { Downloads, serveFile } = require('./downloads.cjs');
const { pathToFileURL } = require('node:url');
protocol.registerSchemesAsPrivileged([{ scheme: 'fanoos-offline', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const offlineURL = 'fanoos-offline://app/offline.html';
let downloads;
let widevineReady;
function ensureWidevine() {
  if (!widevineReady) widevineReady = components.whenReady([components.WIDEVINE_CDM_ID]).catch((error) => { widevineReady = null; throw new Error(`Widevine could not initialize: ${error.message}. Check your connection and restart Fanoos.`); });
  return widevineReady;
}
let win;
let navigation = 0;
let config = {};
const setupURL = pathToFileURL(path.join(__dirname, 'setup.html')).href;
const configPath = () => path.join(app.getPath('userData'), 'desktop.json');
function save() { writeFileSync(configPath(), JSON.stringify(config)); }
function serverURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS, or HTTP on localhost for development.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter the server origin only, for example https://fanoos.example.com.');
  return url.origin;
}
function trusted(event) {
  return event.sender === win?.webContents && event.senderFrame === win.webContents.mainFrame;
}
function isServer(url) {
  try { return new URL(url).origin === config.server; } catch { return false; }
}
function external(url) {
  try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch {}
}
async function loadServer() {
  const attempt = ++navigation;
  try {
    const health = await session.defaultSession.fetch(`${config.server}/api/health`, { signal: AbortSignal.timeout(4000), redirect: 'error' });
    if (!health.ok) throw new Error('Server unavailable');
    if (attempt !== navigation || !win || win.isDestroyed()) return false;
    await win.loadURL(config.server);
    return true;
  } catch (error) {
    if (attempt !== navigation || error.code === 'ERR_ABORTED' || error.errno === -3) return false;
    if (win && !win.isDestroyed()) await win.loadURL(`${offlineURL}#/downloads`).catch((e) => console.warn('Offline library could not open:', e.message));
    return false;
  }
}
function openDownloads(id) { navigation++; return win?.loadURL(`${offlineURL}#${id ? `/watch/${id}` : '/downloads'}`); }
function offlineFrame(event) { return event.senderFrame?.url.startsWith(offlineURL); }
function appLoaded() { const url = win && !win.isDestroyed() ? win.webContents.getURL() : ''; return isServer(url) || url.startsWith(offlineURL); }
/** Dock/taskbar progress across the active profile's unfinished downloads. */
function showProgress() {
  if (!win || win.isDestroyed()) return;
  let received = 0, total = 0, running = false;
  for (const item of downloads.context ? downloads.list().items : []) {
    if (!['queued', 'downloading'].includes(item.status)) continue;
    received += item.received; total += item.total; running ||= item.status === 'downloading';
  }
  win.setProgressBar(total ? Math.min(1, received / total) : -1, { mode: running ? 'normal' : 'paused' });
}
function downloadCompleted(item) {
  if (appLoaded()) win.webContents.send('downloads:completed', { id: item.id, title: item.video.title });
  if (win?.isFocused() || !Notification.isSupported()) return;
  const note = new Notification({ title: 'Download complete', body: `“${item.video.title}” is ready to watch offline.`, silent: true });
  note.on('click', () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
  note.show();
}
function checkDownloads(event, onlineOnly = false) {
  if (!trusted(event) || (!isServer(event.senderFrame.url) && !(offlineFrame(event) && !onlineOnly))) throw new Error('Unavailable');
  if (downloads.context && downloads.context.server !== config.server) throw new Error('Reconnect to your server first.');
}
function createWindow() {
  const bounds = config.bounds;
  const visible = bounds && screen.getAllDisplays().some(({ workArea: a }) => bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y);
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 800, minHeight: 600,
    ...(visible ? bounds : {}),
    title: 'Fanoos', backgroundColor: '#141414',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 25 }, vibrancy: 'sidebar' } : {}),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { height: 64 }, backgroundMaterial: 'mica' } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // HTTP(S) redirects stay in this sandbox for OIDC. Only the selected origin gets IPC access.
  win.webContents.on('will-navigate', (event, url) => {
    if (!['https:', 'http:'].includes(new URL(url).protocol)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('close', () => { if (!win.isMaximized() && !win.isFullScreen()) config.bounds = win.getBounds(); save(); });
  win.on('closed', () => { win = null; });
  if (config.server) loadServer(); else void win.loadURL(setupURL);
}
ipcMain.on('desktop:origin', (event) => {
  event.returnValue = trusted(event) && isServer(event.senderFrame.url) ? config.server : '';
});
ipcMain.handle('desktop:widevine', async (event) => {
  if (!trusted(event) || !isServer(event.senderFrame.url)) throw new Error('Unavailable');
  await ensureWidevine();
});
ipcMain.handle('desktop:server', async (event, value) => {
  if (!trusted(event) || event.senderFrame.url !== setupURL) throw new Error('Unavailable');
  const server = serverURL(value);
  await downloads.lock();
  config.server = server; save();
  await loadServer();
});
ipcMain.on('desktop:theme', (event, theme) => {
  if (!trusted(event) || (!isServer(event.senderFrame.url) && !offlineFrame(event)) || !['dark', 'light', 'system'].includes(theme)) return;
  nativeTheme.themeSource = theme;
  if (process.platform === 'win32') win.setTitleBarOverlay({ color: nativeTheme.shouldUseDarkColors ? '#141414' : '#fafafa', symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#141414' });
});
ipcMain.handle('downloads:connect', async (event) => {
  checkDownloads(event, true);
  const server = config.server;
  const me = await downloads.json(server, '/api/auth/me');
  if (config.server !== server || !trusted(event) || !isServer(event.senderFrame.url)) throw new Error('Server changed.');
  downloads.bind(server, me.profile);
});
for (const [method, work] of Object.entries({
  list: () => downloads.list(),
  plan: (target) => downloads.plan(target),
  add: (selection) => downloads.add(selection),
  pause: (id) => downloads.pause(id),
  resume: (id) => downloads.resume(id),
  pauseAll: () => downloads.pauseAll(),
  resumeAll: () => downloads.resumeAll(),
  remove: (id) => downloads.remove(id),
  detail: (id) => downloads.detail(id),
  state: () => downloads.readState(),
  play: (id) => { downloads.detail(id); return openDownloads(id); },
  open: () => openDownloads(),
  reconnect: () => loadServer(),
})) {
  ipcMain.handle(`downloads:${method}`, (event, value) => {
    checkDownloads(event, ['plan', 'add', 'resume', 'resumeAll'].includes(method));
    return work(value);
  });
}
ipcMain.on('downloads:state-save', (event, data) => {
  try { checkDownloads(event); downloads.writeState(data, offlineFrame(event)); } catch { /* The profile may have signed out as the page closed. */ }
});
ipcMain.handle('downloads:disconnect', async (event) => {
  checkDownloads(event, true);
  const hasDownloads = downloads.list().items.length > 0;
  const choice = hasDownloads ? await dialog.showMessageBox(win, { type: 'question', message: 'Remove this profile’s downloads from this device?', detail: 'Keeping them lets this profile access them after signing in again.', buttons: ['Keep Downloads', 'Remove Downloads'], defaultId: 0, cancelId: 0 }) : { response: 0 };
  await downloads.lock(choice.response === 1);
});

app.whenReady().then(async () => {
  try { config = JSON.parse(readFileSync(configPath(), 'utf8')); if (config.server) config.server = serverURL(config.server); } catch { config = {}; }
  downloads = new Downloads({ directory: app.getPath('userData'), fetch: (url, init) => session.defaultSession.fetch(url, init), completed: downloadCompleted, notify: () => {
    if (appLoaded()) win.webContents.send('downloads:changed');
    if (downloads) showProgress();
  } });
  if (downloads.context?.server !== config.server) await downloads.lock();
  protocol.handle('fanoos-offline', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 403 });
      const media = /^\/media\/([a-f0-9]{32})\/([a-z0-9.-]+)$/.exec(url.pathname);
      if (media) return await downloads.media(media[1], media[2], request);
      const root = path.join(__dirname, 'offline-dist');
      const filename = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!filename.startsWith(`${root}${path.sep}`)) return new Response(null, { status: 403 });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
      return await serveFile(filename, type, request, { 'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self' blob:; media-src 'self' blob:; connect-src 'self'" });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Downloads', accelerator: 'CmdOrCtrl+J', click: () => openDownloads() },
      { label: 'Reconnect to Server', click: () => config.server && loadServer() },
      { label: 'Change Server…', click: () => win && win.loadURL(setupURL) },
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => win?.webContents.getURL().startsWith(offlineURL) ? win.loadURL(`${offlineURL}#/settings`) : config.server && win?.loadURL(`${config.server}/settings`) },
      { label: 'Search', accelerator: 'CmdOrCtrl+K', click: () => { if (isServer(win?.webContents.getURL()) || win?.webContents.getURL().startsWith(offlineURL)) win.webContents.send('desktop:search'); } },
      { role: 'close' },
    ] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  // YouTube and the offline library must remain usable without a CDM download.
  void ensureWidevine().catch((error) => console.warn('Widevine unavailable:', error.message));
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
}).catch((error) => { dialog.showErrorBox('Fanoos could not start', error.message); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', () => downloads?.shutdown());
