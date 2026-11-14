(()=>{'use strict';
const $=id=>document.getElementById(id), login=$('login'),dashboard=$('dashboard'),frame=$('preview-frame'),cover=$('preview-cover'),marker=$('point-marker');
let stream=null,ready=false,mirror={},effects=null,latestCanvas=null,mode='control',x=50,y=50,down=false,toastTimer=null,online=false;
let voidPoints=[],marking=false;
const api=async (path,body)=>{
 const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const json=await response.json().catch(()=>({error:'Erro de conexão'}));
 if(!response.ok)throw Error(json.error||'Falha');return json;
};
const toast=(message,error=false)=>{
 const el=$('toast');el.textContent=message;el.style.borderColor=error?'#aa3755':'#454d59';el.classList.remove('hidden');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),3000);
};
async function send(body,note=''){
 try{const r=await api('/api/master/command',body);if(note)toast(note+(r.delivered?'':' · aguardando celular'));return r;}
 catch(e){toast(e.message,true);return null;}
}
function postFrame(type,props={}){if(ready)frame.contentWindow?.postMessage({type,...props},location.origin);}
function show(){
 login.classList.add('hidden');dashboard.classList.remove('hidden');
 if(!stream)connect();
 if(frame.getAttribute('src')!=='/?mirror=1&v=p2b')frame.setAttribute('src','/?mirror=1&v=p2b');
}
async function check(){
 try{const r=await fetch('/api/master/me',{credentials:'same-origin'});const d=await r.json();
 if(d.authorized)show();else{login.classList.remove('hidden');dashboard.classList.add('hidden');}}
 catch(e){toast('Servidor indisponível',true);}
}
$('login-form').addEventListener('submit',async ev=>{
 ev.preventDefault();$('login-error').textContent='';
 try{await api('/api/master/login',{password:$('pass').value});$('pass').value='';show();}
 catch(e){$('login-error').textContent=e.message;}
});
$('logout').addEventListener('click',async()=>{await api('/api/master/logout',{});stream?.close();stream=null;ready=false;check();});
frame.addEventListener('load',()=>{ready=false;setTimeout(()=>frame.contentWindow?.postMessage({type:'arg-ping'},location.origin),180);});
window.addEventListener('message',ev=>{
 if(ev.origin!==location.origin||ev.source!==frame.contentWindow)return;
 if(ev.data?.type==='arg-ready'){ready=true;postFrame('arg-mirror',{items:mirror});if(effects)postFrame('arg-effects',{effects});if(latestCanvas)postFrame('arg-canvas',latestCanvas);}
});
function updateInfo(v){
 if(!v)return;const names={home:'Início',bloqueio:'Bloqueio',settings:'Configurações',phone:'Telefone',google:'Zoogle',gallery:'Galeria',sinaiszap:'SinaisZap',calculator:'Calculadora'};
 $('app-label').textContent=v.power===false?'Desligado':v.unlocked===false?'Bloqueio':(names[v.app]||v.app)+(v.chat?' · '+v.chat:'');
}
function log(message,date=Date.now()){
 const el=document.createElement('div'),tm=document.createElement('time');el.className='log-entry';
 tm.textContent=new Date(date).toLocaleTimeString('pt-BR');el.append(tm,document.createTextNode(message));
 $('log').prepend(el);while($('log').children.length>45)$('log').lastElementChild.remove();
}
function connect(){
 stream=new EventSource('/api/master/stream');
 stream.addEventListener('status',ev=>{
  const d=JSON.parse(ev.data);online=!!d.online;$('online-dot').classList.toggle('online',online);
  $('online-label').textContent=online?'Celular conectado':'Aguardando celular';updateInfo(d.info);
 });
 stream.addEventListener('mirror',ev=>{
  const d=JSON.parse(ev.data);
  if(d.reset){mirror=d.items||{};postFrame('arg-mirror',{items:mirror});}
  else{Object.assign(mirror,d.changes||{});postFrame('arg-mirror',{items:d.changes||{}});}
  updateInfo(d.info);$('mirror-status').textContent='Sincronizado';
 });
 stream.addEventListener('effects',ev=>{
  effects=JSON.parse(ev.data);postFrame('arg-effects',{effects});
  $('secret-status').textContent=effects.secret?'Área secreta liberada · #02 e V4':'Área secreta desativada';
  const lvl=effects.crack?.level||0;
  $('damage-status').textContent=(lvl?'Nível '+lvl+' de rachadura':'Tela intacta')+
   (effects.cornersVoid?' · Vazio da quebra completa ativo':'')+
   (effects.bug?.enabled?' · Bug a cada '+((effects.bug.intervalMs||10000)/1000)+'s':'');
  const v=effects.void;
  $('void-status').textContent=v?(v.mode==='corners'?'Vazio ativo: nível '+v.level+' nos quatro cantos.':'Vazio personalizado ativo.'):'Vazio desativado.';
 });
 stream.addEventListener('canvas',ev=>{latestCanvas=JSON.parse(ev.data);postFrame('arg-canvas',latestCanvas);});
 stream.addEventListener('activity',ev=>{const d=JSON.parse(ev.data);log(d.event,d.at);});
 stream.onerror=()=>{$('mirror-status').textContent='Reconectando';};
}
function phoneRect(){
 try {
  const f=frame.getBoundingClientRect(),win=frame.contentWindow,doc=frame.contentDocument;
  if(!win||!doc)return null;
  const glass=doc.querySelector('#device .glass')||doc.querySelector('.glass')||doc.querySelector('#device');
  const g=glass?.getBoundingClientRect();
  if(!g)return null;
  const sx=f.width/Math.max(win.innerWidth,1),sy=f.height/Math.max(win.innerHeight,1);
  return {left:f.left+g.left*sx,top:f.top+g.top*sy,width:g.width*sx,height:g.height*sy};
 }catch(e){return null;}
}
function pointer(ev){
 const r=phoneRect();
 return r?{x:Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(ev.clientY-r.top)/r.height))}:null;
}
function mirroredTarget(ev){
 try{
  const b=frame.getBoundingClientRect();
  const scaleX=frame.contentWindow.innerWidth/b.width, scaleY=frame.contentWindow.innerHeight/b.height;
  const hit=frame.contentDocument.elementFromPoint((ev.clientX-b.left)*scaleX,(ev.clientY-b.top)*scaleY);
  if(!hit)return {};
  const target=hit.closest?.('button,a,input,textarea,select,[role="button"]')||hit;
  const i=target.dataset?.argIndex;
  return {
   ...(target.id?{targetId:target.id}:{}),
   ...(i!==undefined&&/^\d+$/.test(i)?{targetIndex:Number(i)}:{})
  };
 }catch{return {};}
}
function markerPosition(){
 if(mode!=='place'){marker.style.display='none';return;}
 const r=phoneRect(),b=cover.getBoundingClientRect();if(!r)return;
 marker.style.display='block';marker.style.left=(r.left-b.left+x/100*r.width)+'px';marker.style.top=(r.top-b.top+y/100*r.height)+'px';
}
function setPos(a,b){
 x=Math.max(5,Math.min(95,Math.round(a*100)));y=Math.max(8,Math.min(92,Math.round(b*100)));
 $('pos-x').value=x;$('pos-y').value=y;$('pos-x-value').textContent=x+'%';$('pos-y-value').textContent=y+'%';
 $('position-label').textContent=x+'%, '+y+'%';markerPosition();
}

