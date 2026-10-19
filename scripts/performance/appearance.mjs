// Browser-local appearance fixtures. Run with the same Chrome/Vite setup as run.mjs.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { send, evaluate, on, close } from "./cdp.mjs";

const waitFor = (condition) => evaluate(`new Promise((resolve, reject) => {
  const start = performance.now();
  function check() {
    if (${condition}) return resolve(true);
    if (performance.now() - start > 10000) return reject(Error('Appearance check timed out'));
    requestAnimationFrame(check);
  }
  check();
})`);
await send("Page.enable");
const fixture = readFileSync(new URL("./fixture.js", import.meta.url), "utf8");
await send("Page.addScriptToEvaluateOnNewDocument", { source: fixture + `
(() => {
  const solid = (color) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><path fill="'+color+'" d="M0 0h640v360H0z"/></svg>');
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    const path = new URL(input, location.href).pathname;
    if (path === '/api/auth/me') {
      const data = await response.json();
      data.backends[0].info.name = 'Crunchyroll';
      data.backends[0].info.private = false;
      return Response.json(data);
    }
    if (/\\/channels\\/c[0-4]$/.test(path)) {
      const data = await response.json();
      const id = path.split('/').at(-1);
      if (id === 'c1' && window.__holdArtwork) await new Promise(resolve => { window.__releaseArtwork = resolve; });
      Object.assign(data.channel, {id, name:'Channel '+id.slice(1), avatar:solid('#2060c0')});
      if (id === 'c0') data.channel.banner = solid('#8050c0');
      if (id === 'c2') Object.assign(data.channel, {kind:'series', poster:solid('#c09020'), banner:solid('#208040')});
      if (id === 'c3') data.channel.banner = 'data:image/png;base64,broken';
      if (id === 'c4') delete data.channel.avatar;
      return Response.json(data);
    }
    return response;
  };
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const loaded = new Promise((resolve) => on("Page.loadEventFired", resolve));
await send("Page.navigate", { url: process.env.PERF_URL || "http://127.0.0.1:5190/" });
await loaded;
await waitFor(`document.querySelector('a[href="/channel/youtube/c0"]')`);
for (const [id, expected] of [["c0", "rgb(128 80 192)"], ["c1", "rgb(32 96 192)"], ["c2", "rgb(192 144 32)"], ["c3", "rgb(32 96 192)"], ["c4", ""]]) {
  await evaluate(`document.querySelector('a[href="/channel/youtube/${id}"]').click()`);
  await waitFor(`document.querySelector('h1')?.textContent === 'Channel ${id.slice(1)}' && document.querySelector('.page-glow').style.getPropertyValue('--page-glow-primary') === '${expected}'`);
  console.log("artwork glow", id, expected || "default");
}
await evaluate(`document.querySelector('a[href="/channel/youtube/c0"]').click()`);
await waitFor(`document.querySelector('.page-glow').style.getPropertyValue('--page-glow-primary') === 'rgb(128 80 192)'`);
await waitFor(`document.querySelector('.page-glow').getAnimations().every(animation => animation.playState === 'finished')`);
const oldPalette = await evaluate(`getComputedStyle(document.querySelector('.page-glow')).getPropertyValue('--page-glow-primary')`);
await evaluate(`window.__holdArtwork = true; document.querySelector('a[href="/channel/youtube/c1"]').click()`);
await waitFor(`typeof window.__releaseArtwork === 'function'`);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('.page-glow')).getPropertyValue('--page-glow-primary')`), oldPalette);
await evaluate(`window.__releaseArtwork()`);
await waitFor(`document.querySelector('.page-glow').style.getPropertyValue('--page-glow-primary') === 'rgb(32 96 192)'`);
const fade = await evaluate(`new Promise(resolve => {
  const glow = document.querySelector('.page-glow');
  const samples = new Set();
  function sample() {
    samples.add(getComputedStyle(glow).getPropertyValue('--page-glow-primary'));
    if (glow.getAnimations().some(animation => animation.playState === 'running')) requestAnimationFrame(sample);
    else resolve({ colors: samples.size, strength: Number(getComputedStyle(glow).getPropertyValue('--page-glow-strength')) });
  }
  requestAnimationFrame(sample);
})`);
assert.ok(fade.colors > 3);
assert.equal(fade.strength, 2.3);
console.log('artwork holds previous palette during loading, then fades', fade);
for (const width of [1440, 390, 320]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
  await evaluate(`document.querySelector('[aria-label="Privacy status"]').click()`);
  await waitFor(`document.querySelector('[data-slot="popover-content"]')?.getBoundingClientRect().width > 0`);
  await waitFor(`document.querySelector('[data-slot="popover-content"]').getAnimations().every(animation => animation.playState === 'finished')`);
  const result = await evaluate(`(() => {
    const panel = document.querySelector('[data-slot="popover-content"]');
    const bounds = panel.getBoundingClientRect();
    const value = [...panel.querySelectorAll('li span')].find(el => el.textContent === 'Sees what you watch there');
    return { width:bounds.width, fits:bounds.left >= 0 && bounds.right <= innerWidth, ellipsis:getComputedStyle(value).textOverflow, textFits:value.scrollWidth <= value.clientWidth };
  })()`);
  assert.ok(result.fits);
  assert.ok(result.textFits);
  assert.notEqual(result.ellipsis, "ellipsis");
  if (width === 1440) assert.equal(result.width, 416);
  console.log("privacy popover", width, result);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`/tmp/tube-appearance-${width}.png`, Buffer.from(shot.data, "base64"));
  await evaluate(`document.querySelector('[aria-label="Privacy status"]').click()`);
  await waitFor(`!document.querySelector('[data-slot="popover-content"]')`);
}
await evaluate(`document.querySelector('a[href="/"]').click()`);
await waitFor(`location.pathname === '/' && document.querySelector('.page-glow').style.getPropertyValue('--page-glow-primary') === ''`);
console.log("navigation resets glow");
close();
