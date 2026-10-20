const { contextBridge, ipcRenderer } = require('electron');
const origin = location.protocol === 'file:' ? '' : ipcRenderer.sendSync('desktop:origin');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('fanoosSetup', { connect: (url) => ipcRenderer.invoke('desktop:server', url) });
} else if (process.isMainFrame && ((origin && location.origin === origin) || (location.protocol === 'fanoos-offline:' && location.hostname === 'app'))) {
  contextBridge.exposeInMainWorld('fanoosDesktop', {
    platform: process.platform,
    offline: location.protocol === 'fanoos-offline:',
    downloads: {
      ...Object.fromEntries(['connect', 'list', 'plan', 'add', 'pause', 'resume', 'remove', 'detail', 'state', 'play', 'open', 'reconnect', 'disconnect'].map((method) => [method, (value) => ipcRenderer.invoke(`downloads:${method}`, value)])),
      saveState: (data) => ipcRenderer.send('downloads:state-save', data),
      subscribe: (listener) => { const handler = () => listener(); ipcRenderer.on('downloads:changed', handler); return () => ipcRenderer.removeListener('downloads:changed', handler); },
    },
    setTheme: (theme) => ipcRenderer.send('desktop:theme', theme),
  });
  window.addEventListener('DOMContentLoaded', () => {
    document.documentElement.dataset.desktop = process.platform;
  });
  ipcRenderer.on('desktop:search', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })));
}
