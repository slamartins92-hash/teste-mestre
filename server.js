'use strict';
// Sinais Escarlate — servidor LOCAL, sem dependências externas.
const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || (process.env.RENDER ? '' : 'sinais');
const MASTER_ROUTE = process.env.MASTER_ROUTE || '/mestre';
if (!MASTER_PASSWORD) throw new Error('MASTER_PASSWORD é obrigatória para publicação');
const ROOT = path.resolve(__dirname, 'public');
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
const masters = new Map();
const playerSessions = new Map();
const masterStreams = new Set();
const playerStreams = new Set();
const failedLogins = new Map();
let activePlayer = null;
let lastMirrorMap = {};
let lastInfo = {power:true, unlocked:false, app:'bloqueio', chat:null};
let effects = {message:null, void:null, notification:null, secret:false, crack:{level:0}, bug:null, cornersVoid:false, revision:0};
let commandSeq=0;

function json(res,status,data,headers={}) {
  if(res.writableEnded)return;
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});
  res.end(JSON.stringify(data));
}
function cookies(req) {
  const out={};
  String(req.headers.cookie||'').split(';').forEach(part=>{const pos=part.indexOf('=');if(pos>0)out[part.slice(0,pos).trim()]=part.slice(pos+1).trim();});
  return out;
}
const newToken=()=>crypto.randomBytes(24).toString('hex');
function cookie(name,value,seconds,req) {
  const secure = req.headers['x-forwarded-proto']==='https' ? '; Secure' : '';
  return `${name}=${value}; Path=/; SameSite=Strict; HttpOnly; Max-Age=${seconds}${secure}`;
}
function masterOk(req) {const id=cookies(req).sinais_master;const expiry=masters.get(id);if(!expiry)return false;if(expiry<Date.now()){masters.delete(id);return false;}return true;}
function playerId(req){const token=cookies(req).sinais_player;return playerSessions.has(token)?token:null;}
function playerOk(req){return playerId(req)===activePlayer;}
function isLocalOrigin(req){
  const origin=req.headers.origin;
  if(!origin)return true;
  try{const u=new URL(origin);return u.host===req.headers.host && (u.protocol==='http:'||u.protocol==='https:');}catch{return false;}
}
function readBody(req,max=64000){return new Promise((resolve,reject)=>{let content='', length=0, stopped=false;
  req.on('data',buf=>{length+=buf.length;if(length>max){stopped=true;reject(new Error('Payload muito grande'));req.destroy();return;}content+=buf;});
  req.on('end',()=>{if(stopped)return;try{resolve(JSON.parse(content||'{}'));}catch{reject(new Error('JSON inválido'));}});
  req.on('error',reject);
});}
function sse(res,name,data){if(res.writableEnded||res.destroyed)return;try{res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);}catch{}}
function sseOpen(res){res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});res.write('retry: 1400\n\n');}
function emitMaster(name,data){for(const r of masterStreams)sse(r,name,data);}
function emitPlayer(name,data){for(const r of playerStreams)sse(r,name,data);}
function status(){return {online:playerStreams.size>0, spectators:Math.max(0,playerSessions.size-(activePlayer?1:0)), info:lastInfo};}
function notifyStatus(){emitMaster('status',status());}
function serveFile(res,filename){
 const file=path.resolve(ROOT,filename);
 if(!file.startsWith(ROOT+path.sep))return json(res,403,{error:'Acesso negado'});
 fs.stat(file,(err,st)=>{
  if(err||!st.isFile())return json(res,404,{error:'Arquivo não encontrado'});
  res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':filename.endsWith('.html')?'no-store':'private, max-age=300','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow, noarchive'});
  fs.createReadStream(file).pipe(res);
 });
}
// O token do jogador pertence apenas à sessão local do telefone virtual, não ao aparelho real.
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`).pathname;
 try{
  if(req.method==='GET'&&['/','/phone'].includes(pathname))return serveFile(res,'index.html');
  if(req.method==='GET'&&pathname===MASTER_ROUTE)return serveFile(res,'mestre.html');
  if(req.method==='GET'&&pathname==='/phase2.js')return serveFile(res,'phase2.js');
  if(req.method==='GET'&&pathname==='/phase2.css')return serveFile(res,'phase2.css');
  if(req.method==='GET'&&pathname==='/bridge.js')return serveFile(res,'bridge.js');
  if(req.method==='GET'&&pathname==='/mestre.js')return serveFile(res,'mestre.js');
  if(req.method==='GET'&&pathname==='/health')return json(res,200,{ok:true});
  if(req.method==='GET'&&pathname==='/robots.txt'){res.writeHead(200,{'content-type':'text/plain; charset=utf-8'});return res.end('User-agent: *\nDisallow: /\n');}
  if(req.method==='GET'&&pathname==='/api/master/me')return json(res,200,{authorized:masterOk(req)});
  if(req.method==='POST'&&pathname==='/api/master/login'){
   if(!isLocalOrigin(req))return json(res,403,{error:'Origem inválida'});
   const ip=req.socket.remoteAddress||'unknown';
   const rate=failedLogins.get(ip)||{count:0,at:Date.now()};
   if(Date.now()-rate.at>300000){rate.count=0;rate.at=Date.now();}
   if(rate.count>=10)return json(res,429,{error:'Muitas tentativas. Aguarde 5 minutos.'});
   const body=await readBody(req,2000);
   const input=typeof body.password==='string'?body.password:'';
   const a=crypto.createHash('sha256').update(input).digest();
   const b=crypto.createHash('sha256').update(MASTER_PASSWORD).digest();
   if(!crypto.timingSafeEqual(a,b)){
    rate.count++;failedLogins.set(ip,rate);
    return json(res,401,{error:'Senha incorreta'});
   }
   failedLogins.delete(ip);
   const token=newToken();masters.set(token,Date.now()+12*60*60*1000);
   return json(res,200,{ok:true},{'set-cookie':cookie('sinais_master',token,43200,req)});
  }
  if(req.method==='POST'&&pathname==='/api/master/logout'){
   masters.delete(cookies(req).sinais_master);
   return json(res,200,{ok:true},{'set-cookie':cookie('sinais_master','',0,req)});
  }
  if(req.method==='GET'&&pathname==='/api/master/stream'){
   if(!masterOk(req))return json(res,401,{error:'Senha necessária'});
   sseOpen(res);masterStreams.add(res);
   sse(res,'status',status());sse(res,'effects',effects);
   sse(res,'mirror',{reset:true,items:lastMirrorMap,info:lastInfo});
   const ping=setInterval(()=>sse(res,'heartbeat',{at:Date.now()}),15000);
   res.on('close',()=>{clearInterval(ping);masterStreams.delete(res);});
   return;
  }
  if(req.method==='GET'&&pathname==='/api/master/state'){
   if(!masterOk(req))return json(res,401,{error:'Senha necessária'});
   return json(res,200,{status:status(),effects,mirror:{items:lastMirrorMap,info:lastInfo}});
  }
  if(req.method==='POST'&&pathname==='/api/player/join'){
   if(!isLocalOrigin(req))return json(res,403,{error:'Origem inválida'});
   let id=playerId(req);if(!id){id=newToken();playerSessions.set(id,{created:Date.now(),lastSeen:Date.now()});}
   if(!activePlayer||!playerSessions.has(activePlayer)) { activePlayer=id; lastMirrorMap={};lastInfo={power:true,unlocked:false,app:'bloqueio',chat:null}; }
   playerSessions.get(id).lastSeen=Date.now();
   notifyStatus();
   return json(res,200,{active:activePlayer===id}, {'set-cookie':cookie('sinais_player',id,604800,req)});
  }
  if(req.method==='GET'&&pathname==='/api/player/stream'){
   if(!playerId(req))return json(res,401,{error:'Sessão não encontrada'});
   sseOpen(res);
   if(activePlayer===playerId(req))playerStreams.add(res);
   notifyStatus();
   sse(res,'role',{active:playerOk(req)});
   if(playerOk(req))sse(res,'effects',effects);
   const ping=setInterval(()=>sse(res,'heartbeat',{at:Date.now()}),15000);
   res.on('close',()=>{clearInterval(ping);playerStreams.delete(res);notifyStatus();});
   return;
  }
  if(req.method==='POST'&&pathname==='/api/player/sync'){
   if(!playerOk(req))return json(res,403,{error:'Somente o celular ativo envia a tela'});
   if(!isLocalOrigin(req))return json(res,403,{error:'Origem inválida'});
   const data=await readBody(req,320000);
   if(!data||typeof data.changes!=='object'||Array.isArray(data.changes)||!data.info)return json(res,400,{error:'Estado inválido'});
   if(Object.keys(data.changes).length>3500)return json(res,413,{error:'Estado muito grande'});
   Object.assign(lastMirrorMap,data.changes);
   const session=playerSessions.get(activePlayer);if(session)session.lastSeen=Date.now();
   const i=data.info;
   lastInfo={power:!!i.power,unlocked:!!i.unlocked,app:String(i.app||'desconhecido').slice(0,45),chat:i.chat?String(i.chat).slice(0,100):null};
   emitMaster('mirror',{changes:data.changes,info:lastInfo});
   return json(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname==='/api/player/canvas'){
   if(!playerOk(req))return json(res,403,{error:'Sessão não ativa'});
   const data=await readBody(req,260000);
   if(data.id!=='gallery-main-canvas'||typeof data.src!=='string'||!/^data:image\/webp;base64,[a-zA-Z0-9+/=]+$/.test(data.src)||data.src.length>230000)
    return json(res,400,{error:'Imagem inválida'});
   emitMaster('canvas',{id:data.id,src:data.src});
   return json(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname==='/api/player/event'){
   if(!playerOk(req))return json(res,403,{error:'Sessão não ativa'});
   const data=await readBody(req,1500);
   emitMaster('activity',{event:String(data.event||'ação').slice(0,100),at:Date.now()});
   return json(res,200,{ok:true});
  }
  if(req.method==='POST'&&pathname==='/api/master/command'){
   if(!masterOk(req))return json(res,401,{error:'Acesso do Mestre necessário'});
   if(!isLocalOrigin(req))return json(res,403,{error:'Origem inválida'});
   const body=await readBody(req,20000);
   const type=String(body.type||'');
   if(!['navigate','pointer','type','scroll','message','void','notification','clear-all','glitch','secret','crack','bug','break-all','repair'].includes(type))return json(res,400,{error:'Comando inválido'});
   const command={id:++commandSeq,type};
   if(type==='navigate'){
    if(!['home','lock','settings','phone','gallery','sinaiszap','google','calculator'].includes(body.target))return json(res,400,{error:'Tela inválida'});
    command.target=body.target;
   }
   if(type==='pointer'){
    if(!['down','move','up'].includes(body.phase))return json(res,400,{error:'Ponteiro inválido'});
    command.phase=body.phase;
    command.x=Math.max(0,Math.min(1,Number(body.x)||0));
    command.y=Math.max(0,Math.min(1,Number(body.y)||0));
    if(typeof body.targetId==='string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(body.targetId))command.targetId=body.targetId;
    if(Number.isInteger(body.targetIndex)&&body.targetIndex>=0&&body.targetIndex<=7500)command.targetIndex=body.targetIndex;
   }
   if(type==='type'){
    if(typeof body.text!=='string'||body.text.length>160)return json(res,400,{error:'Texto inválido'});
    command.text=body.text;
   }
   if(type==='scroll'){
    command.delta=Math.max(-900,Math.min(900,Number(body.delta)||0));
    if(Number.isFinite(Number(body.x)) && Number.isFinite(Number(body.y))){command.x=Math.max(0,Math.min(1,Number(body.x)));command.y=Math.max(0,Math.min(1,Number(body.y)));}
   }
   if(type==='message'){
    if(body.clear){effects.message=null;}
    else{
     const text=String(body.text||'').trim();
     if(!text||text.length>300)return json(res,400,{error:'A mensagem deve ter de 1 a 300 caracteres'});
     effects.message={text,x:Math.max(0,Math.min(100,Number(body.x)||50)),y:Math.max(0,Math.min(100,Number(body.y)||50)),size:Math.max(14,Math.min(38,Number(body.size)||22))};
    }
    effects.revision++;
   }
   if(type==='void'){
    if(body.clear){effects.void=null;}
    else effects.void={x:Math.max(0,Math.min(100,Number(body.x)||50)),y:Math.max(0,Math.min(100,Number(body.y)||50)),size:Math.max(12,Math.min(110,Number(body.size)||45))};
    if(!body.clear&&Array.isArray(body.points)&&body.points.length>=3&&body.points.length<=75){
     const pts=body.points.filter(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(Number(v))))
      .map(p=>p.map(v=>Math.round(Math.max(0,Math.min(100,Number(v)))*10)/10));
     if(pts.length>=3)effects.void.points=pts;
    }
    effects.revision++;
   }
   if(type==='notification'){
    const title=String(body.title||'Sistema').trim().slice(0,55);
    const message=String(body.message||'').trim().slice(0,220);
    if(!message)return json(res,400,{error:'Notificação vazia'});
    effects.notification={title,message,at:Date.now(),id:command.id};effects.revision++;
   }
   if(type==='secret'){effects.secret=!!body.enabled;effects.revision++;}
   if(type==='crack'){
    const level=Number(body.level);
    if(!Number.isInteger(level)||level<1||level>3)return json(res,400,{error:'Nível deve ser 1, 2 ou 3'});
    effects.crack={level};effects.revision++;command.level=level;
   }
   if(type==='bug'){
    effects.bug=body.enabled?{enabled:true,intervalMs:10000}:null;effects.revision++;
   }
   if(type==='break-all'){
    effects.crack={level:3};effects.cornersVoid=true;effects.bug={enabled:true,intervalMs:5000};effects.revision++;command.level=4;
   }
   if(type==='repair'){
    effects.crack={level:0};effects.cornersVoid=false;effects.bug=null;effects.revision++;
   }
   if(type==='clear-all'){
    effects={message:null,void:null,notification:null,secret:false,crack:{level:0},bug:null,cornersVoid:false,revision:effects.revision+1};
   }
   if(type==='glitch'){command.duration=Math.max(200,Math.min(5000,Number(body.duration)||1000));}
   if(['message','void','notification','clear-all','secret','crack','bug','break-all','repair'].includes(type)){
    emitMaster('effects',effects);emitPlayer('effects',effects);
    if(type==='crack'||type==='break-all')emitPlayer('command',command);
   }else emitPlayer('command',command);
   emitMaster('activity',{event:`Mestre: ${type==='navigate'?'abriu '+command.target:type}`,at:Date.now()});
   return json(res,200,{ok:true,delivered:playerStreams.size>0,effects,command});
  }
  if(pathname.startsWith('/api/'))return json(res,404,{error:'Rota inexistente'});
  return json(res,404,{error:'Não encontrado'});
 }catch(err){if(!res.headersSent&&!res.destroyed)json(res,400,{error:err.message||'Erro'});}
});
// Libera a sessão ativa quando o navegador do jogador realmente sai; permite reconectar.
setInterval(()=>{
 const now=Date.now();
 for(const [token,session] of playerSessions){if(now-session.lastSeen>45000){playerSessions.delete(token);if(token===activePlayer){activePlayer=null;lastMirrorMap={};notifyStatus();}}}
 if(!activePlayer&&playerSessions.size){activePlayer=playerSessions.keys().next().value;notifyStatus();}
},10000).unref();
server.listen(PORT,HOST,()=>console.log('Portal ativo na porta '+PORT));