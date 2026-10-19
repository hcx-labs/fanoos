import { send, evaluate, close, on } from './cdp.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL('./fixture.js', import.meta.url), 'utf8') });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const loaded = new Promise(r => on('Page.loadEventFired', r));
await send('Page.navigate', { url: process.env.PERF_URL || 'http://127.0.0.1:5190/' });
await loaded;
await evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(document.querySelectorAll('article').length>0)return resolve(true);if(performance.now()-start>15000)return reject(Error(document.body.innerText));requestAnimationFrame(check);}check();})`);
await evaluate(`document.querySelector('[aria-label="Show videos from"] [aria-pressed="true"]')?.click()`);
await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
await send('Performance.enable');
const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const before = await metrics();
const result = await evaluate(`new Promise(resolve=>{const frames=[],long=[];const observer=new PerformanceObserver(l=>long.push(...l.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});let start,last;function tick(now){start??=now;last??=now;frames.push(now-last);last=now;const elapsed=now-start;window.scrollTo(0,Math.min(18000,elapsed*4));if(elapsed<6000)requestAnimationFrame(tick);else{observer.disconnect();frames.sort((a,b)=>a-b);resolve({url:location.href,cards:document.querySelectorAll('article').length,nodes:document.querySelectorAll('*').length,frames:frames.length,p95:frames[Math.floor(frames.length*.95)],max:frames.at(-1),longTasks:long,scrollY});}}requestAnimationFrame(tick);})`);
const after = await metrics();
result.cpu = {};
for (const k of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'])
    result.cpu[k] = after[k] - before[k];
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(process.env.PERF_SCREENSHOT || '/tmp/tube-performance.png', Buffer.from(shot.data, 'base64'));
console.log(JSON.stringify(result, null, 2));
const idle = await evaluate(`new Promise(resolve=>{const hero=document.querySelector('[aria-roledescription="carousel"]');let changes=0;const observer=new MutationObserver(()=>changes++);observer.observe(hero,{subtree:true,childList:true,attributes:true,characterData:true});let start;function sample(now){start??=now;if(now-start<8000)requestAnimationFrame(sample);else{observer.disconnect();resolve({offscreenHeroMutations:changes});}}requestAnimationFrame(sample);})`);
if (idle.offscreenHeroMutations !== 0)
    throw Error('Offscreen hero is still updating');
console.log('idle', idle);
await import('./navigation.mjs');