function drawVoidOutline(){
 const svg=$('void-draw-layer'),polygon=$('void-draw-shape'),b=cover.getBoundingClientRect(),r=phoneRect();
 if(!svg||!polygon||!r)return;
 svg.setAttribute('viewBox','0 0 '+Math.max(1,b.width)+' '+Math.max(1,b.height));
 polygon.setAttribute('points',voidPoints.map(p=>((r.left-b.left)+p[0]*r.width)+' '+((r.top-b.top)+p[1]*r.height)).join(' '));
 $('void-mark-info').textContent=voidPoints.length<3?'Arraste sobre o celular para desenhar um contorno.':'Área marcada: '+voidPoints.length+' pontos. Aperte Fazer Vazio aparecer.';
}
function addVoidPoint(ev,force=false){
 const p=pointer(ev);if(!p)return;
 if(force||!voidPoints.length||Math.hypot(p.x-voidPoints[voidPoints.length-1][0],p.y-voidPoints[voidPoints.length-1][1])>.015){
  if(voidPoints.length<68)voidPoints.push([p.x,p.y]);
  drawVoidOutline();
 }
}
function selectMode(next){
 mode=next;
 cover.classList.toggle('control',next==='control');
 $('preview-card').classList.toggle('arg-mark-mode',next==='mark');
 for(const key of ['place','control','mark'])$('mode-'+key).classList.toggle('active',key===next);
 markerPosition();drawVoidOutline();
}
$('mode-place').onclick=()=>selectMode('place');
$('mode-control').onclick=()=>selectMode('control');
$('mode-mark').onclick=()=>{selectMode('mark');$('void-level').value='custom';refreshVoidMode();};
$('void-mark-clear').onclick=()=>{voidPoints=[];drawVoidOutline();};
let queue=Promise.resolve();
function doPointer(ev,phase){
 const p=pointer(ev);if(!p)return;
 if(mode==='place'&&phase==='up')setPos(p.x,p.y);
 if(mode==='control'){
  const hit=mirroredTarget(ev);
  queue=queue.then(()=>send({type:'pointer',phase,x:p.x,y:p.y,...hit})).catch(()=>{});
 }
}
cover.addEventListener('pointerdown',ev=>{
 if(ev.button!==undefined&&ev.button!==0)return;
 down=true;
 try{cover.setPointerCapture(ev.pointerId);}catch(e){}
 if(mode==='mark'){voidPoints=[];marking=true;addVoidPoint(ev,true);drawVoidOutline();}
 else doPointer(ev,'down');
 ev.preventDefault();
});
let lastMoveAt=0;
cover.addEventListener('pointermove',ev=>{
 if(!down)return;
 if(mode==='mark'){if(marking)addVoidPoint(ev);ev.preventDefault();return;}
 if(mode!=='control')return;
 const now=performance.now();
 if(now-lastMoveAt>=65){lastMoveAt=now;doPointer(ev,'move');}
 ev.preventDefault();
});
cover.addEventListener('pointerup',ev=>{
 if(mode==='mark'){addVoidPoint(ev);marking=false;drawVoidOutline();}
 else doPointer(ev,'up');
 down=false;
 if(cover.hasPointerCapture(ev.pointerId))cover.releasePointerCapture(ev.pointerId);
});
cover.addEventListener('pointercancel',()=>{marking=false;down=false;});
cover.addEventListener('wheel',ev=>{if(mode==='control'){ev.preventDefault();const p=pointer(ev);send({type:'scroll',delta:Math.max(-650,Math.min(650,ev.deltaY)),...(p||{})});}},{passive:false});
window.addEventListener('resize',()=>{markerPosition();drawVoidOutline();});
$('pos-x').oninput=()=>setPos(Number($('pos-x').value)/100,y/100);
$('pos-y').oninput=()=>setPos(x/100,Number($('pos-y').value)/100);
for(const id of ['message-size','void-size'])$(id).oninput=()=>$ (id+'-value').textContent=$(id).value+(id==='message-size'?' px':'%');
$('app-grid').onclick=ev=>{const b=ev.target.closest('button[data-screen]');if(b)send({type:'navigate',target:b.dataset.screen},'Tela alterada');};
$('scroll-up').onclick=()=>send({type:'scroll',delta:-470,x:.5,y:.65});
$('scroll-down').onclick=()=>send({type:'scroll',delta:470,x:.5,y:.65});
$('type-send').onclick=()=>{const t=$('type-text').value;if(t)send({type:'type',text:t},'Texto enviado');else toast('Digite um texto',true);};
$('message-show').onclick=()=>{const t=$('message').value.trim();if(t)send({type:'message',text:t,x,y,size:Number($('message-size').value)},'Texto exibido');else toast('Escreva a mensagem',true);};
$('message-clear').onclick=()=>send({type:'message',clear:true},'Texto removido');
function refreshVoidMode(){
 const value=$('void-level').value;
 $('void-custom-options').hidden=value!=='custom';
 const hints={
  '1':'Nível 1: igual ao Vazio dos quatro cantos da quebra completa, sem trincar a tela.',
  '2':'Nível 2: manchas maiores surgem e pulsam nos quatro cantos.',
  '3':'Nível 3: escuridão bem grande avança dos quatro cantos para o centro.',
  'custom':'Personalizado: use Marcar Vazio para desenhar ou Escolher posição para colocar uma mancha.'
 };
 $('void-hint').textContent=hints[value]||hints['1'];
}
$('void-level').addEventListener('change',refreshVoidMode);
refreshVoidMode();
$('void-show').onclick=()=>{
 const choice=$('void-level').value;
 if(choice!=='custom'){
  const level=Number(choice);
  send({type:'void',mode:'corners',level},'Vazio nível '+level+' ativado nos quatro cantos');
  return;
 }
 const points=voidPoints.length>=3?voidPoints.map(p=>p.map(v=>Math.round(v*1000)/10)):null;
 send({type:'void',mode:'custom',x,y,size:Number($('void-size').value),...(points?{points}:{})},points?'Vazio pulsando na área marcada':'Vazio pulsando no ponto');
};
$('void-clear').onclick=()=>send({type:'void',clear:true},'Vazio removido');
$('notification-send').onclick=()=>{const message=$('notification-body').value.trim();if(message)send({type:'notification',title:$('notification-title').value.trim()||'Sistema',message},'Notificação enviada');else toast('Escreva a notificação',true);};
$('glitch-send').onclick=()=>send({type:'glitch',duration:1200},'Glitch enviado');
$('secret-enable').onclick=()=>send({type:'secret',enabled:true},'Contatos #02 e V4 revelados');
$('secret-disable').onclick=()=>send({type:'secret',enabled:false},'Contatos ocultados');
$('damage-apply').onclick=()=>send({type:'crack',level:Number($('damage-level').value)},'Tela trincada');
$('damage-repair').onclick=()=>send({type:'repair'},'Tela restaurada');
$('bug-enable').onclick=()=>send({type:'bug',enabled:true},'Bug programado a cada 10 segundos');
$('bug-disable').onclick=()=>send({type:'bug',enabled:false},'Bug desativado');
$('damage-total').onclick=()=>send({type:'break-all'},'Quebra completa e Vazio nos cantos');
$('clear-all').onclick=()=>send({type:'clear-all'},'Efeitos removidos');
$('mode-control').click();
$('preview-expand')?.addEventListener('click',()=>{
 const card=$('preview-card'),b=$('preview-expand');
 const expanded=card.classList.toggle('expanded');
 b.textContent=expanded?'⤡ Voltar ao painel':'⤢ Ampliar celular';
 b.setAttribute('aria-pressed',String(expanded));
 document.body.classList.toggle('preview-expanded',expanded);
 if(expanded)setTimeout(()=>window.dispatchEvent(new Event('resize')),100);
 setTimeout(drawVoidOutline,180);
});
document.addEventListener('keydown',ev=>{
 if(ev.key==='Escape'&&$('preview-card')?.classList.contains('expanded'))$('preview-expand')?.click();
});
check();
})();