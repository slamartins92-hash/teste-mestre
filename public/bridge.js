(()=>{'use strict';
const mirror=new URLSearchParams(location.search).has('mirror');
const device=document.getElementById('device'),glass=device?.querySelector('.glass');
if(!device||!glass)return;
const nodes=[...device.querySelectorAll('*')];
nodes.forEach((el,i)=>el.dataset.argIndex=String(i));
const byIndex=new Map(nodes.map((el,i)=>[String(i),el]));
const css=document.createElement('style');
css.textContent='.arg-fx{position:absolute;inset:0;z-index:998;pointer-events:none;overflow:hidden;border-radius:inherit}.arg-void{position:absolute;left:50%;top:50%;width:160px;height:160px;border-radius:47%;transform:translate(-50%,-50%);background:radial-gradient(ellipse,#000 0 22%,#050607 48%,#07090ab0 70%,transparent 88%);filter:blur(2px);display:none;animation:voidbreath 5s infinite alternate}.arg-msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:white;font:700 22px/1.3 system-ui;text-shadow:0 2px 4px black,0 0 10px black;text-align:center;white-space:pre-wrap;overflow-wrap:anywhere;max-width:90%;display:none}.arg-notify{position:absolute;top:42px;left:12px;right:12px;border-radius:16px;padding:13px;background:#252830ef;color:white;border:1px solid #ffffff33;display:none;box-shadow:0 8px 28px #000b;font:12px/1.5 system-ui}.arg-notify strong{display:block;font-size:14px}.arg-glitch{position:absolute;inset:0;display:none;background:repeating-linear-gradient(0deg,transparent 0 4px,#fff3 5px 6px),linear-gradient(100deg,#f006,transparent,#0ff4);mix-blend-mode:screen;animation:argshake .09s steps(2) infinite}@keyframes argshake{to{transform:translate(5px,-3px)}}@keyframes voidbreath{to{filter:blur(6px);border-radius:55% 48% 42% 61%}}.arg-spectator{position:fixed;inset:0;z-index:10000;background:#08090df5;color:white;display:none;align-items:center;justify-content:center;padding:30px;text-align:center;font:14px/1.6 system-ui}.arg-spectator.on{display:flex}';
document.head.append(css);
const fx=document.createElement('div');fx.className='arg-fx';
fx.innerHTML='<div class="arg-void"></div><div class="arg-msg"></div><div class="arg-notify"><strong></strong><p></p></div><div class="arg-glitch"></div>';
glass.append(fx);
const voidEl=fx.querySelector('.arg-void'),msgEl=fx.querySelector('.arg-msg'),notifyEl=fx.querySelector('.arg-notify'),glitchEl=fx.querySelector('.arg-glitch');
let notifyTimer,glitchTimer;
function applyEffects(s){
 if(!s)return;const v=s.void,m=s.message,n=s.notification;
 voidEl.style.display=v?'block':'none';
 if(v){voidEl.style.left=v.x+'%';voidEl.style.top=v.y+'%';voidEl.style.width=v.size*3+'px';voidEl.style.height=v.size*3+'px';}
 msgEl.style.display=m?'block':'none';
 if(m){msgEl.textContent=m.text;msgEl.style.left=m.x+'%';msgEl.style.top=m.y+'%';msgEl.style.fontSize=m.size+'px';}
 if(n&&n.id!==notifyEl.dataset.id){
  notifyEl.dataset.id=n.id;notifyEl.querySelector('strong').textContent=n.title;notifyEl.querySelector('p').textContent=n.message;
  notifyEl.style.display='block';clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>notifyEl.style.display='none',6500);
 }else if(!n){clearTimeout(notifyTimer);notifyEl.style.display='none';notifyEl.dataset.id='';}
}
function render(items){
 if(!items)return;
 for(const [key,s] of Object.entries(items)){
  const el=byIndex.get(key);if(!el||!s)continue;
  if(s.c!==undefined&&typeof el.className==='string')el.className=s.c;
  if(s.st!==undefined)el.setAttribute('style',s.st);
  if(s.t!==undefined&&el.children.length===0)el.textContent=s.t;
  if(s.v!==undefined&&('value' in el))el.value=s.v;
  if(s.s!==undefined)el.scrollTop=s.s;
 }
}
if(mirror){
 window.addEventListener('message',e=>{
  if(e.origin!==location.origin||e.source!==window.parent)return;
  if(e.data?.type==='arg-ping')window.parent.postMessage({type:'arg-ready'},location.origin);
  if(e.data?.type==='arg-mirror')render(e.data.items);
  if(e.data?.type==='arg-effects')applyEffects(e.data.effects);
 });
 document.querySelectorAll('button,input,textarea').forEach(el=>el.style.pointerEvents='none');
 window.parent.postMessage({type:'arg-ready'},location.origin);
 return;
}
const spectator=document.createElement('div');spectator.className='arg-spectator';spectator.textContent='O celular está sendo usado em outra sessão.';document.body.append(spectator);
let last=new Map(),stream=null,active=false,queued=false;
function takeSnapshot(force=false){
 const changes={};
 for(let i=0;i<nodes.length;i++){
  const el=nodes[i];if(!el.isConnected)continue;
  const s={};
  if(typeof el.className==='string')s.c=el.className;
  const style=el.getAttribute('style');if(style)s.st=style;
  if(el.children.length===0&&el.textContent)s.t=el.textContent.slice(0,500);
  if('value' in el&&el.value&&el.matches('input:not([type=password]),textarea'))s.v=String(el.value).slice(0,250);
  if(el.scrollTop>0)s.s=el.scrollTop;
  const j=JSON.stringify(s);
  if(force||j!==last.get(i)){changes[String(i)]=s;last.set(i,j);}
 }
 return changes;
}
const post=async(url,data)=>{
 const r=await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 if(!r.ok)throw Error(url+' '+r.status);return r.json();
};
async function sync(force=false){
 if(!active||queued)return;queued=true;
 try{await post('/api/player/sync',{changes:takeSnapshot(force),info:window.__ARG_LOCAL_CONTROLS__?.info?.()||{app:'bloqueio',unlocked:false,power:true}});}catch(e){}finally{queued=false;}
}
function at(x,y){const b=glass.getBoundingClientRect();return document.elementFromPoint(b.left+b.width*x,b.top+b.height*y);}
function remoteCommand(c){
 if(!active)return;
 if(c.type==='navigate')try{window.__ARG_LOCAL_CONTROLS__?.navigate?.(c.target);}catch(e){}
 if(c.type==='pointer'){const t=at(c.x,c.y);if(t){if(c.phase==='down')t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:46}));if(c.phase==='up'){t.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:46}));t.click();}}}
 if(c.type==='scroll'){const all=[...document.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+15&&el.closest('#device'));const el=all.sort((a,b)=>a.clientHeight-b.clientHeight)[0];if(el)el.scrollTop+=c.delta;}
 if(c.type==='type'){const el=document.activeElement;if(el&&'value' in el){el.value=String(c.text||'');el.dispatchEvent(new Event('input',{bubbles:true}));}}
 if(c.type==='glitch'){glitchEl.style.display='block';clearTimeout(glitchTimer);glitchTimer=setTimeout(()=>glitchEl.style.display='none',c.duration||1000);}
 setTimeout(()=>sync(true),150);
}
async function join(){
 try{
  const r=await post('/api/player/join',{});active=!!r.active;spectator.classList.toggle('on',!active);
  if(active){await sync(true);setInterval(()=>sync(),650);}
  stream?.close();stream=new EventSource('/api/player/stream');
  stream.addEventListener('role',e=>{const data=JSON.parse(e.data);active=!!data.active;spectator.classList.toggle('on',!active);});
  stream.addEventListener('effects',e=>{try{applyEffects(JSON.parse(e.data));}catch{}});
  stream.addEventListener('command',e=>{try{remoteCommand(JSON.parse(e.data));}catch{}});
 }catch(e){spectator.classList.add('on');spectator.textContent='Sem conexão ao servidor.';}
}
join();
})();