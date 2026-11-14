(()=>{'use strict';
const mirror=new URLSearchParams(location.search).has('mirror');
const device=document.getElementById('device'),glass=device?.querySelector('.glass');
if(!device||!glass)return;
// Inclui o elemento raiz: sua classe .unlocked controla a exibição de todas as telas.
const nodes=[device,...device.querySelectorAll('*')];
nodes.forEach((el,i)=>el.dataset.argIndex=String(i));
const byIndex=new Map(nodes.map((el,i)=>[String(i),el]));
const css=document.createElement('style');
css.textContent='.arg-fx{position:absolute;inset:0;z-index:998;pointer-events:none;overflow:hidden;border-radius:inherit}.arg-void{position:absolute;left:50%;top:50%;width:160px;height:160px;border-radius:47%;transform:translate(-50%,-50%);background:radial-gradient(ellipse,#000 0 22%,#050607 48%,#07090ab0 70%,transparent 88%);filter:blur(2px);display:none;animation:voidbreath 5s infinite alternate}.arg-msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:white;font:700 22px/1.3 system-ui;text-shadow:0 2px 4px black,0 0 10px black;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;max-width:90%;display:none}.arg-notify{position:absolute;top:42px;left:12px;right:12px;border-radius:16px;padding:13px;background:#252830ef;color:white;border:1px solid #ffffff33;display:none;box-shadow:0 8px 28px #000b;font:12px/1.5 system-ui}.arg-notify strong{display:block;font-size:14px}.arg-glitch{position:absolute;inset:0;display:none;background:repeating-linear-gradient(0deg,transparent 0 4px,#fff3 5px 6px),linear-gradient(100deg,#f006,transparent,#0ff4);mix-blend-mode:screen;animation:argshake .09s steps(2) infinite}@keyframes argshake{to{transform:translate(5px,-3px)}}@keyframes voidbreath{to{filter:blur(6px);border-radius:55% 48% 42% 61%}}.arg-spectator{position:fixed;inset:0;z-index:10000;background:#08090df5;color:white;display:none;align-items:center;justify-content:center;padding:30px;text-align:center;font:14px/1.6 system-ui}.arg-spectator.on{display:flex}';
css.textContent += '.arg-void.arg-shaped{left:0!important;top:0!important;width:100%!important;height:100%!important;border-radius:0!important;transform:none!important;background:#000!important;filter:blur(3px);animation:arg-shaped-pulse 2.6s ease-in-out infinite alternate}@keyframes arg-shaped-pulse{0%{opacity:.72;filter:blur(4px)}100%{opacity:1;filter:blur(10px)}}.arg-void:not(.arg-shaped){animation:arg-circle-pulse 2.6s ease-in-out infinite alternate}@keyframes arg-circle-pulse{to{transform:translate(-50%,-50%) scale(1.15);filter:blur(6px)}}';
document.head.append(css);
const fx=document.createElement('div');fx.className='arg-fx';
fx.innerHTML='<div class="arg-void"></div><div class="arg-msg"></div><div class="arg-notify"><strong></strong><p></p></div><div class="arg-glitch"></div>';
glass.append(fx);
const voidEl=fx.querySelector('.arg-void'),msgEl=fx.querySelector('.arg-msg'),notifyEl=fx.querySelector('.arg-notify'),glitchEl=fx.querySelector('.arg-glitch');
let notifyTimer,glitchTimer;
function applyEffects(s){
 if(!s)return;const v=s.void,m=s.message,n=s.notification;
 const corners=!!v&&v.mode==='corners';
 voidEl.style.display=v&&!corners?'block':'none';
 if(v&&!corners){
   const polygon=Array.isArray(v.points)&&v.points.length>=3;
   voidEl.classList.toggle('arg-shaped',polygon);
   if(polygon){
    voidEl.style.clipPath='polygon('+v.points.map(p=>p[0]+'% '+p[1]+'%').join(',')+')';
    voidEl.style.left='0';voidEl.style.top='0';voidEl.style.width='100%';voidEl.style.height='100%';
   }else{
    voidEl.style.clipPath='';
    voidEl.style.left=v.x+'%';voidEl.style.top=v.y+'%';voidEl.style.width=v.size*3+'px';voidEl.style.height=v.size*3+'px';
   }
 }else{voidEl.classList.remove('arg-shaped');voidEl.style.clipPath='';}
 msgEl.style.display=m?'block':'none';
 if(m){msgEl.textContent=m.text;msgEl.style.left=m.x+'%';msgEl.style.top=m.y+'%';msgEl.style.fontSize=m.size+'px';}
 if(n&&n.id!==notifyEl.dataset.id){
  notifyEl.dataset.id=n.id;notifyEl.querySelector('strong').textContent=n.title;notifyEl.querySelector('p').textContent=n.message;
  notifyEl.style.display='block';clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>notifyEl.style.display='none',6500);
 }else if(!n){clearTimeout(notifyTimer);notifyEl.style.display='none';notifyEl.dataset.id='';}
 window.__ARG_PHASE2__?.apply?.(s);
}
function render(items){
 if(!items)return;
 for(const [key,s] of Object.entries(items)){
  const el=byIndex.get(key);if(!el||!s)continue;
  if(s.c!==undefined&&typeof el.className==='string')el.className=s.c;
  if(s.st!==undefined)el.style.cssText=s.st;
  if(s.h!==undefined){if(s.h===null)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden',s.h);}
  if(s.t!==undefined&&el.children.length===0)el.textContent=s.t;
  if(s.v!==undefined&&('value' in el)&&el.type!=='password')el.value=s.v;
  if(s.s!==undefined)el.scrollTop=s.s;
  if(s.sl!==undefined)el.scrollLeft=s.sl;
 }
}
if(mirror){
 document.body.classList.add('arg-master-mirror');
 const masterSize=document.createElement('style');
 masterSize.textContent='body.arg-master-mirror .stage{padding:6px;min-height:100svh}body.arg-master-mirror .device{width:min(555px,calc(100vw - 16px),calc((100svh - 18px) * .477))!important}';
 document.head.append(masterSize);
 window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==window.parent)return;
  if(e.data?.type==='arg-ping')window.parent.postMessage({type:'arg-ready'},location.origin);
  if(e.data?.type==='arg-mirror')render(e.data.items);
  if(e.data?.type==='arg-effects')applyEffects(e.data.effects);
  if(e.data?.type==='arg-canvas'){
    const d=e.data,canvas=document.getElementById(d.id);
    if(!canvas||typeof d.src!=='string')return;
    const img=new Image();img.onload=()=>{canvas.width=img.width;canvas.height=img.height;canvas.getContext('2d').drawImage(img,0,0);};img.src=d.src;
  }
 });
 document.querySelectorAll('button,input,textarea').forEach(el=>el.style.pointerEvents='none');
 window.parent.postMessage({type:'arg-ready'},location.origin);
 return;
}
const spectator=document.createElement('div');spectator.className='arg-spectator';spectator.textContent='O celular está sendo usado em outra sessão.';document.body.append(spectator);
let last=new Map(),stream=null,active=false,queued=false,interval=null,lastInfo='',lastGallery='';
function getInfo(){return window.__ARG_LOCAL_CONTROLS__?.info?.()||{app:'bloqueio',unlocked:false,power:true};}
function takeChanges(force=false){
 const changes=[];
 for(let i=0;i<nodes.length;i++){
  const el=nodes[i];if(!el.isConnected)continue;
  const o={};
  if(typeof el.className==='string')o.c=el.className;
  o.st=el.style?.cssText||'';
  o.h=el.getAttribute('aria-hidden');
  if(el.children.length===0&&(el.textContent||'').length<2500)o.t=el.textContent||'';
  if(el.matches?.('input:not([type=password]),textarea,select'))o.v=String(el.value||'').slice(0,500);
  if(el.scrollHeight>el.clientHeight+6)o.s=Math.round(el.scrollTop);
  if(el.scrollWidth>el.clientWidth+6)o.sl=Math.round(el.scrollLeft);
  const sig=JSON.stringify(o);
  if(force||sig!==last.get(i))changes.push([i,o,sig]);
 }
 return changes;
}
const post=async(url,data)=>{
 const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!r.ok)throw Error(url+' '+r.status);return r.json();
};
async function sync(force=false){
 if(!active||queued)return;
 queued=true;
 try{
  const changes=takeChanges(force),info=getInfo(),infoSig=JSON.stringify(info);
  if(changes.length || infoSig!==lastInfo || force){
   // Envia em lotes para não ultrapassar o limite de tamanho do servidor.
   // Só marca como sincronizado DEPOIS do servidor confirmar cada lote.
   if(changes.length===0){
    await post('/api/player/sync',{changes:{},info});
   }else{
    let chunk={}, pending=[],bytes=0;
    const flush=async()=>{
     if(!pending.length)return;
     await post('/api/player/sync',{changes:chunk,info});
     for(const [i,o,sig] of pending)last.set(i,sig);
     chunk={};pending=[];bytes=0;
    };
    for(const entry of changes){
     const [i,o]=entry;
     const extra=JSON.stringify(o).length+String(i).length+6;
     if(pending.length>=100 || bytes+extra>42000)await flush();
     chunk[String(i)]=o;pending.push(entry);bytes+=extra;
    }
    await flush();
   }
   lastInfo=infoSig;
  }
  if(info.app==='gallery'){
   const canvas=document.getElementById('gallery-main-canvas');
   if(canvas?.width>2&&canvas.height>2){
    const signature=['gallery-brightness','gallery-saturation','gallery-hue','gallery-contrast','gallery-header-title'].map(k=>document.getElementById(k)?.value||document.getElementById(k)?.textContent||'').join('|');
    if(signature!==lastGallery){
     lastGallery=signature;
     try{const src=canvas.toDataURL('image/webp',0.45);if(src.length<210000)await post('/api/player/canvas',{id:'gallery-main-canvas',src});}catch{}
    }
   }
  }else lastGallery='';
 }catch(err){/* Mantém os itens não confirmados para tentar novamente. */}
 finally{queued=false;}
}
function setRole(next){
 const old=active;active=!!next;spectator.classList.toggle('on',!active);
 if(active&&!interval){last.clear();lastInfo='';interval=setInterval(()=>sync(),700);sync(true);}
 if(!active&&interval){clearInterval(interval);interval=null;}
}
function at(x,y){
 const b=glass.getBoundingClientRect();
 return document.elementFromPoint(b.left+b.width*x,b.top+b.height*y);
}
let pressed=null;
function remoteTarget(c,x,y){
 let target=null;
 if(c.targetId)target=document.getElementById(c.targetId);
 if(!target&&Number.isInteger(c.targetIndex))target=byIndex.get(String(c.targetIndex));
 if(!target?.isConnected || !target.getClientRects().length || getComputedStyle(target).visibility==='hidden'){
  target=document.elementFromPoint(x,y);
 }
 return target||glass;
}
function remotePointer(c){
 const b=glass.getBoundingClientRect(),x=b.left+b.width*c.x,y=b.top+b.height*c.y;
 const target=remoteTarget(c,x,y);
 const evt=new PointerEvent('pointer'+c.phase,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:51,isPrimary:true,clientX:x,clientY:y});
 if(c.phase==='down'){
  pressed={x,y,target};
  target.dispatchEvent(evt);
 }
 if(c.phase==='move'){
  // O gesto de desbloqueio escuta o evento no window.
  window.dispatchEvent(evt);
 }
 if(c.phase==='up'){
  target.dispatchEvent(evt);window.dispatchEvent(evt);
  if(pressed&&Math.hypot(x-pressed.x,y-pressed.y)<18){
   const original=pressed.target;
   const clickable=(original?.closest?.('button,a,input,textarea,select,[role="button"]'))||
                   (target?.closest?.('button,a,input,textarea,select,[role="button"]'));
   if(clickable){clickable.focus?.();clickable.click?.();}
   else (original||target).click?.();
  }
  pressed=null;
 }
}
function remoteCommand(c){
 if(!active)return;
 try{
  if(c.type==='navigate')window.__ARG_LOCAL_CONTROLS__?.navigate?.(c.target);
  if(c.type==='pointer')remotePointer(c);
  if(c.type==='scroll'){
   let hit;
   if(Number.isFinite(c.x)&&Number.isFinite(c.y))hit=at(c.x,c.y);
   const scrollable=e=>e&&e.scrollHeight>e.clientHeight+12&&['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.getClientRects().length;
   let found=null;
   while(hit&&hit!==glass){if(scrollable(hit)){found=hit;break;}hit=hit.parentElement;}
   if(!found){
    for(const q of ['#sinaiszap-extra-chat-body','#sinaiszap-chat-body','.sinaiszap-chat-body','.gallery-content','.google-page','#unlocked-panel']){
     const el=glass.querySelector(q);if(scrollable(el)){found=el;break;}
    }
   }
   if(found)found.scrollTop+=c.delta;
  }
  if(c.type==='type'){const el=document.activeElement;
   if(el&&('value' in el)){el.value+=String(c.text||'');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}}
  if(c.type==='glitch'){glitchEl.style.display='block';clearTimeout(glitchTimer);glitchTimer=setTimeout(()=>glitchEl.style.display='none',c.duration||1000);}
  if(c.type==='crack')window.__ARG_PHASE2__?.crackSound?.(c.level);
  if(c.type==='break-all'){window.__ARG_PHASE2__?.crackSound?.(4);window.__ARG_PHASE2__?.animateBreak?.();}
  if(c.type!=='pointer'||c.phase==='up')setTimeout(()=>sync(),140);
 }catch(err){/* Comando isolado: não interrompe os comandos seguintes. */}
}
async function join(){
 try{
  const r=await post('/api/player/join',{});setRole(r.active);
  stream?.close();stream=new EventSource('/api/player/stream');
  stream.addEventListener('role',e=>{const data=JSON.parse(e.data);setRole(data.active);});
  stream.addEventListener('effects',e=>{try{applyEffects(JSON.parse(e.data));}catch{}});
  stream.addEventListener('command',e=>{try{remoteCommand(JSON.parse(e.data));}catch{}});
 }catch(e){spectator.classList.add('on');spectator.textContent='Sem conexão ao servidor.';}
}
join();
})();