import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { send, evaluate, on, close } from "./cdp.mjs";
const waitFor = condition => evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(${condition})return resolve();if(performance.now()-start>12000)return reject(Error('Description check timed out'));requestAnimationFrame(check)}check()})`);
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(new URL("./fixture.js", import.meta.url), "utf8") + `
(() => {
 const original=window.fetch;
 window.__aboutRequests=0;
 window.__description='Twitter: https://twitter.com/MoistCr1TiKaL?utm_source=tracking\\nInstagram: https://www.instagram.com/bigmoistcr1tikal/?hl=en\\nTwitch: https://www.twitch.tv/moistcr1tikal\\n\\n'+('Full biography, not the abbreviated preview. '.repeat(14))+'\\n\\n<svg onload="window.__descriptionInjected=true">literal text</svg>\\nFull link: https://example.com/'+('long-path-'.repeat(12))+'\\nEND OF FULL DESCRIPTION';
 window.fetch=async(input,init)=>{
   const url=new URL(input,location.href);
   if(url.pathname==='/api/v/youtube/channels/c0/about'){
     window.__aboutRequests++;
     if(window.__failAbout)return Response.json({error:'Unavailable'},{status:502});
     return Response.json({description:window.__description});
   }
   const response=await original(input,init);
   if(url.pathname==='/api/v/youtube/channels/c0'){
     const page=await response.json();page.channel.description='Short preview…';page.channel.subscribers=18300000;page.channel.videoCount=7300;page.channel.handle='@penguinz0';page.channel.feedUrl='https://www.youtube.com/feeds/videos.xml?channel_id=UCq6VFHwMzcMXbuKyG7SQYIg';return Response.json(page);
   }
   return response;
 };
})();` });
await send("Emulation.setDeviceMetricsOverride", {width:1440,height:900,deviceScaleFactor:1,mobile:false});
const loaded=new Promise(resolve=>on("Page.loadEventFired",resolve));
await send("Page.navigate",{url:process.env.PERF_URL||"http://127.0.0.1:5190/"});await loaded;
await waitFor(`document.querySelector('a[href="/channel/youtube/c0"]')`);
await evaluate(`document.querySelector('a[href="/channel/youtube/c0"]').click()`);
await waitFor(`document.querySelector('h1')?.textContent==='Channel 0'`);
assert.equal(await evaluate('window.__aboutRequests'),0);
const tab=name=>evaluate(`[...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='${name}').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))`);
await tab('About');
await waitFor(`document.querySelector('[aria-label="Channel description"]')?.textContent.includes('END OF FULL DESCRIPTION')`);
const result=await evaluate(`(()=>{const description=document.querySelector('[aria-label="Channel description"]');const links=[...description.querySelectorAll('a')];return {whiteSpace:getComputedStyle(description.querySelector('p')).whiteSpace,links:links.map(link=>({href:link.href,text:link.textContent,rel:link.rel,target:link.target})),injected:!!window.__descriptionInjected,svg:description.querySelectorAll('svg').length,rss:document.querySelector('[aria-label="Channel information"] a')?.href};})()`);
assert.equal(result.whiteSpace,'pre-wrap');
assert.equal(result.links.length,4);
assert.equal(result.links[0].href,'https://twitter.com/MoistCr1TiKaL');
assert.ok(result.links.every(link=>link.target==='_blank'&&link.rel.includes('noreferrer')&&link.rel.includes('noopener')));
assert.ok(result.links[3].text.length>100&&!result.links[3].text.includes('…'));
assert.equal(result.injected,false);assert.equal(result.svg,0);
assert.ok(result.rss.includes('/feeds/videos.xml?channel_id='));
assert.equal(await evaluate(`document.querySelector('form[aria-label="Search this channel"]')`),null);
await evaluate(`window.__failAbout=true`);await tab('Videos');await tab('About');
await waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('Showing the preview')`);
assert.ok(await evaluate(`document.querySelector('[aria-label="Channel description"]').textContent.includes('Short preview')`));
await evaluate(`window.__failAbout=false;[...document.querySelectorAll('button')].find(el=>el.textContent==='Try again').click()`);
await waitFor(`document.querySelector('[aria-label="Channel description"]')?.textContent.includes('END OF FULL DESCRIPTION')`);
await tab('Videos');
assert.ok(await evaluate(`document.querySelector('form[aria-label="Search this channel"]')!==null`));
await evaluate(`window.__description='Twitter: https://twitter.com/MoistCr1TiKaL\\n\\nInstagram: https://www.instagram.com/bigmoistcr1tikal/?hl=en\\n\\nTwitch: https://www.twitch.tv/moistcr1tikal\\n\\nTik Tok: Hugecharles\\n\\nI do not have any other public accounts.'`);
await tab('About');
await waitFor(`document.querySelector('[aria-label="Channel description"]')?.textContent.includes('other public accounts')`);
for(const width of [1440,390,320]){
 await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<768});
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 assert.ok(await evaluate(`document.body.scrollWidth<=innerWidth`));
 const layout=await evaluate(`(()=>{const description=document.querySelector('[aria-labelledby="channel-about-description"]').getBoundingClientRect();const info=document.querySelector('[aria-label="Channel information"]').getBoundingClientRect();return {description:{right:description.right,bottom:description.bottom},info:{left:info.left,top:info.top}};})()`);
 if(width===1440)assert.ok(layout.info.left>layout.description.right);
 else assert.ok(layout.info.top>=layout.description.bottom);
 const metrics=await send('Page.getLayoutMetrics');
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});
 writeFileSync('/tmp/tube-description-'+width+'.png',Buffer.from(shot.data,'base64'));
}
await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedFeed=value;}}});[...document.querySelectorAll('button')].find(el=>el.textContent==='Copy feed link').click()`);
await waitFor(`[...document.querySelectorAll('button')].some(el=>el.textContent==='Copied')`);
assert.equal(await evaluate('window.__copiedFeed'),result.rss);
await evaluate(`navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied')};[...document.querySelectorAll('button')].find(el=>el.textContent==='Copied').click()`);
await waitFor(`[...document.querySelectorAll('button')].some(el=>el.textContent==='Copy feed link')`);
console.log('About: on-demand full description, paragraphs, safe links, copy success/failure, retry, tab controls, desktop columns and mobile stacking pass');
close();
