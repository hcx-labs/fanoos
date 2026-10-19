import { send, evaluate, close } from './cdp.mjs';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const check = async (expression) => evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function tick(){if(${expression})return resolve(true);if(performance.now()-start>15000)return reject(Error('Timed out: '+location.href));requestAnimationFrame(tick)}tick()})`);
console.log('page', await evaluate('location.href'));
await evaluate(`document.querySelector('a[href="/watch/youtube/v5"]').click()`);
await check(`document.querySelector('video')`);
console.log('watch', await evaluate(`({url:location.href,video:!!document.querySelector('video'),rows:document.querySelectorAll('article').length})`));
const ticks = await evaluate(`new Promise(resolve=>{const v=document.querySelector('video');const root=v[Object.keys(v).find(k=>k.startsWith('__reactFiber$'))];let f=root;while(f&&f.type?.name!=='WatchPage')f=f.return;const state=f.memoizedState;const add=window.addEventListener;let keyboardSubscriptions=0;window.addEventListener=function(type,...args){if(type==='keydown')keyboardSubscriptions++;return add.call(this,type,...args)};let i=0;function tick(){Object.defineProperty(v,'currentTime',{configurable:true,value:++i*3});v.dispatchEvent(new Event('timeupdate'));if(i<40)requestAnimationFrame(tick);else requestAnimationFrame(()=>{let n=v[Object.keys(v).find(k=>k.startsWith('__reactFiber$'))];while(n&&n.type?.name!=='WatchPage')n=n.return;window.addEventListener=add;resolve({events:i,parentStateUnchanged:n.memoizedState===state,keyboardSubscriptions});});}tick()})`);
assert.equal(ticks.parentStateUnchanged, true);
assert.equal(ticks.keyboardSubscriptions, 0);
console.log('ticks', ticks);
await evaluate(`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Chapters').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`);
await check(`document.querySelector('[role="tabpanel"] [aria-current="true"]')`);
const chapter = await evaluate(`document.querySelector('[role="tabpanel"] [aria-current="true"]').textContent`);
assert.match(chapter, /Middle/);
console.log('chapter', chapter);
for (const route of ['/library', '/following', '/calendar', '/analytics', '/settings', '/']) {
    await evaluate(`document.querySelector('a[href="${route}"]').click()`);
    await check(`location.pathname==='${route}' && !document.querySelector('video') && document.querySelector('h1')?.textContent.includes('${route === '/' ? 'Perf' : route.slice(1, 2).toUpperCase() + route.slice(2)}')`);
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    console.log('navigation', route, await evaluate(`({heading:document.querySelector('h1')?.textContent,video:!!document.querySelector('video')})`));
}
// Exercise the actual command palette rather than assigning a route directly.
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))`);
await check(`document.querySelector('[role="combobox"]')`);
await send('Input.insertText', {text:'performance'});
await check(`document.querySelector('[cmdk-item][data-value="search:performance"]')`);
await evaluate(`document.querySelector('[cmdk-item][data-value="search:performance"]').click()`);
await check(`location.pathname==='/search' && document.querySelectorAll('article').length===100`);
console.log('search', await evaluate(`({rows:document.querySelectorAll('article').length})`));
await evaluate(`document.querySelector('a[href="/channel/youtube/c0"]').click()`);
await check(`location.pathname==='/channel/youtube/c0' && document.querySelector('h1')?.textContent==='Channel 0' && document.querySelectorAll('article').length===100`);
console.log('channel', await evaluate(`({cards:document.querySelectorAll('article').length})`));
await evaluate(`document.querySelector('a[href="/"]').click()`);
await check(`location.pathname==='/' && document.querySelectorAll('article').length>0`);
for (const width of [320, 375, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    const navigation = await evaluate(`(() => {
      const bar = [...document.querySelectorAll('nav[aria-label="Primary"]')].find(el => getComputedStyle(el).position === 'fixed');
      const items = [...bar.children].map(el => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right }; });
      return { rows: new Set(items.map(r => Math.round(r.top))).size, count: items.length, fits: items.every(r => r.left >= 0 && r.right <= innerWidth) };
    })()`);
    assert.equal(navigation.rows, 1);
    assert.equal(navigation.count, 6);
    assert.ok(navigation.fits);
    console.log('mobile navigation', width, navigation);
}
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
const mobile = await evaluate(`({viewport:innerWidth,body:document.body.scrollWidth})`);
assert.ok(mobile.body <= mobile.viewport);
console.log('mobile', mobile);
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('/tmp/tube-performance-mobile.png', Buffer.from(shot.data, 'base64'));
close();
