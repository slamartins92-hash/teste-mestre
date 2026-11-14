(()=>{'use strict';
const $=id=>document.getElementById(id), login=$('login'),dashboard=$('dashboard'),frame=$('preview-frame'),cover=$('preview-cover'),marker=$('point-marker');
let stream=null,ready=false,mirror={},effects=null,mode='control',x=50,y=50,down=false,toastTimer=null,online=false;
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
 if(frame.getAttribute('src')!=='/?mirror=1&v=20261114b')frame.setAttribute('src','/?mirror=1&v=20261114b');
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
 if(ev.data?.type==='arg-ready'){ready=true;postFrame('arg-mirror',{items:mirror});if(effects)postFrame('arg-effects',{effects});}
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
 stream.addEventListener('effects',ev=>{effects=JSON.parse(ev.data);postFrame('arg-effects',{effects});});
 stream.addEventListener('activity',ev=>{const d=JSON.parse(ev.data);log(d.event,d.at);});
 stream.onerror=()=>{$('mirror-status').textContent='Reconectando';};
}
function phoneRect(){
 try{const f=frame.getBoundingClientRect(),g=frame.contentDocument.querySelector('.glass')?.getBoundingClientRect();
 return g?{left:f.left+g.left,top:f.top+g.top,width:g.width,height:g.height}:null;}
 catch(e){return null;}
}
function pointer(ev){const r=phoneRect();return r?{x:Math.max(0,Math.min(1,(ev.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(ev.clientY-r.top)/r.height))}:null;}
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
$('mode-place').onclick=()=>{mode='place';cover.classList.remove('control');$('mode-place').classList.add('active');$('mode-control').classList.remove('active');markerPosition();};
$('mode-control').onclick=()=>{mode='control';cover.classList.add('control');$('mode-control').classList.add('active');$('mode-place').classList.remove('active');markerPosition();};
let queue=Promise.resolve();
function doPointer(ev,phase){
 const p=pointer(ev);if(!p)return;
 if(mode==='place'&&phase==='up')setPos(p.x,p.y);
 if(mode==='control')queue=queue.then(()=>send({type:'pointer',phase,x:p.x,y:p.y})).catch(()=>{});
}
cover.addEventListener('pointerdown',ev=>{down=true;if(mode==='control')cover.setPointerCapture(ev.pointerId);doPointer(ev,'down');ev.preventDefault();});
cover.addEventListener('pointerup',ev=>{doPointer(ev,'up');down=false;if(cover.hasPointerCapture(ev.pointerId))cover.releasePointerCapture(ev.pointerId);});
cover.addEventListener('pointercancel',()=>down=false);
cover.addEventListener('wheel',ev=>{if(mode==='control'){ev.preventDefault();send({type:'scroll',delta:Math.max(-650,Math.min(650,ev.deltaY))});}},{passive:false});
window.addEventListener('resize',markerPosition);
$('pos-x').oninput=()=>setPos(Number($('pos-x').value)/100,y/100);
$('pos-y').oninput=()=>setPos(x/100,Number($('pos-y').value)/100);
for(const id of ['message-size','void-size'])$(id).oninput=()=>$ (id+'-value').textContent=$(id).value+(id==='message-size'?' px':'%');
$('app-grid').onclick=ev=>{const b=ev.target.closest('button[data-screen]');if(b)send({type:'navigate',target:b.dataset.screen},'Tela alterada');};
$('scroll-up').onclick=()=>send({type:'scroll',delta:-470});
$('scroll-down').onclick=()=>send({type:'scroll',delta:470});
$('type-send').onclick=()=>{const t=$('type-text').value;if(t)send({type:'type',text:t},'Texto enviado');else toast('Digite um texto',true);};
$('message-show').onclick=()=>{const t=$('message').value.trim();if(t)send({type:'message',text:t,x,y,size:Number($('message-size').value)},'Texto exibido');else toast('Escreva a mensagem',true);};
$('message-clear').onclick=()=>send({type:'message',clear:true},'Texto removido');
$('void-show').onclick=()=>send({type:'void',x,y,size:Number($('void-size').value)},'Vazio ativado');
$('void-clear').onclick=()=>send({type:'void',clear:true},'Vazio removido');
$('notification-send').onclick=()=>{const message=$('notification-body').value.trim();if(message)send({type:'notification',title:$('notification-title').value.trim()||'Sistema',message},'Notificação enviada');else toast('Escreva a notificação',true);};
$('glitch-send').onclick=()=>send({type:'glitch',duration:1200},'Glitch enviado');
$('clear-all').onclick=()=>send({type:'clear-all'},'Efeitos removidos');
$('mode-control').click();
check();
})();