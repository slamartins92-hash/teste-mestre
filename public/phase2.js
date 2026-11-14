(()=>{'use strict';
const mirror=new URLSearchParams(location.search).has('mirror');
const app=document.getElementById('sinaiszap-screen'),glass=document.querySelector('#device .glass');
if(!app||!glass)return;
const old02=app.querySelector('.sinaiszap-extra-contact[data-contact-number="02"]');
const portal=document.createElement('section');
portal.id='arg-secret-portal';portal.className='arg-secret-portal';portal.setAttribute('aria-hidden','true');
portal.innerHTML='<header class="arg-secret-header"><b>SinaisZap</b><small>2 conversas</small></header><p class="arg-secret-subtitle">Conversas recuperadas</p><div id="arg-secret-entries"></div><p class="arg-secret-footer">Histórico parcialmente recuperado</p>';
app.append(portal);
const entries=portal.querySelector('#arg-secret-entries');
if(old02){
 const title=old02.querySelector('.sinaiszap-blocked-name');
 if(title)title.innerHTML='<span>Contato bloqueado</span><span class="arg-secret-flash">Irmazinha&lt;3</span><small>Mensagens de 2025 recuperadas</small>';
 entries.append(old02);
}
const v4=document.createElement('button');v4.type='button';v4.id='arg-v4';
v4.className='sinaiszap-blocked-contact arg-v4-contact';
v4.innerHTML='<span class="sinaiszap-blocked-avatar">V</span><span class="sinaiszap-blocked-name">V4<small>Arquivo de conversa</small></span><span class="sinaiszap-contact-id">V4</span>';
entries.append(v4);
const extra=app.querySelector('#sinaiszap-extra-chat'),back=app.querySelector('#sinaiszap-extra-back');
const extraName=extra?.querySelector('.sinaiszap-chat-identity strong');
let secretActive=false;
const displayPortal=()=>{const show=secretActive&&!portal.classList.contains('arg-in-chat');portal.classList.toggle('arg-visible',show);portal.setAttribute('aria-hidden',String(!show));};
old02?.addEventListener('click',()=>{if(secretActive){if(extraName)extraName.textContent='Contato bloqueado';portal.classList.add('arg-in-chat');displayPortal();}});
v4.addEventListener('click',()=>{
 if(!secretActive||!app.classList.contains('is-open')||!extra)return;
 app.querySelector('#sinaiszap-chat')?.classList.remove('is-open');
 app.querySelector('#sinaiszap-owner-profile')?.classList.remove('is-open');
 if(extraName)extraName.textContent='V4';
 app.querySelector('#sinaiszap-extra-id').textContent='V4 · Contato recuperado';
 app.querySelector('#sinaiszap-extra-empty').hidden=false;
 app.querySelector('#sinaiszap-extra-maria').hidden=true;
 extra.classList.add('is-open');extra.setAttribute('aria-hidden','false');
 portal.classList.add('arg-in-chat');displayPortal();
});
back?.addEventListener('click',()=>{portal.classList.remove('arg-in-chat');displayPortal();});
let soundCtx,bugTimer,bugHold,bugMode='',blackTimer;
const layer=document.createElement('div');layer.id='arg-damage-layer';layer.className='arg-damage-layer';
layer.innerHTML='<div class="arg-corner-void"></div><svg class="arg-damage-svg" viewBox="0 0 390 818" preserveAspectRatio="none" aria-hidden="true"><g class="arg-crack-first"><path d="M179 0L187 80 170 133 194 199 170 265 200 330 182 390M194 199L238 215 263 248M170 265L121 291 109 337"/></g><g class="arg-crack-second"><path d="M0 190L78 223 122 260 195 327 262 359 390 385M390 60L334 121 294 187 244 249 199 327 160 430 100 538 19 648M390 292L327 324 276 394 201 472 176 551 108 683 29 818M160 430L101 403 55 426M276 394L330 423 377 430"/></g><g class="arg-crack-third"><path d="M195 406L125 322 40 287 0 251M195 406L249 325 300 265 390 192M195 406L280 445 390 502M195 406L256 526 324 674 380 818M195 406L124 531 56 654 0 739M195 406L174 280 163 160 115 0"/></g><path class="arg-hole-border" d="M192 349L215 363 233 360 238 385 258 398 242 422 254 444 231 451 216 472 196 457 168 467 155 443 137 424 156 400 148 378 171 369Z"/><path class="arg-hole-black" d="M191 370L210 379 229 385 230 414 239 428 215 442 201 451 177 443 157 424 170 398 166 384Z"/></svg><div class="arg-screen-bug"></div><div class="arg-screen-blackout"></div>';
glass.append(layer);
const cracks=layer.querySelector('.arg-damage-svg'),corners=layer.querySelector('.arg-corner-void'),bug=layer.querySelector('.arg-screen-bug'),black=layer.querySelector('.arg-screen-blackout');
function pulseGlitch(){
 bug.classList.add('arg-active');
 clearTimeout(bugHold);bugHold=setTimeout(()=>bug.classList.remove('arg-active'),1500);
}
function manageBug(state){
 const interval=state?.enabled?Math.max(5000,Number(state.intervalMs)||10000):0;
 if(String(interval)===bugMode)return;
 bugMode=String(interval);clearInterval(bugTimer);clearTimeout(bugHold);bug.classList.remove('arg-active');
 if(interval)bugTimer=setInterval(pulseGlitch,interval);
}
function animateBreak(){
 black.classList.add('arg-active');
 clearTimeout(blackTimer);
 blackTimer=setTimeout(()=>{black.classList.remove('arg-active');pulseGlitch();},700);
}
function primeSound(){
 if(mirror)return;
 try{const A=window.AudioContext||window.webkitAudioContext;if(A&&!soundCtx)soundCtx=new A();if(soundCtx?.state==='suspended')soundCtx.resume().catch(()=>{});}catch{}
}
document.addEventListener('pointerdown',primeSound,{capture:true});
function crackSound(lvl){
 if(mirror)return;primeSound();
 if(!soundCtx||soundCtx.state!=='running')return;
 const level=Math.max(1,Math.min(4,Number(lvl)||1)),duration=[0,.22,.41,.7,1][level],t=soundCtx.currentTime+.01;
 const buffer=soundCtx.createBuffer(1,Math.ceil(soundCtx.sampleRate*duration),soundCtx.sampleRate),arr=buffer.getChannelData(0);
 for(let i=0;i<arr.length;i++)arr[i]=(Math.random()*2-1)*(Math.random()<.015?1.7:.75);
 const src=soundCtx.createBufferSource();src.buffer=buffer;
 const filter=soundCtx.createBiquadFilter();filter.type='highpass';filter.frequency.value=380;
 const env=soundCtx.createGain();env.gain.setValueAtTime(.0001,t);env.gain.linearRampToValueAtTime(.045+.024*level,t+.013);env.gain.exponentialRampToValueAtTime(.0001,t+duration);
 const comp=soundCtx.createDynamicsCompressor();comp.threshold.value=-15;comp.ratio.value=9;
 src.connect(filter);filter.connect(env);env.connect(comp);comp.connect(soundCtx.destination);src.start(t);src.stop(t+duration);
}
function apply(e){
 if(!e)return;
 const now=!!e.secret;
 if(secretActive!==now){
  const wasActive=secretActive;
  secretActive=now;portal.classList.remove('arg-in-chat');
  if(!mirror&&(now||(wasActive&&app.classList.contains('is-open'))))window.__ARG_LOCAL_CONTROLS__?.navigate?.('sinaiszap');
 }
 displayPortal();
 layer.dataset.level=String(Math.max(0,Math.min(3,Number(e.crack?.level)||0)));
 corners.classList.toggle('arg-active',!!e.cornersVoid);
 manageBug(e.bug);
}
window.__ARG_PHASE2__={apply,crackSound,animateBreak,pulseGlitch};
})();