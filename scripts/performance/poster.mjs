import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { send, evaluate, on, close } from "./cdp.mjs";
const waitFor = condition => evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(${condition})return resolve();if(performance.now()-start>10000)return reject(Error('Poster check timed out'));requestAnimationFrame(check)}check()})`);
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(new URL("./fixture.js", import.meta.url), "utf8") + `
(() => {
 const original=window.fetch;
 const poster='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><path fill="black" d="M0 0h480v360H0z"/><path fill="#d88c46" d="M0 45h480v270H0z"/></svg>');
 window.fetch=async(input,init)=>{
   const response=await original(input,init);
   if(new URL(input,location.href).pathname.startsWith('/api/v/youtube/videos/')) {
     const page=await response.json();page.video.thumbnail=poster;
     // A nonempty source keeps the unavailable-stream overlay out of this poster-only test.
     // No real media is played; the synthetic play event below only tests the styling switch.
     page.stream={progressive:'data:video/mp4;base64,'};return Response.json(page);
   }
   return response;
 };
})();` });
await send("Emulation.setDeviceMetricsOverride", {width:1440,height:900,deviceScaleFactor:1,mobile:false});
const loaded=new Promise(resolve=>on("Page.loadEventFired",resolve));
await send("Page.navigate",{url:process.env.PERF_URL||"http://127.0.0.1:5190/"});
await loaded;
await waitFor(`document.querySelector('a[href="/watch/youtube/v0"]')`);
await evaluate(`document.querySelector('a[href="/watch/youtube/v0"]').click()`);
await waitFor(`document.querySelector('video')`);
await evaluate(`(async()=>{const image=new Image();image.src=document.querySelector('video').poster;await image.decode();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()`);
assert.equal(await evaluate(`getComputedStyle(document.querySelector('video')).objectFit`),"cover");
const clip=await evaluate(`(()=>{const r=document.querySelector('video').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
const shot=await send("Page.captureScreenshot",{format:"png",clip});
writeFileSync('/tmp/tube-poster.png',Buffer.from(shot.data,'base64'));
await evaluate(`document.querySelector('video').dispatchEvent(new Event('play'))`);
await waitFor(`getComputedStyle(document.querySelector('video')).objectFit==='contain'`);
console.log('letterboxed fallback poster fills the player; playback switches to uncropped contain');
close();
