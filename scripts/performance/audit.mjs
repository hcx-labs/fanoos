import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { send, evaluate, on, close } from "./cdp.mjs";
const waitFor = condition => evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(${condition})return resolve();if(performance.now()-start>12000)return reject(Error('Audit check timed out: '+location.href));requestAnimationFrame(check)}check()})`);
const goHome = async () => {
  await evaluate(`document.querySelector('a[href="/"]').click()`);
  await waitFor(`location.pathname==='/' && document.querySelector('h1')?.textContent.includes('Perf')`);
};
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(new URL("./fixture.js", import.meta.url), "utf8") + `
(() => {
 const original=window.fetch;
 let failSeason=true;
 window.fetch=async(input,init)=>{
   const url=new URL(input,location.href);
   const response=await original(input,init);
   if(url.pathname==='/api/me/data')return Response.json({data:{settings:{ambient:false}}});
   if(url.pathname==='/api/v/youtube/channels/c0') {
     const page=await response.json();
     const section=url.searchParams.get('section')||'s1';
     if(section==='s2'&&failSeason){failSeason=false;return Response.json({error:'Season temporarily unavailable'},{status:502});}
     page.channel.kind='series';
     page.sections=[{id:'s1',label:'Season one'},{id:'s2',label:'Season two'}];page.section=section;
     page.videos=[{...page.videos[0],title:section==='s1'?'Season one episode':'Season two episode'}];
     return Response.json(page);
   }
   if(url.pathname==='/api/v/youtube/channels/c1') {
     const page=await response.json();Object.assign(page.channel,{id:'c1',name:'Channel 1',banner:'/artwork-retry.svg'});return Response.json(page);
   }
   if(/\\/videos\\/v[01]$/.test(url.pathname)) {
     const page=await response.json();const dub=url.pathname.endsWith('/v1');
     page.video.episode={seriesId:'same-series',seriesTitle:'Audit show',season:1,number:'1',audio:dub?'en-US':'ja-JP',versions:[{id:'v0',audio:'ja-JP',original:true},{id:'v1',audio:'en-US'}]};
     if(dub)page.video.chapters=[{start:0,title:'Dub intro'},{start:50,title:'Dub middle'},{start:110,title:'Dub ending'}];
     return Response.json(page);
   }
   return response;
 };
})();` });
let failArtwork = true;
let blockWatch = true;
on("Fetch.requestPaused", async event => {
  if (event.request.url.includes("artwork-retry.svg")) {
    if (failArtwork) await send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
    else await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200, responseHeaders: [{name:"content-type",value:"image/svg+xml"}], body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><path fill="rgb(20,160,80)" d="M0 0h64v32H0z"/></svg>').toString("base64") });
  } else if (blockWatch && event.request.url.includes("/src/pages/watch.tsx")) {
    await send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
  } else await send("Fetch.continueRequest", { requestId: event.requestId });
});
await send("Fetch.enable", { patterns: [{urlPattern:"*artwork-retry.svg*"},{urlPattern:"*/src/pages/watch.tsx*"}] });
await send("Emulation.setDeviceMetricsOverride", {width:1440,height:900,deviceScaleFactor:1,mobile:false});
let loaded=new Promise(resolve=>on("Page.loadEventFired",resolve));
await send("Page.navigate",{url:process.env.PERF_URL||"http://127.0.0.1:5190/"});
await loaded;
await waitFor(`document.querySelector('a[href="/channel/youtube/c0"]')`);
await evaluate(`document.querySelector('a[href="/channel/youtube/c0"]').click()`);
await waitFor(`document.querySelector('[aria-label="Seasons"]')`);
await evaluate(`[...document.querySelectorAll('[aria-label="Seasons"] button')].find(el=>el.textContent==='Season two').click()`);
await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Season temporarily unavailable')`);
assert.ok(await evaluate(`document.body.textContent.includes('Season one episode')`));
await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent==='Try again').click()`);
await waitFor(`document.body.textContent.includes('Season two episode') && !document.querySelector('[role="alert"]')`);
console.log("failed season switch displays error, preserves prior season, and retries successfully");
await evaluate(`document.querySelector('a[href="/channel/youtube/c1"]').click()`);
await waitFor(`document.querySelector('h1')?.textContent==='Channel 1' && document.querySelector('.page-glow').style.getPropertyValue('--page-glow-primary')!==''`);
assert.ok(!await evaluate(`document.querySelector('[aria-label="Seasons"]')!==null`));
await waitFor(`[...document.images].some(image=>image.src.endsWith('/artwork-retry.svg') && image.complete && image.naturalWidth===0)`);
await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
failArtwork=false;
await goHome();
await evaluate(`document.querySelector('a[href="/channel/youtube/c1"]').click()`);
await waitFor(`document.querySelector('.page-glow').style.getPropertyValue('--page-glow-primary')==='rgb(20 160 80)'`);
console.log("failed artwork is retried on revisit after connectivity recovers");
await goHome();
await evaluate(`document.querySelector('a[href="/watch/youtube/v0"]').click()`);
await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes("Couldn't open the player")`);
assert.ok(await evaluate(`document.querySelector('a[href="/library"]')!==null`));
await goHome();
blockWatch=false;
loaded=new Promise(resolve=>on("Page.loadEventFired",resolve));
await send("Page.reload");await loaded;
await waitFor(`document.querySelector('a[href="/watch/youtube/v0"]')`);
await evaluate(`document.querySelector('a[href="/watch/youtube/v0"]').click()`);
await waitFor(`document.querySelector('video') && document.querySelector('a[href="/watch/youtube/v1"]')`);
console.log("failed player chunk has recovery UI; navigation and fresh reload recover");
await evaluate(`{const video=document.querySelector('video');window.__originalVideo=video;Object.defineProperty(video,'currentTime',{configurable:true,value:120});video.dispatchEvent(new Event('timeupdate'));}`);
await evaluate(`[...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='Chapters').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`);
await waitFor(`document.querySelector('[role="tabpanel"] [aria-current="true"]')?.textContent.includes('Middle')`);
assert.ok(await evaluate(`document.querySelector('video').paused`));
await evaluate(`[...document.querySelectorAll('a[href="/watch/youtube/v1"]')].find(el=>el.textContent.includes('English')).click()`);
await waitFor(`location.pathname==='/watch/youtube/v1' && document.querySelector('[role="tabpanel"] [aria-current="true"]')?.textContent.includes('Dub ending')`);
assert.ok(await evaluate(`document.querySelector('video')===window.__originalVideo`));
console.log("paused language switch preserves player, Chapters tab, and chapter time without another tick");
await send("Fetch.disable");
close();
