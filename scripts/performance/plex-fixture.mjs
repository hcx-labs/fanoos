export const plexFixture = `
(()=>{
 const baseFetch=window.fetch;
 const art='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#3b5067"/><circle cx="200" cy="220" r="100" fill="#e5a00d"/></svg>');
 const root='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
 const channel={id:root+'.l.20',backend:'plex',provider:'plex',kind:'library',libraryType:'shows',name:'TV Shows',handle:'Home Server',description:'TV shows on Home Server',unseen:0};
 const show=(id)=>({id:root+'.m.'+id,backend:'plex',provider:'plex',kind:'series',name:'Example Show '+id,poster:art,unseen:0,videoCount:4});
 const video=(id)=>({id:root+'.m.'+id,backend:'plex',provider:'plex',title:'Episode '+id,channelId:root+'.m.1',channelName:'Example Show 1',thumbnail:art,duration:1200,description:'Episode description',published:new Date().toISOString(),views:0,episode:{seriesTitle:'Example Show 1',seriesId:root+'.m.1',season:1,number:id}});
 const backend={id:'plex-backend',slug:'plex',kind:'plex',label:'Plex',info:{protocol:1,kind:'plex',name:'Plex',color:'#e5a00d',features:['feed','search','progress','movies'],link:{configured:true,method:'redirect',can:[],cannot:[]},urls:{},nouns:{channel:'library or show',channels:'libraries and shows',video:'movie or episode',videos:'movies and episodes',follow:'In your library',following:'In your library'}}};
 window.fetch=async(input,init)=>{
  const u=new URL(typeof input==='string'?input:input.url,location.href),p=u.pathname;
  if(p==='/api/auth/me')return Response.json({profile:{id:'plex-test',name:'Plex Test'},backends:[backend,{...backend,id:'youtube-backend',slug:'youtube',kind:'youtube',label:'YouTube',info:{...backend.info,kind:'youtube',name:'YouTube',color:'#f00',features:[]}}],accounts:[{id:'youtube-account',backendId:'youtube-backend',name:'YouTube Test',label:'Personal',provider:'youtube',inFeed:true,canWrite:false},{id:'plex-account',backendId:backend.id,name:'Plex Test',label:'Personal',provider:'plex',inFeed:true,canWrite:true}],defaultAccountId:'plex-account'});
  if(p==='/api/following' && u.searchParams.has('limit')) {
   (window.__channelListRequests ||= []).push(Object.fromEntries(u.searchParams));
   const all = Array.from({length:72}, (_,i)=>({id:'yt-'+i,backend:'youtube',provider:'youtube',kind:'channel',name:i===0?'Example YouTube channel':'YouTube channel '+i,unseen:0})).filter(c=>c.name.toLowerCase().includes((u.searchParams.get('q')||'').toLowerCase()));
   const start=Number(u.searchParams.get('next')||0),limit=Number(u.searchParams.get('limit'));
   return Response.json({channels:all.slice(start,start+limit),next:start+limit<all.length?String(start+limit):undefined,total:all.length,groups:[]});
  }
  if(p==='/api/following')return Response.json([channel,{...channel,id:root+'.l.10',name:'Movies',libraryType:'movies'},{...channel,id:'yt-channel',backend:'youtube',provider:'youtube',kind:'channel',name:'Example YouTube channel'}]);
  if(p==='/api/feed'){
   window.__lastFeedLibrary=u.searchParams.get('library');
   if(u.searchParams.get('backend')==='youtube')return Response.json([{...video('y1'),backend:'youtube',provider:'youtube',episode:undefined,category:'Music'},{...video('y2'),backend:'youtube',provider:'youtube',episode:undefined,category:'Science'}]);
   const ep={...video('1'),libraryId:root+'.l.20'},movie={...video('9'),kind:'movie',channelId:root+'.m.9',title:'Example Movie',libraryId:root+'.l.10',year:2024,poster:art,episode:undefined};
   return Response.json([ep,movie].filter(v=>!u.searchParams.get('library')||v.libraryId===u.searchParams.get('library')));
  }
  if(p==='/api/b/plex/public/text-subtitle/mock')return new Response('WEBVTT\\n\\n00:00.000 --> 00:05.000\\nExample subtitle\\n',{headers:{'content-type':'text/vtt'}});
  if(p.endsWith('/followers'))return Response.json(['plex-account']);
  if(sessionStorage.getItem('catalog-long') && (p==='/api/v/plex/channels/'+root+'.l.20' || p==='/api/v/plex/channels/'+root+'.l.10')) {
   (window.__catalogRequests ||= []).push({path:p,...Object.fromEntries(u.searchParams)});
   const start=Number(u.searchParams.get('next')||0),limit=Number(u.searchParams.get('limit')||50);
   const items=Array.from({length:Math.max(0,Math.min(limit,100-start))},(_,i)=>start+i+1);
   const movies=p.endsWith('.l.10');
   return Response.json({channel:movies?{...channel,name:'Movies',libraryType:'movies'}:channel,channels:movies?undefined:items.map(show),videos:movies?items.map(id=>({...video(id),kind:'movie',title:'Example Movie '+id,poster:art,episode:undefined})):[],next:start+limit<100?String(start+limit):undefined});
  }
  if(p==='/api/v/plex/channels/'+root+'.l.20')return Response.json({channel,videos:[],channels:u.searchParams.get('next')?[show(2)]:[show(1)],next:u.searchParams.get('next')?undefined:'50'});
  if(p==='/api/v/plex/channels/'+root+'.l.10')return Response.json({channel:{...channel,id:root+'.l.10',name:'Movies',libraryType:'movies'},videos:[{...video('9'),title:'Example Movie',channelId:root+'.m.9',kind:'movie',year:2024,poster:art,episode:undefined}]});
  if(p==='/api/v/plex/channels/'+root+'.m.9')return Response.json({channel:{...show(9),kind:'movie',name:'Example Movie'},videos:[{...video('9'),title:'Example Movie',kind:'movie',year:2024,episode:undefined}]});
  if(p==='/api/v/plex/channels/'+root+'.m.1')return Response.json({channel:show(1),sections:[{id:'s1',label:'Season 1',count:3},{id:'s2',label:'Season 2',count:1}],section:u.searchParams.get('section')||'s1',videos:u.searchParams.get('section')==='s2'?[video('4')]:u.searchParams.get('next')?[video('2'),video('3')]:[video('1'),video('2')],next:u.searchParams.get('next')||u.searchParams.get('section')==='s2'?undefined:'50'});
  if(p==='/api/v/plex/videos/'+root+'.m.9')return Response.json({video:{...video('9'),kind:'movie',year:2024,title:'Example Movie'},channel:{...channel,id:root+'.l.10',name:'Movies'},next:[],stream:{originalAudio:{label:'English (EAC3 5.1)',codec:'eac3',mimeType:'audio/mp4; codecs=\"ec-3\"'},subtitles:[{id:'7',locale:'en',label:'English (SRT)',format:'vtt',url:'/api/b/plex/public/text-subtitle/mock'},{id:'11',locale:'en',label:'English (PGS)',format:'vtt',render:'server',url:''}],audioTracks:[{id:'original-9',mode:'original',codec:'aac',mimeType:'audio/mp4; codecs=\"mp4a.40.2\"',locale:'en',label:'English (AAC Stereo)',sources:[{id:'original',kind:'original',label:'Original · 1080p',stream:{}}]},{id:'8',locale:'en',label:'English',selected:true,sources:[{id:'transcode-720',kind:'transcode',label:'720p',stream:{}}]},{id:'9',locale:'ja',label:'Japanese',sources:[{id:'transcode-720',kind:'transcode',label:'720p',stream:{}}]}],defaultSource:'original',sources:[{id:'original',kind:'original',label:'Original · 1080p',description:'Direct play · MP4 · H264 · AAC',height:1080,bitrate:12000000,stream:{}},{id:'transcode-720',kind:'transcode',label:'720p',description:'Transcode · 4 Mbps · H.264 / AAC',height:720,bitrate:4000000,stream:{}}]}});
  return baseFetch(input,init);
 };
})();`;
