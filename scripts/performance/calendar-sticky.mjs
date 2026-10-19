import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { send, evaluate, on, close } from "./cdp.mjs";
const waitFor = condition => evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(${condition})return resolve();if(performance.now()-start>12000)return reject(Error('Calendar check timed out'));requestAnimationFrame(check)}check()})`);
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(new URL("./fixture.js", import.meta.url), "utf8") + `
(() => {
 const original=window.fetch;
 window.fetch=async(input,init)=>{
   const url=new URL(input,location.href);
   if(url.pathname!=='/api/calendar')return original(input,init);
   const all=await (await original('/api/feed')).json();
   const day=new Date(url.searchParams.get('to'));day.setDate(day.getDate()-6);
   return Response.json(Array.from({length:32},(_,index)=>{
     const at=new Date(day);at.setHours(index<16?20:21,index%16,0,0);
     return {...all[index],published:at.toISOString()};
   }));
 };
})();` });
await send("Emulation.setDeviceMetricsOverride", {width:1440,height:900,deviceScaleFactor:1,mobile:false});
const loaded=new Promise(resolve=>on("Page.loadEventFired",resolve));
await send("Page.navigate",{url:process.env.PERF_URL||"http://127.0.0.1:5190/"});
await loaded;
await waitFor(`document.querySelector('a[href="/calendar"]')`);
await evaluate(`document.querySelector('a[href="/calendar"]').click()`);
await waitFor(`[...document.querySelectorAll('button')].some(el=>el.textContent==='Week')`);
await evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent==='Week').click()`);
await waitFor(`document.querySelector('[data-hour="20"] a')`);
const measure = (hour, amount, horizontal = 0) => evaluate(`(async()=>{
 const scroller=document.querySelector('[data-week-scroller]');
 const header=document.querySelector('[data-week-header]');
 const row=document.querySelector('[data-hour="${hour}"]');
 scroller.scrollTop=row.offsetTop-header.offsetHeight+${amount};scroller.scrollLeft=${horizontal};
 await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const box=scroller.getBoundingClientRect();const label=row.querySelector('[data-hour-label]').getBoundingClientRect();const head=header.getBoundingClientRect();
 return {hour:${hour},labelTop:label.top,labelLeft:label.left,headerBottom:head.bottom,headerTop:head.top,scrollerTop:box.top+scroller.clientTop,scrollerLeft:box.left+scroller.clientLeft,scrollLeft:scroller.scrollLeft};
})()`);
for(const amount of [150,400]) {
 const result=await measure(20,amount);
 assert.ok(Math.abs(result.labelTop-result.headerBottom)<2,JSON.stringify(result));
 assert.ok(Math.abs(result.headerTop-result.scrollerTop)<2,JSON.stringify(result));
 console.log('sticky hour label',result);
}
const next=await measure(21,150);
assert.ok(Math.abs(next.labelTop-next.headerBottom)<2);
assert.ok(await evaluate(`document.querySelector('[data-hour="20"] [data-hour-label]').getBoundingClientRect().bottom <= document.querySelector('[data-week-header]').getBoundingClientRect().bottom+1`));
console.log('next hour replaces the previous sticky label');
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
const mobile=await measure(20,250,300);
assert.ok(mobile.scrollLeft>0);
assert.ok(Math.abs(mobile.labelLeft-mobile.scrollerLeft)<2,JSON.stringify(mobile));
assert.ok(Math.abs(mobile.labelTop-mobile.headerBottom)<2,JSON.stringify(mobile));
assert.ok(await evaluate(`document.body.scrollWidth<=innerWidth`));
console.log('mobile horizontal and vertical sticky labels',mobile);
const shot=await send("Page.captureScreenshot",{format:"png"});
writeFileSync('/tmp/tube-calendar-sticky.png',Buffer.from(shot.data,'base64'));
close();
