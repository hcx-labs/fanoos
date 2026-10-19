import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { send, evaluate, on, close } from "./cdp.mjs";

const waitFor = (condition) => evaluate(`new Promise((resolve,reject)=>{
  const start=performance.now();
  function check(){if(${condition})return resolve(true);if(performance.now()-start>10000)return reject(Error('Timed out: '+location.href));requestAnimationFrame(check)}check();
})`);
const click = (text) => evaluate(`[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)}).click()`);
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(new URL("./fixture.js", import.meta.url), "utf8") + `
(() => {
  const fetchFixture=window.fetch;
  let failed=false;
  window.__pageRequests=[];
  window.fetch=async(input,init)=>{
    const url=new URL(input,location.href);
    if(url.pathname==='/api/me/data')return Response.json({data:{settings:{quality:'1440p',ambient:false}}});
    if(url.pathname==='/api/v/youtube/channels/c0') {
      const data=await (await fetchFixture(input,init)).json();
      const next=url.searchParams.get('next');
      window.__pageRequests.push(next);
      if(next==='page1'&&!failed){failed=true;return Response.json({error:'Temporary failure',code:'upstream'},{status:502});}
      if(next==='page2'&&window.__expire){window.__expire=false;return Response.json({error:'Video list expired',code:'cursor_expired'},{status:410});}
      if(next==='page1'&&window.__holdNext){window.__holdNext=false;await new Promise(resolve=>{window.__releasePage=resolve;});}
      const all=data.videos;
      data.videos=next==='page1'?all.slice(2,5):next==='page2'?all.slice(4,6):all.slice(0,3);
      data.next=next==='page1'?'page2':next==='page2'?undefined:'page1';
      return Response.json(data);
    }
    return fetchFixture(input,init);
  };
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const loaded = new Promise(resolve => on("Page.loadEventFired", resolve));
await send("Page.navigate", { url: process.env.PERF_URL || "http://127.0.0.1:5190/" });
await loaded;
await waitFor(`document.querySelector('a[href="/channel/youtube/c0"]')`);
await evaluate(`document.querySelector('a[href="/channel/youtube/c0"]').click()`);
await waitFor(`document.querySelector('h1')?.textContent==='Channel 0' && document.querySelectorAll('article').length===3`);
// StrictMode intentionally replays the initial effect in development.
await evaluate(`window.__pageRequests=[]`);
await click("Load more videos");
await waitFor(`document.querySelector('[role="alert"]')?.textContent==='Temporary failure'`);
assert.equal(await evaluate(`document.querySelectorAll('article').length`), 3);
await click("Try again");
await waitFor(`document.querySelectorAll('article').length===5`);
await evaluate(`window.__expire=true`);
await click("Load more videos");
await waitFor(`[...document.querySelectorAll('button')].some(el=>el.textContent==='Reload videos')`);
assert.equal(await evaluate(`document.querySelectorAll('article').length`), 5);
await click("Reload videos");
await waitFor(`document.querySelectorAll('article').length===3`);
// Two synchronous clicks must issue only one next-page request.
await evaluate(`const button=[...document.querySelectorAll('button')].find(el=>el.textContent==='Load more videos');button.click();button.click()`);
await waitFor(`document.querySelectorAll('article').length===5`);
await click("Load more videos");
await waitFor(`document.querySelectorAll('article').length===6 && ![...document.querySelectorAll('button')].some(el=>el.textContent==='Load more videos')`);
assert.deepEqual(await evaluate(`window.__pageRequests`), ["page1","page1","page2",null,"page1","page2"]);
console.log("channel pagination: append, deduplication, retry, expiry, reload, double click, end of list passed");
await evaluate(`document.querySelector('a[href="/"]').click()`);
await waitFor(`location.pathname==='/' && document.querySelector('h1')?.textContent.includes('Perf')`);
await evaluate(`document.querySelector('a[href="/channel/youtube/c0"]').click()`);
await waitFor(`document.querySelector('h1')?.textContent==='Channel 0' && document.querySelectorAll('article').length===3`);
await evaluate(`window.__holdNext=true`);
await click("Load more videos");
await waitFor(`typeof window.__releasePage==='function'`);
await evaluate(`document.querySelector('a[href="/channel/youtube/c1"]').click()`);
await waitFor(`location.pathname==='/channel/youtube/c1' && document.querySelectorAll('article').length===100`);
await evaluate(`window.__releasePage();`);
await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
assert.equal(await evaluate(`document.querySelectorAll('article').length`),100);
console.log("late page response cannot overwrite a different channel");

await evaluate(`document.querySelector('a[href="/watch/youtube/v0"]').click()`);
await waitFor(`document.querySelector('video')`);
await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
// Inject manifest-derived heights into the development Player fiber; no real media is played.
const setHeights = (heights) => evaluate(`(() => {
  const video=document.querySelector('video');
  let fiber=video[Object.keys(video).find(key=>key.startsWith('__reactFiber$'))];
  while(fiber&&fiber.type?.name!=='Player')fiber=fiber.return;
  let hook=fiber.memoizedState;
  while(hook&&!(Array.isArray(hook.memoizedState)&&hook.queue?.dispatch))hook=hook.next;
  if(!hook)throw Error('Player heights hook not found');
  hook.queue.dispatch(${JSON.stringify(heights)});
})()`);
await setHeights([1080,720,480]);
await evaluate(`const media=document.querySelector('video');media.dispatchEvent(new Event('play'));media.dispatchEvent(new Event('pause'));`);
await evaluate(`document.querySelector('[aria-label="Settings"]').click()`);
await waitFor(`document.querySelector('[role="menu"]')?.textContent.includes('1080p')`);
assert.ok(!await evaluate(`document.querySelector('[role="menu"]').textContent.includes('1440p')`));
await evaluate(`[...document.querySelectorAll('[role="menu"] button')].find(el=>el.textContent.includes('Quality')).click()`);
await waitFor(`document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent.includes('1080p')`);
await setHeights([2160,1440,1080]);
await waitFor(`document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent.includes('1440p')`);
await setHeights([]);
await waitFor(`document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent==='Auto'`);
await setHeights([1080,720]);
await waitFor(`document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent.includes('1080p')`);
console.log("quality menu: 1440p preference resolves to 1080p, restores to 1440p when available, handles loading");
close();
