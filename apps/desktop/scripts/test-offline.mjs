import http from 'node:http';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync, createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const root = mkdtempSync('/tmp/fanoos-offline-e2e-');
const upstream = process.env.FANOOS_E2E_SERVER || 'http://localhost:5180';
const binary = process.env.FANOOS_E2E_BINARY || fileURLToPath(new URL('../dist/mac-arm64/Fanoos.app/Contents/MacOS/Fanoos', import.meta.url));
const server = 'http://localhost:5195';
writeFileSync(`${root}/desktop.json`, JSON.stringify({ server }));
const proxy = http.createServer(async (req, res) => {
  try {
    const headers = { ...req.headers }; delete headers.host; delete headers.connection; headers.origin = upstream;
    const response = await fetch(`${upstream}${req.url}`, { method: req.method, headers, body: ['GET','HEAD'].includes(req.method) ? undefined : Readable.toWeb(req), duplex: 'half', redirect: 'manual' });
    const out = Object.fromEntries(response.headers); delete out['content-encoding']; delete out['transfer-encoding'];
    if (response.headers.getSetCookie().length) out['set-cookie'] = response.headers.getSetCookie();
    res.writeHead(response.status, out);
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch { if(!res.headersSent) res.writeHead(502); res.end(); }
});
await new Promise(r=>proxy.listen(5195,'127.0.0.1',r));
let proc, ws, next=0;const pending=new Map();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`))},90000);pending.set(id,m=>{clearTimeout(timer);m.error?reject(m.error):resolve(m.result)});ws.send(JSON.stringify({id,method,params}))});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value};
const wait=async(expression,ms=45000)=>{const end=Date.now()+ms;while(Date.now()<end){try{const value=await evaluate(expression);if(value)return value}catch{}await pause(250)}throw new Error(`Timed out: ${expression}`)};
function check(ok,message){if(!ok)throw new Error(message);console.log('PASS:',message)}
async function launch(){
  proc=spawn(binary,['--remote-debugging-port=9334'],{env:{...process.env,FANOOS_DESKTOP_DATA_DIR:root},stdio:['ignore','pipe','pipe']});
  const log=createWriteStream(`${root}/electron.log`,{flags:'a'});proc.stdout.pipe(log);proc.stderr.pipe(log);
  let target;for(let i=0;i<80;i++){try{const tabs=await(await fetch('http://localhost:9334/json/list')).json();target=tabs.find(t=>t.type==='page');if(target)break}catch{}await pause(250)}if(!target)throw new Error('Electron did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id)}};
  await send('Page.enable');await send('Runtime.enable');
}
async function stop(){ws?.close();if(proc?.exitCode===null){proc.kill('SIGTERM');await Promise.race([once(proc,'exit'),pause(5000)])}}
try{
  await launch();await wait(`!!window.fanoosDesktop?.downloads`);
  const email=`offline-e2e-${Date.now()}@example.test`;
  const status=await evaluate(`(async()=>{const r=await fetch('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Offline Test',email:${JSON.stringify(email)},password:crypto.randomUUID()})});return r.status})()`);
  check(status===200,'registered isolated test profile');
  await wait(`!!document.querySelector('form') || !!document.querySelector('header')`);
  await send('Page.navigate',{url:server+'/watch/youtube/jNQXAC9IVRw'});
  await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Download')`,90000);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Download').click()`);
  await wait(`document.querySelectorAll('[role="dialog"] select').length===2`,90000);
  const options=await evaluate(`Array.from(document.querySelector('[role="dialog"] select').options).map(o=>({id:o.value,label:o.textContent}))`);
  check(options.length>0,'download quality selector populated from real YouTube tracks');
  const option=options.find(o=>o.label.startsWith('360p')&&o.label.includes('h264'))||options.at(-1);
  await evaluate(`(()=>{const s=document.querySelector('[role="dialog"] select');s.value=${JSON.stringify(option.id)};s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[role="dialog"] input[type="checkbox"]')?.click()})()`);
  await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(b=>b.textContent==='Download').click()`);
  await wait(`!document.querySelector('[role="dialog"]')`,90000);
  const item=await wait(`window.fanoosDesktop.downloads.list().then(l=>l.items.find(i=>['complete','failed'].includes(i.status)))`,120000);
  check(item.status==='complete',`real YouTube download completed${item.error?': '+item.error:''}`);
  console.log(JSON.stringify({id:item.id,bytes:item.received,quality:item.quality,dataDirectory:root}));
  await send('Page.navigate',{url:server+'/downloads'});await wait(`document.body.textContent.includes('Available offline')`);
  const screenshot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${root}/online.png`,Buffer.from(screenshot.data,'base64'));
  check(true,'online Downloads library shows completed video');
  check(await evaluate(`!!document.querySelector('aside a[href$="/downloads"]')`),'Downloads is always in the online sidebar');
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Play').click()`);
  await wait(`location.pathname.startsWith('/downloads/') && document.querySelector('video')?.readyState>=2`);
  check(await evaluate(`!window.fanoosDesktop.offline && !!document.querySelector('aside a[href$="/downloads"]')`),'online local playback keeps normal app navigation');
  await stop();
  proxy.closeAllConnections();await new Promise(r=>proxy.close(r));
  check(true,'disconnected only the isolated test server; user stack remains running');
  await launch();
  await wait(`location.protocol==='fanoos-offline:' && document.body.textContent.includes('Available offline')`);
  check(true,'cold launch without server opens bundled offline library');
  check(await evaluate(`!!document.querySelector('aside a[href$="/downloads"]') && !!document.querySelector('.top-bar')`),'offline shell preserves sidebar and top bar');
  await evaluate(`document.querySelector('aside a[href$="/library"]').click()`);
  await wait(`document.querySelector('main').textContent.includes('Offline')`);
  check(true,'server-dependent pages show Offline');
  await evaluate(`Array.from(document.querySelectorAll('.top-bar button')).find(b=>b.textContent.includes('Search')).click()`);
  await wait(`!!document.querySelector('input[aria-label="Search downloaded videos"]')`);
  await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Search downloaded videos"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'zoo');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await wait(`document.querySelector('[aria-label="Downloaded search results"]').textContent.includes('Me at the zoo')`);
  check(true,'offline search finds local downloaded metadata');
  await evaluate(`document.querySelector('[aria-label="Downloaded search results"] button').click()`);
  await wait(`document.querySelector('video')?.readyState>=2`);
  await evaluate(`document.querySelector('aside a[href$="/downloads"]').click()`);
  await wait(`document.body.textContent.includes('Available offline')`);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Play').click()`);
  await wait(`document.querySelector('video')?.readyState>=2`);
  const detail=await evaluate(`({duration:document.querySelector('video').duration,src:document.querySelector('video').currentSrc,subtitles:document.querySelector('video').textTracks.length})`);
  check(detail.duration>18 && detail.duration<21,'offline DASH audio/video load with expected duration');
  await evaluate(`document.querySelector('video').play()`);await pause(1300);
  check(await evaluate(`document.querySelector('video').currentTime>0.5 && !document.querySelector('video').paused`),'offline video plays');
  await evaluate(`document.querySelector('video').currentTime=12`);await pause(1000);
  check(await evaluate(`document.querySelector('video').currentTime>=12`),'offline byte-range seeking works');
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${root}/offline.png`,Buffer.from(shot.data,'base64'));
  await evaluate(`document.querySelector('video').pause()`);await pause(1600);
  check(await evaluate(`window.fanoosDesktop.downloads.state().then(s=>s.dirty && s.pendingProgress['youtube/jNQXAC9IVRw']>=12)`),'offline playback position persists for reconnect sync');
  const cap=await evaluate(`window.fanoosDesktop.downloads.detail(${JSON.stringify(item.id)}).then(d=>d.stream.subtitles.length)`);
  check(cap>0,'selected captions downloaded alongside media');
  await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true}))`);
  await wait(`document.querySelector('video')?.textTracks[0]?.cues?.length>0`);
  check(true,'downloaded captions load without the server');
  check(await evaluate(`document.querySelector('main').textContent.includes('Downloaded') && !!document.querySelector('main section')`),'offline watch page exposes saved date and description');
  await send('Emulation.setDeviceMetricsOverride',{width:800,height:700,deviceScaleFactor:1,mobile:false});
  check(await evaluate(`document.documentElement.scrollWidth<=innerWidth && getComputedStyle(document.querySelector('aside')).display!=='none'`),'offline sidebar and header fit minimum desktop width');
  await new Promise(r=>proxy.listen(5195,'127.0.0.1',r));
  await evaluate(`document.querySelector('[aria-label="Reconnect"]').click()`);
  await wait(`location.protocol==='http:' && !!document.querySelector('aside a[href$="/downloads"]')`);
  await wait(`fetch('/api/me/data').then(r=>r.json()).then(s=>s.data?.progress?.['youtube/jNQXAC9IVRw']>=12)`);
  check(true,'offline watch position syncs to server after reconnect');
  console.log('ALL ELECTRON END-TO-END CHECKS PASSED');
  console.log('Screenshots and test profile:',root);
}catch(error){
  console.error(error.message||error);console.error('Debug directory:',root);
  try{console.error((await evaluate(`document.body.innerText`)).slice(-2000))}catch{}
  process.exitCode=1;
}finally{await stop();if(proxy.listening){proxy.closeAllConnections();proxy.close()} }
