/* Sinaliscord V17: private Sessão grid recording + collapsible chat */
(function(){
'use strict';
const ui={
  hidden:localStorage.getItem('sinalis-sessao-hide-chat')==='1',
  current:null,active:false,by:null,pending:false,lastRoom:null,lastStatusAt:0,
  galleryUrl:null,recorder:null,recording:null,stream:null,canvas:null,ctx:null,
  paintTimer:null,audioTimer:null,audioCtx:null,audioDest:null,audioTracks:new Set(),
  uploadQueue:Promise.resolve(),uploadError:null,partNo:0,startedAt:0,stopping:false
};
const $=sel=>document.querySelector(sel);
const $$=sel=>Array.from(document.querySelectorAll(sel));
const inSession=()=>state.view==='chat'&&!state.dmUserId&&state.channels.some(ch=>ch.id===state.channelId&&ch.name.toLowerCase()==='sessão'&&ch.type==='voice');
const sessionChannel=()=>state.channels.find(ch=>ch.type==='voice'&&ch.name.toLowerCase()==='sessão');
const master=()=>!!state.me&&state.server?.role==='mestre';
const formatDate=v=>{try{return new Date(v).toLocaleString('pt-BR')}catch{return String(v)}};
const niceBytes=n=>n>=1e6?(n/1e6).toFixed(1)+' MB':(n/1000).toFixed(0)+' KB';
const talk=(message,isError)=>{if(typeof toast==='function')toast(message,isError?'error':'success')};
function refreshButtons(){
 const stage=$('.session-voice-layout');if(!stage)return;
 stage.classList.toggle('session-chat-hidden',ui.hidden);
 const toggle=stage.querySelector('[data-action="session-chat-toggle"]');
 if(toggle)toggle.textContent=ui.hidden?'💬 Mostrar chat':'◧ Esconder chat';
 const start=stage.querySelector('[data-action="session-rec-start"]');
 const stop=stage.querySelector('[data-action="session-rec-stop"]');
 if(start)start.hidden=!!ui.recording||ui.pending||ui.active;
 if(stop){stop.hidden=!ui.recording;stop.disabled=ui.stopping}
 const badge=stage.querySelector('.session-recording-indicator');
 if(badge){
  badge.hidden=!(ui.active||ui.recording);
  badge.textContent='● GRAVANDO — esta Sessão está sendo gravada pelo Mestre';
 }
 const floating=$('.session-rec-floating');
 if(floating){floating.hidden=!(ui.active||ui.recording);floating.textContent='● SESSÃO EM GRAVAÇÃO'}
}
function decorateSession(){
 const stage=$('.session-voice-layout');if(!stage)return;
 const title=stage.querySelector('.session-title');if(!title)return;
 let controls=title.querySelector('.session-title-actions');
 if(!controls){
  controls=document.createElement('div');
  controls.className='session-title-actions';
  const toggle=document.createElement('button');
  toggle.type='button';toggle.dataset.action='session-chat-toggle';controls.append(toggle);
  if(master()){
    const start=document.createElement('button');start.type='button';start.dataset.action='session-rec-start';start.className='session-rec-start';start.textContent='⏺ Gravar Sessão';controls.append(start);
    const stop=document.createElement('button');stop.type='button';stop.dataset.action='session-rec-stop';stop.className='session-rec-stop';stop.textContent='■ Parar gravação';controls.append(stop);
    const gallery=document.createElement('button');gallery.type='button';gallery.dataset.action='session-rec-gallery';gallery.textContent='▣ Gravações';controls.append(gallery);
  }
  title.append(controls);
  const notice=document.createElement('div');notice.className='session-recording-indicator';notice.setAttribute('role','status');stage.querySelector('.session-main-column')?.prepend(notice);
 }
 refreshButtons();
 if(Date.now()-ui.lastStatusAt>12000)refreshStatus();
}
async function refreshStatus(){
 if(!state.token||!state.server||!inSession())return;
 ui.lastStatusAt=Date.now();
 try{
  const x=await api('/api/session-recordings/status?serverId='+encodeURIComponent(state.server.id));
  setStatus(x);
 }catch(e){console.warn('Status da gravação:',e.message)}
}
function setStatus(v){
 const old=ui.active;ui.active=!!v.active;ui.by=v.by||null;
 refreshButtons();
 if(!old&&ui.active&&!ui.recording&&inSession())talk('Atenção: o Mestre começou a gravar a Sessão.');
 if(old&&!ui.active&&!ui.recording&&inSession())talk('A gravação da Sessão terminou.');
}
function bindEvents(source){
 source.addEventListener('session-recording',ev=>{
  try{const data=JSON.parse(ev.data);if(data.serverId===state.server?.id)setStatus(data)}catch(e){console.warn(e)}
 });
}
function roundRect(ctx,x,y,w,h,r){
 ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.closePath();
}
function contain(ctx,media,x,y,w,h){
 if(!media)return false;
 const video=media.tagName==='VIDEO';
 if(video&&(media.readyState<2||!media.videoWidth))return false;
 if(!video&&(!media.complete||!media.naturalWidth))return false;
 const mw=video?media.videoWidth:media.naturalWidth,mh=video?media.videoHeight:media.naturalHeight;
 const scale=Math.min(w/mw,h/mh);
 try{ctx.drawImage(media,x+(w-mw*scale)/2,y+(h-mh*scale)/2,mw*scale,mh*scale);return true}catch{return false}
}
function cover(ctx,media,x,y,w,h){
 if(!media)return false;
 if(media.tagName==='VIDEO'&&(media.readyState<2||!media.videoWidth))return false;
 if(media.tagName!=='VIDEO'&&(!media.complete||!media.naturalWidth))return false;
 const mw=media.videoWidth||media.naturalWidth,mh=media.videoHeight||media.naturalHeight;
 const scale=Math.max(w/mw,h/mh),dw=w/scale,dh=h/scale;
 try{ctx.drawImage(media,(mw-dw)/2,(mh-dh)/2,dw,dh,x,y,w,h);return true}catch{return false}
}
function paintRecording(){
 const ctx=ui.ctx,canvas=ui.canvas;if(!ctx||!canvas)return;
 const W=canvas.width,H=canvas.height;
 ctx.fillStyle='#060309';ctx.fillRect(0,0,W,H);
 const marginX=24,marginY=26,gap=8;
 const cellW=(W-marginX*2-gap*2)/3,cellH=(H-marginY*2-gap)/2;
 const labels=['Mestre','Knight','Manuela','Transmissão','Luska','Mafe'];
 const areas=['master','knight','manuela','share','luska','mafe'];
 const stage=$('.session-voice-layout');
 for(let k=0;k<6;k++){
  const col=k%3,row=Math.floor(k/3),x=marginX+col*(cellW+gap),y=marginY+row*(cellH+gap);
  const w=cellW,h=cellH;
  ctx.fillStyle='#060308';ctx.fillRect(x,y,w,h);
  const node=stage?.querySelector(k===3?'.session-share-spot':'.session-seat[style*="grid-area:'+areas[k]+'"]');
  if(k===3){
   const v=node?.querySelector('video');
   if(!contain(ctx,v,x+5,y+30,w-10,h-60)){
    ctx.fillStyle='#9a4fc0';ctx.font='35px system-ui';ctx.textAlign='center';ctx.fillText('▣',x+w/2,y+h/2);
    ctx.font='15px system-ui';ctx.fillText('Aguardando transmissão',x+w/2,y+h/2+32);
   }
  }else{
   const video=node?.querySelector('video'),img=node?.querySelector('img');
   const midX=x+w/2,midY=y+h/2-13,r=Math.min(w,h)*.27;
   ctx.save();ctx.beginPath();ctx.arc(midX,midY,r,0,Math.PI*2);ctx.clip();
   if(!cover(ctx,video,midX-r,midY-r,r*2,r*2)&&!cover(ctx,img,midX-r,midY-r,r*2,r*2)){
    ctx.fillStyle='#2c123f';ctx.fillRect(midX-r,midY-r,r*2,r*2);
    ctx.fillStyle='#deb4fc';ctx.font='bold 34px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(labels[k][0],midX,midY);
   }
   ctx.restore();
   ctx.fillStyle='#e9d2ff';ctx.font='bold 20px system-ui';ctx.textAlign='center';ctx.textBaseline='alphabetic';
   ctx.fillText(labels[k],midX,y+h-44,w-25);
  }
  ctx.lineWidth=5;ctx.strokeStyle='#8414bc';ctx.strokeRect(x+2.5,y+2.5,w-5,h-5);
  ctx.fillStyle='#220d31d9';ctx.fillRect(x+4,y+h-32,w-8,26);
  ctx.fillStyle='#c7a4e7';ctx.font='bold 14px system-ui';ctx.textAlign='left';ctx.fillText(labels[k].toUpperCase(),x+13,y+h-14);
 }
}
function addAudioSources(){
 if(!ui.audioCtx||!ui.audioDest)return;
 const streams=[state.call.stream,...state.call.remote.values()];
 for(const s of streams){
  for(const track of s?.getAudioTracks?.()||[]){
   if(track.readyState!=='live'||ui.audioTracks.has(track.id))continue;
   try{
    const source=ui.audioCtx.createMediaStreamSource(new MediaStream([track]));
    source.connect(ui.audioDest);ui.audioTracks.add(track.id);
   }catch(e){console.warn('Áudio para gravação:',e.message)}
  }
 }
}
function cleanup(){
 clearInterval(ui.paintTimer);clearInterval(ui.audioTimer);
 ui.paintTimer=null;ui.audioTimer=null;
 for(const t of ui.stream?.getTracks?.()||[])if(t.kind==='video')t.stop();
 ui.audioCtx?.close().catch(()=>{});
 ui.audioCtx=null;ui.audioDest=null;ui.audioTracks.clear();ui.stream=null;ui.canvas=null;ui.ctx=null;
 ui.recorder=null;ui.recording=null;ui.stopping=false;ui.pending=false;
 refreshButtons();
}
function bestMime(){
 if(!window.MediaRecorder)return null;
 for(const type of ['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm','video/mp4']){
  if(MediaRecorder.isTypeSupported(type))return type;
 }
 return null;
}
async function startRecording(){
 if(ui.pending||ui.recording)return;
 if(!master()||!inSession()||state.call.room!==sessionChannel()?.id)return talk('Só o Mestre, dentro da Sessão, pode iniciar a gravação.',true);
 const mime=bestMime();
 if(!mime||!HTMLCanvasElement.prototype.captureStream)return talk('Seu navegador não suporta gravação de vídeo pelo site.',true);
 ui.pending=true;refreshButtons();
 let serverRec=null;
 try{
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  ui.canvas=canvas;ui.ctx=canvas.getContext('2d',{alpha:false});
  if(!ui.ctx)throw Error('Canvas indisponível');
  paintRecording();
  const stream=canvas.captureStream(12);
  if(window.AudioContext||window.webkitAudioContext){
   try{
    ui.audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    await ui.audioCtx.resume();ui.audioDest=ui.audioCtx.createMediaStreamDestination();
    addAudioSources();if(ui.audioTracks.size)for(const t of ui.audioDest.stream.getAudioTracks())stream.addTrack(t);
   }catch(e){console.warn('Gravação sem áudio:',e.message);ui.audioCtx?.close().catch(()=>{});ui.audioCtx=null;ui.audioDest=null}
  }
  const opts={mimeType:mime,videoBitsPerSecond:550000,audioBitsPerSecond:65000};
  const recorder=new MediaRecorder(stream,opts);
  serverRec=await api('/api/session-recordings/start','POST',{serverId:state.server.id,mimeType:mime});
  ui.recording={id:serverRec.id,title:serverRec.title,mime};ui.recorder=recorder;ui.stream=stream;
  ui.partNo=0;ui.uploadError=null;ui.uploadQueue=Promise.resolve();ui.startedAt=Date.now();
  recorder.addEventListener('dataavailable',event=>{
   if(!event.data?.size)return;
   const part=ui.partNo++;
   ui.uploadQueue=ui.uploadQueue.then(async()=>{
    const bytes=await event.data.arrayBuffer();
    const reply=await fetch('/api/session-recordings/'+ui.recording.id+'/chunk?index='+part,{
      method:'POST',headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/octet-stream'},body:bytes
    });
    if(!reply.ok){const x=await reply.json().catch(()=>({}));throw new Error(x.error||'Erro ao salvar trecho da gravação')}
   }).catch(error=>{ui.uploadError ||= error;console.error('Gravação:',error);if(ui.recorder?.state==='recording')stopRecording()});
  });
  ui.paintTimer=setInterval(paintRecording,85);
  ui.audioTimer=setInterval(addAudioSources,1800);
  recorder.start(3500);
  ui.active=true;ui.pending=false;refreshButtons();
  talk('Gravação iniciada. Todos na Sessão verão o aviso.');
 }catch(err){
  if(serverRec?.id)api('/api/session-recordings/'+serverRec.id+'/abort','POST',{}).catch(()=>{});
  cleanup();talk('Não foi possível gravar: '+err.message,true);
 }
}
async function stopRecording(){
 if(!ui.recorder||!ui.recording||ui.stopping)return;
 ui.stopping=true;refreshButtons();
 const recorder=ui.recorder,id=ui.recording.id,duration=Date.now()-ui.startedAt;
 try{
  if(recorder.state!=='inactive'){
   const ended=new Promise(resolve=>recorder.addEventListener('stop',resolve,{once:true}));
   recorder.stop();await ended;
  }
  await ui.uploadQueue;
  if(ui.uploadError)throw ui.uploadError;
  await api('/api/session-recordings/'+id+'/finish','POST',{durationMs:duration});
  ui.active=false;talk('Gravação salva na área privada do Mestre!');
 }catch(err){
  await api('/api/session-recordings/'+id+'/abort','POST',{}).catch(()=>{});
  ui.active=false;talk('Gravação interrompida: '+err.message+'. Os trechos já enviados foram preservados.',true);
 }finally{cleanup();refreshStatus()}
}
async function getProtectedFile(id){
 const resp=await fetch('/api/session-recordings/'+id+'/file',{headers:{Authorization:'Bearer '+state.token}});
 if(!resp.ok){const d=await resp.json().catch(()=>({}));throw Error(d.error||'Não foi possível abrir a gravação.')}
 return resp.blob();
}
async function showGallery(){
 if(!master())return talk('Somente o Mestre pode acessar as gravações.',true);
 const result=await api('/api/session-recordings?serverId='+encodeURIComponent(state.server.id));
 const recordings=result.recordings||[];
 const rows=recordings.map(r=>{
  const name=String(r.title||'Sessão').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const duration=Math.round(Number(r.durationMs||0)/1000);
  const st=r.status==='salva'?'Salva':'Incompleta';
  return '<div class="session-record-row"><div><b>'+name+'</b><small>'+formatDate(r.createdAt)+' · '+niceBytes(Number(r.sizeBytes||0))+' · '+Math.floor(duration/60)+'m '+duration%60+'s · '+st+'</small></div><div class="session-record-buttons">'+(Number(r.sizeBytes)>0?'<button data-action="session-rec-view" data-id="'+r.id+'">▶ Assistir</button><button data-action="session-rec-download" data-id="'+r.id+'">↓ Baixar</button>':'<small>Sem trechos disponíveis</small>')+'</div></div>';
 }).join('');
 modal('<h2>▣ Gravações da Sessão</h2><p>Área privada do Mestre. Apenas sua conta pode acessar ou baixar os vídeos gravados no site.</p><p class="subtle">São salvos no banco de dados, com limite de 200 MB por gravação. A versão gratuita do banco tem espaço limitado.</p><div class="session-record-list">'+(rows||'<p>Nenhuma gravação ainda. Entre na Sessão e clique em “Gravar Sessão”.</p>')+'</div>');
}
async function viewFile(id,download){
 if(!master())return;
 talk('Carregando gravação protegida...');
 const blob=await getProtectedFile(id);
 if(ui.galleryUrl){URL.revokeObjectURL(ui.galleryUrl);ui.galleryUrl=null}
 const url=URL.createObjectURL(blob);
 if(download){
  const a=document.createElement('a');a.href=url;a.download='sinalis-sessao-'+id+(blob.type.startsWith('video/mp4')?'.mp4':'.webm');
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);
  talk('Download iniciado.');return;
 }
 ui.galleryUrl=url;
 modal('<h2>▶ Gravação da Sessão</h2><video class="session-record-player" controls playsinline src="'+url+'"></video><p>Somente o Mestre pode reproduzir este vídeo.</p><div class="modal-footer"><button data-action="session-rec-gallery">Voltar às gravações</button></div>');
}
async function doAction(btn){
 switch(btn.dataset.action){
  case 'session-chat-toggle':ui.hidden=!ui.hidden;localStorage.setItem('sinalis-sessao-hide-chat',ui.hidden?'1':'0');refreshButtons();break;
  case 'session-rec-start':await startRecording();break;
  case 'session-rec-stop':await stopRecording();break;
  case 'session-rec-gallery':await showGallery();break;
  case 'session-rec-view':await viewFile(btn.dataset.id,false);break;
  case 'session-rec-download':await viewFile(btn.dataset.id,true);break;
 }
}
document.addEventListener('click',event=>{
 const btn=event.target.closest('[data-action^="session-"]');
 if(!btn)return;
 event.preventDefault();event.stopPropagation();
 doAction(btn).catch(e=>{console.error(e);talk(e.message,true)});
},true);
setInterval(()=>{if(inSession())decorateSession();if(ui.recording&&(!inSession()||state.call.room!==sessionChannel()?.id))stopRecording()},7000);
window.SinalisV17={decorateSession,bindEvents,showGallery,refreshStatus,stopRecording};
})();
