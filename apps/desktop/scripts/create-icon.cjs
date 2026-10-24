// Run with Electron to render the existing vector brand as a macOS app icon.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
app.whenReady().then(async () => {
  const output = path.join(__dirname, '../build');
  const logo = fs.readFileSync(path.join(__dirname, '../../../docs/assets/logo-dark.svg'), 'utf8');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#29241f"/><stop offset="1" stop-color="#141210"/></linearGradient></defs><rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/><svg x="176" y="156" width="672" height="712" viewBox="4 3 24 26">${logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg></svg>`;
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'icon.svg'), svg);
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`));
  const image = await win.webContents.capturePage();
  const iconset = path.join(output, 'icon.iconset');
  fs.mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      fs.writeFileSync(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), image.resize({ width: size * scale, height: size * scale }).toPNG());
    }
  }
  fs.writeFileSync(path.join(output, 'icon.png'), image.toPNG());
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(output, 'icon.icns')]);
  fs.rmSync(iconset, { recursive: true });
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
