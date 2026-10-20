import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plexFixture } from './plex-fixture.mjs';
import { send, evaluate, close } from './cdp.mjs';
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL('./fixture.js',import.meta.url),'utf8') + plexFixture + `
(()=>{const base=window.fetch;window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname==='/api/feed'){
 const root='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',now=Date.now(),day=86400000;
 const episode=(id,title,published,addedAt)=>({id:root+'.m.'+id,backend:'plex',provider:'plex',title,channelId:root+'.m.1',channelName:'Release date show',duration:1500,thumbnail:'',views:0,description:'',published:new Date(published).toISOString(),addedAt:new Date(addedAt).toISOString(),episode:{seriesId:root+'.m.1',seriesTitle:'Release date show',season:1,number:String(id)}});
 return Response.json([episode(2001,'Newest release',now-3600000,now-100*day),episode(2002,'Released today imported long ago',now-7200000,now-100*day),episode(2003,'Old release imported today',now-45*day,now)]);
 }return base(input,init);};})();` });
await send('Page.navigate',{url:(process.env.PERF_URL || 'http://localhost:5180')+'/'});
const wait = (condition) => evaluate(`new Promise((resolve,reject)=>{const until=Date.now()+12000;function check(){if(${condition})return resolve(true);if(Date.now()>until)return reject(Error(document.body.innerText));setTimeout(check,50)}check()})`);
await wait(`document.querySelector('[data-feed]')?.textContent.includes('Released today imported long ago')`);
assert.equal(await evaluate(`document.querySelector('[data-feed]').textContent.includes('Old release imported today')`),false);
assert.equal(await evaluate(`document.querySelector('main [data-section-bar] h2').textContent`),'Today');
assert.ok(await evaluate(`!!document.querySelector('[aria-label="Latest across your services"]')`));
await evaluate(`[...document.querySelectorAll('[aria-label="Show videos from"] button')].find(b=>b.textContent.trim()==='Today').click()`);
await wait(`document.querySelector('[data-feed]')?.textContent.includes('Old release imported today')`);
assert.equal(await evaluate(`[...document.querySelectorAll('[data-bucket-start]')].find(el=>el.textContent.includes('Old release imported today')).dataset.bucketStart`),'Earlier');
console.log('PASS: feed dates and Today filter use release dates even when stale added-date fields are present');
close();
