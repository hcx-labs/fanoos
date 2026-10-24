const { contextBridge, ipcRenderer } = require('electron');
const origin = location.protocol === 'file:' ? '' : ipcRenderer.sendSync('desktop:origin');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('fanoosSetup', { connect: (url) => ipcRenderer.invoke('desktop:server', url) });
} else if (process.isMainFrame && ((origin && location.origin === origin) || (location.protocol === 'fanoos-offline:' && location.hostname === 'app'))) {
  contextBridge.exposeInMainWorld('fanoosDesktop', {
    platform: process.platform,
    readyForProtectedPlayback: () => ipcRenderer.invoke('desktop:widevine'),
    offline: location.protocol === 'fanoos-offline:',
    downloads: {
      // Services this build can save; pages check before offering Download.
      backends: ['youtube', 'plex'],
      // How this build saves media: separate tracks, whole files, and server conversions as segments.
      formats: ['tracks', 'file', 'segments'],
      ...Object.fromEntries(['connect', 'list', 'plan', 'add', 'pause', 'resume', 'pauseAll', 'resumeAll', 'remove', 'detail', 'state', 'play', 'open', 'reconnect', 'disconnect'].map((method) => [method, (value) => ipcRenderer.invoke(`downloads:${method}`, value)])),
      saveState: (data) => ipcRenderer.send('downloads:state-save', data),
      subscribe: (listener) => { const handler = () => listener(); ipcRenderer.on('downloads:changed', handler); return () => ipcRenderer.removeListener('downloads:changed', handler); },
      onCompleted: (listener) => { const handler = (_event, item) => listener({ id: String(item.id), title: String(item.title) }); ipcRenderer.on('downloads:completed', handler); return () => ipcRenderer.removeListener('downloads:completed', handler); },
    },
    setTheme: (theme) => ipcRenderer.send('desktop:theme', theme),
  });
  window.addEventListener('DOMContentLoaded', () => {
    document.documentElement.dataset.desktop = process.platform;
  });
  ipcRenderer.on('desktop:search', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
}
