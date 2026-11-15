/**
 * SINALIS - servidor Node.js sem dependências externas.
 * Mensagens persistentes, autenticação, SSE em tempo real, uploads e sinalização WebRTC.
 * Execute com: node server.js
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'sinalis-data.json');
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOADS, {recursive:true});
const uid = () => crypto.randomUUID();
const invite = () => crypto.randomBytes(5).toString('hex').toUpperCase();
const now = () => new Date().toISOString();
function starterChannels(serverId) {
  return [
    ['geral','text','CANAIS DE TEXTO',false,'Converse com todos'],
    ['midias','text','CANAIS DE TEXTO',false,'Compartilhe fotos, vídeos e arquivos'],
    ['dados','text','CANAIS DE TEXTO',false,'Resultados de dados do RPG'],
    ['Call','voice','CANAIS DE VOZ',false,'Converse por voz com a comunidade'],
    ['Sessão','voice','CANAIS DE VOZ',false,'Sessão de RPG • lugares fixos e transmissão abaixo do Mestre']
  ].map(([name,type,category,readOnly,description],position) =>
    ({id:uid(),serverId,name,type,category,readOnly,description,restricted:false,position}));
}
function initialDb() {
  const id = uid();
  return {users:[],servers:[{id,name:'sinais escarlate',description:'Geral • Mídias • Dados • Call • Sessão',ownerId:null,inviteCode:invite(),createdAt:now()}], channels:starterChannels(id), messages:[]};
}
let db;
const usePg=!!process.env.DATABASE_URL;
const pool=usePg ? new (require('pg').Pool)({connectionString:process.env.DATABASE_URL,ssl:process.env.SINALIS_DB_SSL==='require'?{rejectUnauthorized:false}:undefined}) : null;
let writeQueue=Promise.resolve();

/* Migração segura: recuperar o estado anterior ANTES de aceitar tráfego no novo deploy.
   Se a leitura do servidor antigo falhar, interrompe o boot para preservar a versão antiga. */
async function migrateLiveIntoDatabase(hashes) {
  const credsString=process.env.SINALIS_MIGRATION_CREDENTIALS;
  if(!credsString)throw new Error('Banco novo vazio e credenciais de migração ausentes; cancelando deploy para proteger histórico.');
  const creds=JSON.parse(credsString);
  const origin=(process.env.SINALIS_MIGRATION_ORIGIN||'https://sinaliscord.onrender.com').replace(/\/$/,'');
  const req=async (p,token,bodyData)=>{
    const response=await fetch(origin+p,{
      method:bodyData?'POST':'GET',
      headers:{...(bodyData?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},
      body:bodyData?JSON.stringify(bodyData):undefined,
      signal:AbortSignal.timeout(25000)
    });
    if(!response.ok)throw new Error('Falha ao preservar '+p.split('?')[0]+': HTTP '+response.status);
    return response.json();
  };
  const users=['Pingu','Knight','Manuela','Mafe','Luska'];
  const tokens={};
  for(const username of users){
    if(!creds[username])throw new Error('Credenciais de migração incompletas: '+username);
    const answer=await req('/api/login',null,{username,password:creds[username]});
    tokens[username]=answer.token;
  }
  const base=await req('/api/bootstrap',tokens.Pingu);
  if(!base?.server?.id||!base.members?.length)throw new Error('Estado anterior inválido; protegendo histórico.');
  const sv=base.server;
  const members={};
  const originalUsers=base.members.map(m=>{
    const hash=hashes[m.username]||hashes[users.find(k=>k.toLowerCase()===m.username.toLowerCase())];
    if(!hash)throw new Error('Hash de conta ausente: '+m.username);
    members[m.id]=m.role==='mestre'?'mestre':'player';
    return {id:m.id,username:m.username,displayName:m.displayName,avatar:m.avatar||'',status:m.status||'online',bio:m.bio||'',password:hash,joinedAt:m.joinedAt||now(),sessions:[]};
  });
  if(originalUsers.length<5)throw new Error('Membros insuficientes durante a cópia; cancelando migração.');
  const mainServer={id:sv.id,name:sv.name,description:sv.description,ownerId:sv.ownerId||originalUsers.find(x=>x.username==='Pingu')?.id,inviteCode:sv.inviteCode||invite(),createdAt:sv.createdAt||now(),members};
  const messages=new Map();
  const channels=base.channels||[];
  for(const ch of channels.filter(x=>x.type==='text')){
    const out=await req('/api/messages?channel='+encodeURIComponent(ch.id),tokens.Pingu);
    for(const m of out.messages||[]) messages.set(m.id,m);
  }
  // Exportar também DMs visíveis para cada uma das cinco contas preexistentes.
  for(const username of users){
    const token=tokens[username];
    const me=originalUsers.find(x=>x.username.toLowerCase()===username.toLowerCase());
    if(!me)continue;
    for(const other of originalUsers){
      if(other.id===me.id)continue;
      const out=await req('/api/messages?dm='+encodeURIComponent(other.id),token);
      for(const m of out.messages||[]) messages.set(m.id,m);
    }
  }
  const minMessages=Number(process.env.SINALIS_MIGRATION_MIN_MESSAGES||33);
  if(messages.size<minMessages)throw new Error('A migração retornou apenas '+messages.size+' mensagens (mínimo '+minMessages+'); mantendo a versão anterior.');
  const toDownload=new Set();
  for(const u of originalUsers)if(u.avatar?.startsWith('/uploads/'))toDownload.add(u.avatar);
  for(const m of messages.values())if(m.attachment?.url?.startsWith('/uploads/'))toDownload.add(m.attachment.url);
  const files={};
  for(const filePath of toDownload){
    const resp=await fetch(origin+filePath,{signal:AbortSignal.timeout(30000)});
    if(!resp.ok)throw new Error('Não foi possível salvar um avatar/anexo: HTTP '+resp.status);
    const bytes=Buffer.from(await resp.arrayBuffer());
    if(bytes.length>9*1024*1024)throw new Error('Arquivo muito grande para migração segura.');
    files[path.basename(filePath)]={data:bytes.toString('base64'),createdAt:now()};
  }
  const restored={users:originalUsers,servers:[mainServer],channels,messages:Array.from(messages.values()),files};
  console.log('Histórico recuperado:',restored.users.length,'contas,',restored.messages.length,'mensagens,',Object.keys(files).length,'arquivos.');
  return restored;
}

async function initialize(){
  if(usePg){
    await pool.query('CREATE TABLE IF NOT EXISTS sinalis_state (id INTEGER PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())');

    // Gravações protegidas em tabelas próprias. Nunca apaga nem reescreve mensagens, contas ou fotos.
    await pool.query("CREATE TABLE IF NOT EXISTS sinalis_session_recordings (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, created_by TEXT NOT NULL, title TEXT NOT NULL, mime_type TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), status TEXT NOT NULL DEFAULT 'recording', size_bytes BIGINT NOT NULL DEFAULT 0, duration_ms BIGINT NOT NULL DEFAULT 0)");
    await pool.query("CREATE TABLE IF NOT EXISTS sinalis_session_recording_chunks (recording_id TEXT NOT NULL REFERENCES sinalis_session_recordings(id) ON DELETE CASCADE, part_no INT NOT NULL, payload BYTEA NOT NULL, PRIMARY KEY(recording_id,part_no))");
    await pool.query("UPDATE sinalis_session_recordings SET status='incompleta' WHERE status='recording'");
    const r=await pool.query('SELECT data FROM sinalis_state WHERE id=1');
    if(r.rows.length)db=r.rows[0].data;
    else {
      // Nunca inicializar um banco vazio sem copiar o histórico da versão existente.
      try{db=JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}
      catch{db=await migrateLiveIntoDatabase(JSON.parse(process.env.SINALIS_SEED_HASHES||'{}'))}
    }
  }else{
    try{db=JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch{db={users:[],servers:[],channels:[],messages:[],files:{}}}
  }
  db.files ||= {};
  if(!db.servers.length){
    const id=uid();
    db.servers=[{id,name:'sinais escarlate',description:'Geral • Mídias • Dados • Call',ownerId:null,inviteCode:invite(),createdAt:now(),members:{}}];
    db.channels=starterChannels(id);
  }
  for(const s of db.servers)s.members ||= {};
  for(const u of db.users)u.sessions ||= [];
  const hashes=JSON.parse(process.env.SINALIS_SEED_HASHES || '{}');
  const seeded=['Pingu','Knight','Manuela','Mafe','Luska'];
  for(const username of seeded){
    let member=db.users.find(u=>u.username.toLowerCase()===username.toLowerCase());
    if(!member){
      const h=hashes[username];
      if(typeof h!=='string'||!h.includes(':'))throw new Error('SINALIS_SEED_HASHES está ausente ou incompleto para '+username);
      member={id:uid(),username,displayName:username,password:h,status:'online',bio:'',avatar:'',joinedAt:now(),sessions:[]};db.users.push(member);
    }
    const sv=db.servers.find(s=>s.name.toLowerCase()==='sinais escarlate')||db.servers[0];
    sv.members[member.id]=username==='Pingu'?'mestre':'player';
    if(username==='Pingu')sv.ownerId=member.id;
  }
  // Mantém a configuração já definida do sinais escarlate.
  for(const sv of db.servers){
    const main=sv.name.toLowerCase()==='sinais escarlate';
    if(!main)continue;
    for(const id of Object.keys(sv.members))sv.members[id]=id===sv.ownerId?'mestre':'player';
    const wanted=[['geral','text'],['midias','text'],['dados','text'],['Call','voice'],['Sessão','voice']];
    const standard=starterChannels(sv.id);
    const keep=wanted.map(([name,type],position)=>{
      const prev=db.channels.find(c=>c.serverId===sv.id&&c.name.toLowerCase()===name.toLowerCase()&&c.type===type);
      const standardCh=standard[position];
      return prev?{...prev,category:standardCh.category,description:standardCh.description,position,readOnly:false,restricted:false}:standardCh;
    });
    // Mantém todos os canais e IDs históricos; só atualiza os canais fixos e inclui Sessão.
    db.channels=db.channels.filter(c=>c.serverId!==sv.id||!wanted.some(([name,type])=>c.name.toLowerCase()===name.toLowerCase()&&c.type===type)).concat(keep);
  }
  await persistImmediate();
}
function persistImmediate(){
  const data=JSON.stringify(db);
  if(!usePg){const tempFile=DB_FILE+'.tmp';fs.writeFileSync(tempFile,data);fs.renameSync(tempFile,DB_FILE);return Promise.resolve()}
  // Serialize DB writes to avoid out-of-order snapshots overwriting a newer state.
  writeQueue=writeQueue.catch(e=>console.error('Persistência anterior falhou:',e)).then(()=>
    pool.query('INSERT INTO sinalis_state (id,data,updated_at) VALUES (1,$1::jsonb,NOW()) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()', [data])
  );
  return writeQueue;
}
let saveTimer = null;
function save(){
  if(saveTimer)clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;persistImmediate().catch(e=>console.error('Falha ao salvar Sinalis:',e))},140);
}
function publicUser(u,server){
  return {id:u.id, username:u.username,displayName:u.displayName||u.username,avatar:u.avatar||'',status:u.status||'online',bio:u.bio||'',role:server?.members?.[u.id]||'player', joinedAt:u.joinedAt};
}
function tokenize(res,data,status=200){ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); }
function error(res,message,status=400){ return tokenize(res,{error:message},status); }
async function body(req, max=9_000_000){
  let size=0,chunks=[];
  for await(const c of req){size+=c.length; if(size>max){let e=new Error('Arquivo ou solicitação muito grande.');e.status=413;throw e;}chunks.push(c);}
  const content=Buffer.concat(chunks).toString('utf8');
  try {return content?JSON.parse(content):{};} catch {let e=new Error('JSON inválido.');e.status=400;throw e;}
}
function hashPassword(p,salt=crypto.randomBytes(18).toString('hex')){
  return salt+':'+crypto.pbkdf2Sync(p,salt,150000,32,'sha256').toString('hex');
}
function validPassword(p,hash){
  if(typeof p!=='string'||typeof hash!=='string') return false;
  const [salt,digest]=hash.split(':');
  const a=Buffer.from(crypto.pbkdf2Sync(p,salt,150000,32,'sha256').toString('hex'),'hex');
  const b=Buffer.from(digest,'hex');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function session(req){
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token) return null;
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  const user=db.users.find(u=>u.sessions?.some(s=>s.token===tokenHash && s.expires>Date.now()));
  return user?{user,tokenHash}:null;
}
const streams=new Map(); // user ID -> Set of SSE connections
const voices=new Map(); // user ID -> {room, muted, deaf, video, sharing}
let activeSessionRecording=null; // apenas sinalização ao vivo; os vídeos ficam no PostgreSQL
function broadcastSessionRecording(serverId,active,by){
 const sv=db.servers.find(x=>x.id===serverId);
 if(sv)broadcast('session-recording',{serverId,active,by:active?by:null},Object.keys(sv.members||{}));
}
function sendTo(userId,type,payload){
  for(const res of streams.get(userId)||[]) try{res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);}catch{}
}
function broadcast(type,payload,users){for(const id of users||streams.keys()) sendTo(id,type,payload);}
function online(){return Array.from(streams.keys()).filter(id=>streams.get(id)?.size);}
function presence(){broadcast('presence',{online:online()});}
function voicePeople(room){return Array.from(voices.entries()).filter(([_,v])=>v.room===room).map(([id,v])=>({id,...v}));}
function voiceState(){broadcast('voice',{people:Array.from(voices.entries()).map(([id,v])=>({id,...v}))});}
function leaveVoice(id){
 if(activeSessionRecording&&activeSessionRecording.ownerId===id){
  const rec=activeSessionRecording;activeSessionRecording=null;
  broadcastSessionRecording(rec.serverId,false,null);
  if(usePg)pool.query("UPDATE sinalis_session_recordings SET status='incompleta' WHERE id=$1 AND status='recording'",[rec.id]).catch(e=>console.error('Interrupção de gravação:',e.message));
 }
 if(voices.delete(id))voiceState();
}
function requireServer(res,user,id){
  const s=db.servers.find(s=>s.id===id);
  if(!s||!s.members[user.id]){error(res,'Você não participa deste servidor.',403);return null;}
  return s;
}
const staff = role => role==='mestre';
const manage = role => role==='mestre';
function readable(ch,user){
  const s=db.servers.find(s=>s.id===ch.serverId);
  return !!(s?.members[user.id] && (!ch.restricted||staff(s.members[user.id])));
}
function msgPublic(m){return m;}
function targetsForMessage(m){
  if(m.channelId){const c=db.channels.find(c=>c.id===m.channelId);const s=db.servers.find(s=>s.id===c?.serverId);return Object.keys(s?.members||{}).filter(id=>!c.restricted||staff(s.members[id]));}
  return [m.senderId,m.dmUserId];
}
function notifyMessage(type,m){broadcast(type,msgPublic(m),targetsForMessage(m));}
function safeFilename(name){return String(name||'arquivo').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);}
function serveFile(req,res,pathname){
  let f;
  if(pathname.startsWith('/uploads/')){
    const name=path.basename(pathname);
    if(db.files?.[name]){
      const entry=db.files[name];const bytes=Buffer.from(entry.data,'base64');
      const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.mp3':'audio/mpeg','.ogg':'audio/ogg','.mp4':'video/mp4','.webm':'video/webm','.zip':'application/zip','.json':'application/json'};
      res.writeHead(200,{'Content-Type':types[path.extname(name).toLowerCase()]||'application/octet-stream','Content-Length':bytes.length,'X-Content-Type-Options':'nosniff','Cache-Control':'private,max-age=86400'});
      res.end(bytes);return;
    }
    f=path.join(UPLOADS,name);
  }else f=pathname==='/'?path.join(ROOT,'index.html'):path.join(PUBLIC,pathname);
  if(!f.startsWith(pathname.startsWith('/uploads/')?UPLOADS:PUBLIC) && f!==path.join(ROOT,'index.html')) return error(res,'Arquivo inválido',403);
  try{
    if(!fs.statSync(f).isFile())throw new Error();
    const ext=path.extname(f).toLowerCase();
    const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.json':'application/json','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.ogg':'audio/ogg'};
    const h={'Content-Type':mime[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':pathname.startsWith('/uploads/')?'public, max-age=86400':'no-cache'};
    if(pathname.startsWith('/uploads/')&&!['.png','.jpg','.jpeg','.webp','.gif','.mp3','.ogg','.mp4','.webm','.pdf'].includes(ext))h['Content-Disposition']='attachment';
    res.writeHead(200,h);fs.createReadStream(f).pipe(res);
  } catch {error(res,'Arquivo não encontrado',404);}
}
async function api(req,res,p,params){
  const method=req.method;
  if(p==='/api/health')return tokenize(res,{ok:true,service:'Sinalis',storage:usePg?'postgres':'temporary'});
  if(p==='/api/register'&&method==='POST')return error(res,'Cadastro fechado nesta versão beta. Entre com uma conta criada pelo Mestre.',403);
  if(false&&p==='/api/register'&&method==='POST'){
    const b=await body(req);const username=String(b.username||'').trim();const password=b.password;
    if(username.length<3||username.length>24||!(/^[\p{L}\p{N}_. -]+$/u.test(username)))return error(res,'Nome precisa ter 3 a 24 caracteres (letras, números, espaços, _ . ou -).');
    if(typeof password!=='string'||password.length<6||password.length>200)return error(res,'Use uma senha de 6 a 200 caracteres.');
    if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return error(res,'Esse nome de usuário já existe.',409);
    const u={id:uid(),username,displayName:username,password:hashPassword(password),status:'online',bio:'',avatar:'',joinedAt:now(),sessions:[]};
    db.users.push(u);
    const original=db.servers[0];
    if(!original.ownerId){original.ownerId=u.id;original.members[u.id]='mestre';}
    else original.members[u.id]='player';
    const token=crypto.randomBytes(32).toString('hex');u.sessions.push({token:crypto.createHash('sha256').update(token).digest('hex'),expires:Date.now()+30*86400000});save();
    return tokenize(res,{token,me:publicUser(u,original)});
  }
  if(p==='/api/login'&&method==='POST'){
    const b=await body(req);
    const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
    const attemptKey=ip+'|'+String(b.username||'').toLowerCase();
    let attempts=loginAttempts.get(attemptKey)||{hits:0,reset:Date.now()+15*60*1000};
    if(attempts.reset<Date.now())attempts={hits:0,reset:Date.now()+15*60*1000};
    if(attempts.hits>=8)return error(res,'Muitas tentativas. Tente novamente em 15 minutos.',429);
    const u=db.users.find(u=>u.username.toLowerCase()===String(b.username||'').trim().toLowerCase());
    if(!u||!validPassword(b.password,u.password)){attempts.hits++;loginAttempts.set(attemptKey,attempts);return error(res,'Usuário ou senha incorretos.',401)}
    loginAttempts.delete(attemptKey);
    const token=crypto.randomBytes(32).toString('hex');u.sessions ||= [];u.sessions.push({token:crypto.createHash('sha256').update(token).digest('hex'),expires:Date.now()+30*86400000});u.sessions=u.sessions.filter(s=>s.expires>Date.now()).slice(-12);save();return tokenize(res,{token,me:publicUser(u,db.servers.find(s=>s.members[u.id]))});
  }
  const s=session(req);
  // EventSource does not support Authorization headers: short-lived event ticket obtained via GET event-url.
  if(p==='/api/events'&&method==='GET'){
    const t=params.get('ticket'); const ticket=eventTickets.get(t);
    if(!ticket||ticket.exp<Date.now())return error(res,'Sessão de eventos inválida.',401);
    eventTickets.delete(t);const userId=ticket.userId;
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no','Access-Control-Allow-Origin':'same-origin'});
    res.write('retry: 2000\n\n');
    if(!streams.has(userId))streams.set(userId,new Set());streams.get(userId).add(res);presence();voiceState();
    const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},20000);
    req.on('close',()=>{clearInterval(ping);const group=streams.get(userId);group?.delete(res);if(!group?.size){streams.delete(userId);setTimeout(()=>{if(!streams.has(userId))leaveVoice(userId);presence();},2200);}});
    return;
  }
  if(!s)return error(res,'Faça login para continuar.',401);
  const u=s.user;
  // Gravações da Sessão: somente o Mestre pode criar, listar ou baixar.
  // Os participantes recebem apenas o status "está gravando" para transparência.
  if(p==='/api/session-recordings/status'&&method==='GET'){
    const sid=params.get('serverId');
    const sv=db.servers.find(x=>x.id===sid&&x.members?.[u.id]);
    if(!sv)return error(res,'Servidor indisponível.',403);
    const active=!!activeSessionRecording&&activeSessionRecording.serverId===sid;
    return tokenize(res,{active,by:active?activeSessionRecording.ownerId:null});
  }
  if(p.startsWith('/api/session-recordings')){
    if(!usePg)return error(res,'Gravações precisam do banco de dados permanente.',503);
    const isMaster=sid=>db.servers.some(x=>x.id===sid&&x.members?.[u.id]==='mestre');
    if(p==='/api/session-recordings/start'&&method==='POST'){
      const b=await body(req,10000),sid=String(b.serverId||'');
      if(!isMaster(sid))return error(res,'Somente o Mestre pode gravar a Sessão.',403);
      const room=db.channels.find(x=>x.serverId===sid&&x.type==='voice'&&x.name.toLowerCase()==='sessão');
      if(!room||voices.get(u.id)?.room!==room.id)return error(res,'Entre na call Sessão antes de gravar.',403);
      if(activeSessionRecording)return error(res,'Já existe uma gravação em andamento.',409);
      const mime=String(b.mimeType||'video/webm').slice(0,80);
      if(!/^(video\/webm|video\/mp4)(;.*)?$/i.test(mime))return error(res,'Formato de gravação não suportado.',415);
      const id=uid(),title='Sessão '+new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
      await pool.query("INSERT INTO sinalis_session_recordings(id,server_id,created_by,title,mime_type) VALUES($1,$2,$3,$4,$5)",[id,sid,u.id,title,mime]);
      activeSessionRecording={id,serverId:sid,ownerId:u.id,startedAt:Date.now()};
      broadcastSessionRecording(sid,true,u.id);
      return tokenize(res,{id,title},201);
    }
    if(p==='/api/session-recordings'&&method==='GET'){
      const sid=String(params.get('serverId')||'');
      if(!isMaster(sid))return error(res,'Apenas o Mestre pode acessar as gravações.',403);
      const out=await pool.query("SELECT id,title,mime_type AS \"mimeType\",created_at AS \"createdAt\",status,size_bytes AS \"sizeBytes\",duration_ms AS \"durationMs\" FROM sinalis_session_recordings WHERE server_id=$1 ORDER BY created_at DESC LIMIT 80",[sid]);
      return tokenize(res,{recordings:out.rows});
    }
    const match=p.match(/^\/api\/session-recordings\/([0-9a-f-]{36})\/(chunk|finish|file|abort)$/);
    if(!match)return error(res,'Recurso de gravação desconhecido.',404);
    const id=match[1],action=match[2];
    const found=await pool.query("SELECT id,server_id,created_by,title,mime_type,status,size_bytes,duration_ms,created_at FROM sinalis_session_recordings WHERE id=$1",[id]);
    const rec=found.rows[0];
    if(!rec||!isMaster(rec.server_id))return error(res,'Gravação indisponível para esta conta.',403);
    if(action==='chunk'&&method==='POST'){
      if(!activeSessionRecording||activeSessionRecording.id!==id||activeSessionRecording.ownerId!==u.id)return error(res,'Gravação não está ativa.',409);
      if(rec.status!=='recording')return error(res,'Gravação já encerrada.',409);
      if(String(req.headers['content-type']||'').split(';')[0]!=='application/octet-stream')return error(res,'Envie blocos binários.',415);
      const index=Number(params.get('index'));
      if(!Number.isInteger(index)||index<0||index>3000)return error(res,'Ordem de bloco inválida.',400);
      let total=0;const pieces=[];
      for await(const item of req){total+=item.length;if(total>2500000){const e=new Error('Bloco ultrapassou 2,5 MB.');e.status=413;throw e;}pieces.push(item)}
      if(!total)return error(res,'Bloco vazio.',400);
      const binary=Buffer.concat(pieces);
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const rows=await client.query('SELECT size_bytes,status FROM sinalis_session_recordings WHERE id=$1 FOR UPDATE',[id]);
        const current=rows.rows[0];
        if(!current||current.status!=='recording')throw Object.assign(new Error('Gravação encerrada.'),{status:409});
        if(Number(current.size_bytes)+binary.length>200000000)throw Object.assign(new Error('Limite de 200 MB por gravação atingido. Finalize esta gravação.'),{status:413});
        const last=await client.query('SELECT COALESCE(MAX(part_no),-1) AS last FROM sinalis_session_recording_chunks WHERE recording_id=$1',[id]);
        if(index!==Number(last.rows[0].last)+1)throw Object.assign(new Error('Bloco fora de ordem.'),{status:409});
        await client.query('INSERT INTO sinalis_session_recording_chunks(recording_id,part_no,payload) VALUES($1,$2,$3)',[id,index,binary]);
        await client.query('UPDATE sinalis_session_recordings SET size_bytes=size_bytes+$1 WHERE id=$2',[binary.length,id]);
        await client.query('COMMIT');
      }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
      return tokenize(res,{ok:true,index,sizeBytes:binary.length});
    }
    if(action==='abort'&&method==='POST'){
      if(rec.created_by!==u.id)return error(res,'Sem permissão.',403);
      await pool.query("UPDATE sinalis_session_recordings SET status='incompleta' WHERE id=$1 AND status='recording'",[id]);
      if(activeSessionRecording?.id===id){activeSessionRecording=null;broadcastSessionRecording(rec.server_id,false,null)}
      return tokenize(res,{ok:true});
    }
    if(action==='finish'&&method==='POST'){
      if(rec.created_by!==u.id)return error(res,'Apenas quem iniciou pode concluir esta gravação.',403);
      const b=await body(req,10000);
      const duration=Math.max(0,Math.min(Number(b.durationMs)||0,24*60*60*1000));
      const total=await pool.query('SELECT COUNT(*)::int AS chunks FROM sinalis_session_recording_chunks WHERE recording_id=$1',[id]);
      if(!total.rows[0].chunks)return error(res,'Nenhum trecho de vídeo foi recebido.',400);
      await pool.query("UPDATE sinalis_session_recordings SET status='salva',duration_ms=$2 WHERE id=$1 AND status IN ('recording','incompleta')",[id,duration]);
      if(activeSessionRecording?.id===id){activeSessionRecording=null;broadcastSessionRecording(rec.server_id,false,null)}
      return tokenize(res,{ok:true,id});
    }
    if(action==='file'&&method==='GET'){
      if(Number(rec.size_bytes)<1)return error(res,'Esta gravação não tem vídeo disponível.',404);
      res.writeHead(200,{'Content-Type':rec.mime_type||'video/webm','Content-Length':String(rec.size_bytes),'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="sessao-'+id+((rec.mime_type||'').startsWith('video/mp4')?'.mp4"':'.webm"')});
      // Transmite por partes para não carregar um vídeo grande inteiro na memória do Render.
      let i=0;
      while(!res.destroyed){
        const chunk=await pool.query('SELECT payload FROM sinalis_session_recording_chunks WHERE recording_id=$1 AND part_no=$2',[id,i++]);
        if(!chunk.rows.length)break;
        if(!res.write(chunk.rows[0].payload))await new Promise(resolve=>res.once('drain',resolve));
      }
      if(!res.writableEnded)res.end();return;
    }
    return error(res,'Método não permitido.',405);
  }
  if(p==='/api/event-ticket'&&method==='POST'){
    const t=crypto.randomBytes(24).toString('hex');eventTickets.set(t,{userId:u.id,exp:Date.now()+30000});
    return tokenize(res,{ticket:t});
  }
  if(p==='/api/logout'&&method==='POST'){
    u.sessions=u.sessions.filter(q=>q.token!==s.tokenHash);save();return tokenize(res,{ok:true});
  }
  if(p==='/api/bootstrap'&&method==='GET'){
    const myServers=db.servers.filter(x=>!!x.members[u.id]);const requested=params.get('server');
    const server=myServers.find(x=>x.id===requested)||myServers[0];
    if(!server)return error(res,'Nenhum servidor disponível.',404);
    const channels=db.channels.filter(c=>c.serverId===server.id&&readable(c,u));
    const members=db.users.filter(x=>server.members[x.id]).map(x=>publicUser(x,server));
    const dms=[];
    for(const m of db.messages){if(m.dmUserId && [m.senderId,m.dmUserId].includes(u.id)){
      const other=m.senderId===u.id?m.dmUserId:m.senderId;if(!dms.includes(other))dms.push(other);
    }}
    return tokenize(res,{permissions:{diceBlocked:!!server.diceBlockedUsers?.[u.id],serverMuted:!!server.voiceMutedUsers?.[u.id],maxDice:server.members[u.id]==='mestre'?200:10,diceBlockedUsers:server.members[u.id]==='mestre'?server.diceBlockedUsers||{}:{},voiceMutedUsers:server.members[u.id]==='mestre'?server.voiceMutedUsers||{}:{}},me:publicUser(u,server),servers:myServers.map(({members,...x})=>({...x,role:members[u.id],memberCount:Object.keys(members).length})),server:{...server,members:undefined,role:server.members[u.id],memberCount:members.length},channels,members,online:online(),voice:Array.from(voices.entries()).map(([id,v])=>({id,...v})),dms:dms.map(id=>{const person=db.users.find(x=>x.id===id);return person?publicUser(person):null}).filter(Boolean)});
  }
  if(p==='/api/all-users'&&method==='GET')return tokenize(res,{users:db.users.map(x=>publicUser(x))});

  // Rolagens de RPG: valores gerados pelo servidor, persistidos em #dados e transmitidos
  // para cada membro conectado, independentemente do canal que estiver aberto.
  if(p==='/api/moderation'&&method==='POST'){
    const b=await body(req);
    const server=db.servers.find(s=>s.id===b.serverId&&s.members?.[u.id]==='mestre');
    if(!server)return error(res,'Somente o Mestre pode controlar permissões.',403);
    const target=db.users.find(x=>x.id===b.targetId);
    if(!target||!server.members[target.id]||server.members[target.id]==='mestre')return error(res,'Só é possível alterar permissões de Players.',403);
    if(typeof b.enabled!=='boolean')return error(res,'Estado inválido.');
    if(b.kind==='dice'){
      server.diceBlockedUsers ||= {};
      if(b.enabled)server.diceBlockedUsers[target.id]=true;
      else delete server.diceBlockedUsers[target.id];
    }else if(b.kind==='voice'){
      server.voiceMutedUsers ||= {};
      if(b.enabled)server.voiceMutedUsers[target.id]=true;
      else delete server.voiceMutedUsers[target.id];
      const v=voices.get(target.id);
      if(v&&db.channels.some(c=>c.id===v.room&&c.serverId===server.id)){
        v.serverMuted=!!b.enabled;
        if(b.enabled)v.muted=true;
        voiceState();
      }
    }else return error(res,'Controle desconhecido.',400);
    await persistImmediate();
    broadcast('moderation',{serverId:server.id,targetId:target.id,kind:b.kind,enabled:b.enabled},Object.keys(server.members));
    return tokenize(res,{ok:true,targetId:target.id,kind:b.kind,enabled:b.enabled});
  }
  if(p==='/api/dice/roll'&&method==='POST'){
    const b=await body(req);
    const allowed=[4,6,8,10,12,20,100];
    const sides=Number(b.sides), count=Number(b.count);
    const server=db.servers.find(s=>s.id===b.serverId&&s.members?.[u.id]);
    if(!server)return error(res,'Servidor indisponível.',403);
    if(server.diceBlockedUsers?.[u.id])return error(res,'O Mestre bloqueou suas rolagens de dados.',403);
    const limit=server.members[u.id]==='mestre'?200:10;
    if(!Number.isInteger(sides)||!allowed.includes(sides)||!Number.isInteger(count)||count<1||count>limit)
      return error(res,'Escolha entre 1 e '+limit+' dados de d4, d6, d8, d10, d12, d20 ou d100.');
    const dados=db.channels.find(c=>c.serverId===server.id&&c.name.toLowerCase()==='dados'&&c.type==='text');
    if(!dados)return error(res,'Canal #dados não encontrado.',404);
    const values=Array.from({length:count},()=>crypto.randomInt(1,sides+1));
    const roll={id:uid(),serverId:server.id,userId:u.id,displayName:u.displayName||u.username,sides,count,values,total:values.reduce((a,b)=>a+b,0),createdAt:now()};
    const message={id:uid(),channelId:dados.id,dmUserId:null,senderId:u.id,
      content:`🎲 ${count}d${sides}: ${values.join(' + ')} = ${roll.total}`,
      roll,attachment:null,replyTo:null,createdAt:roll.createdAt,updatedAt:null,reactions:{},pinned:false};
    db.messages.push(message);
    if(db.messages.length>30000)db.messages=db.messages.slice(-30000);
    await persistImmediate();
    notifyMessage('message',message);
    broadcast('dice-roll',{roll,message},Object.keys(server.members));
    return tokenize(res,{roll,message},201);
  }
  if(p==='/api/messages'&&method==='GET'){
    const channelId=params.get('channel'),dmId=params.get('dm');
    if(channelId){const ch=db.channels.find(c=>c.id===channelId);if(!ch||!readable(ch,u))return error(res,'Canal indisponível.',403);return tokenize(res,{messages:db.messages.filter(x=>x.channelId===channelId).slice(-180)});}
    if(dmId)return tokenize(res,{messages:db.messages.filter(x=>!x.channelId&&([x.senderId,x.dmUserId].includes(u.id))&&([x.senderId,x.dmUserId].includes(dmId))).slice(-180)});
    return error(res,'Selecione um canal.');
  }
  if(p==='/api/messages'&&method==='POST'){
    const b=await body(req);const content=String(b.content||'').trim();
    if(content.length>4000)return error(res,'A mensagem excede 4.000 caracteres.');
    if(!content&&!b.attachment)return error(res,'Digite uma mensagem ou envie um arquivo.');
    const channel=b.channelId?db.channels.find(c=>c.id===b.channelId):null;
    if(channel){if(!['text','voice'].includes(channel.type)||!readable(channel,u))return error(res,'Canal indisponível.',403);
      const server=db.servers.find(x=>x.id===channel.serverId);
      if(channel.type==='voice'&&voices.get(u.id)?.room!==channel.id)return error(res,'Entre na Call para enviar mensagens.',403);
      if(channel.readOnly&&!staff(server.members[u.id]))return error(res,'Só a equipe pode escrever neste canal.',403);
    } else if(!b.dmUserId||!db.users.some(x=>x.id===b.dmUserId&&x.id!==u.id))return error(res,'Conversa privada inválida.');
    const attachment=b.attachment&&typeof b.attachment.url==='string'&&/^\/uploads\/[\w.-]+$/.test(b.attachment.url)?{url:b.attachment.url,name:String(b.attachment.name||'arquivo').slice(0,100),type:String(b.attachment.type||'')}:null;
    const m={id:uid(),channelId:channel?.id||null,dmUserId:channel?null:b.dmUserId,senderId:u.id,content,attachment,replyTo:b.replyTo||null,createdAt:now(),updatedAt:null,reactions:{},pinned:false};
    db.messages.push(m);if(db.messages.length>30000)db.messages=db.messages.slice(-30000);await persistImmediate();notifyMessage('message',m);return tokenize(res,{message:m},201);
  }
  const msgRoute=p.match(/^\/api\/messages\/([\w-]+)$/);
  if(msgRoute&&(method==='PATCH'||method==='DELETE')){
    const m=db.messages.find(x=>x.id===msgRoute[1]);if(!m)return error(res,'Mensagem não encontrada.',404);
    const ch=m.channelId&&db.channels.find(c=>c.id===m.channelId);const sv=ch&&db.servers.find(x=>x.id===ch.serverId);
    if(m.senderId!==u.id && !(sv&&staff(sv.members[u.id])))return error(res,'Sem permissão.',403);
    if(method==='PATCH'){
      if(m.senderId!==u.id)return error(res,'Só o autor pode editar.',403);
      const b=await body(req);const content=String(b.content||'').trim();if(!content||content.length>4000)return error(res,'Conteúdo inválido.');m.content=content;m.updatedAt=now();
    }else db.messages=db.messages.filter(x=>x.id!==m.id);
    save();notifyMessage(method==='DELETE'?'delete-message':'update-message',m);return tokenize(res,{ok:true,message:m});
  }
  if(p==='/api/reactions'&&method==='POST'){
    const b=await body(req);const m=db.messages.find(x=>x.id===b.messageId);if(!m)return error(res,'Mensagem não encontrada.',404);
    if(m.channelId){const ch=db.channels.find(x=>x.id===m.channelId);if(!ch||!readable(ch,u))return error(res,'Sem acesso.',403);}
    else if(![m.senderId,m.dmUserId].includes(u.id))return error(res,'Sem acesso.',403);
    const emoji=String(b.emoji||'').slice(0,10);if(!emoji||Object.keys(m.reactions).length>=30&&!m.reactions[emoji])return error(res,'Reação inválida.');
    m.reactions[emoji]||=[];m.reactions[emoji]=m.reactions[emoji].includes(u.id)?m.reactions[emoji].filter(x=>x!==u.id):[...m.reactions[emoji],u.id];if(!m.reactions[emoji].length)delete m.reactions[emoji];save();notifyMessage('update-message',m);return tokenize(res,{ok:true});
  }
  if(p==='/api/pins'&&method==='POST'){
    const b=await body(req);const m=db.messages.find(x=>x.id===b.messageId);const ch=db.channels.find(x=>x.id===m?.channelId);const sv=db.servers.find(x=>x.id===ch?.serverId);
    if(!m||!ch||!sv||!staff(sv.members[u.id]))return error(res,'Sem permissão.',403);
    m.pinned=!m.pinned;save();notifyMessage('update-message',m);return tokenize(res,{ok:true,pinned:m.pinned});
  }
  if(p==='/api/search'&&method==='GET'){
    const q=String(params.get('q')||'').trim().toLowerCase();if(q.length<2)return tokenize(res,{results:[]});
    const results=db.messages.filter(m=>m.content.toLowerCase().includes(q)&& (m.channelId?readable(db.channels.find(c=>c.id===m.channelId)||{},u):[m.senderId,m.dmUserId].includes(u.id))).slice(-60).reverse();
    return tokenize(res,{results});
  }
  if(p==='/api/profile'&&method==='PATCH'){
    const b=await body(req);
    if(b.displayName!==undefined){const v=String(b.displayName).trim().slice(0,32);if(!v)return error(res,'Nome inválido.');u.displayName=v;}
    if(b.status!==undefined){if(!['online','idle','dnd','invisible'].includes(b.status))return error(res,'Status inválido.');u.status=b.status;}
    if(b.bio!==undefined)u.bio=String(b.bio).slice(0,130);
    if(b.avatar!==undefined){if(b.avatar && !/^\/uploads\/[\w.-]+$/.test(b.avatar))return error(res,'Imagem inválida.');u.avatar=b.avatar;}
    await persistImmediate();broadcast('user-update',publicUser(u));return tokenize(res,{me:publicUser(u)});
  }
  if(p==='/api/upload'&&method==='POST'){
    const b=await body(req);const name=safeFilename(b.name);const type=String(b.type||'application/octet-stream').slice(0,100);
    const match=String(b.data||'').match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
    if(!match)return error(res,'Arquivo inválido.');
    const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>5*1024*1024)return error(res,'Tamanho máximo de arquivo: 5 MB.');
    const allowExt=['.png','.jpg','.jpeg','.webp','.gif','.pdf','.txt','.mp3','.ogg','.mp4','.webm','.zip','.json'];
    const ext=path.extname(name).toLowerCase();if(!allowExt.includes(ext))return error(res,'Formato não permitido. Use PNG, JPG, GIF, PDF, TXT, áudio, vídeo, ZIP ou JSON.');
    const file=uid()+ext;db.files[file]={data:bytes.toString('base64'),createdAt:now()};await persistImmediate();
    if(!usePg)fs.writeFileSync(path.join(UPLOADS,file),bytes);
    return tokenize(res,{attachment:{url:'/uploads/'+file,name,type,size:bytes.length}});
  }
  if(p==='/api/servers'&&method==='POST'){
    const b=await body(req);const name=String(b.name||'').trim().slice(0,45);if(name.length<3)return error(res,'Nome curto demais.');
    const server={id:uid(),name,description:String(b.description||'Um novo espaço no Sinalis').slice(0,100),ownerId:u.id,inviteCode:invite(),createdAt:now(),members:{[u.id]:'mestre'}};
    db.servers.push(server);db.channels.push(...starterChannels(server.id));save();return tokenize(res,{server:{...server,members:undefined}},201);
  }
  if(p==='/api/servers/join'&&method==='POST'){
    const b=await body(req);const code=String(b.code||'').toUpperCase().trim();const server=db.servers.find(x=>x.inviteCode===code);
    if(!server)return error(res,'Convite inválido.',404);server.members[u.id]||='player';save();broadcast('server-update',{serverId:server.id});return tokenize(res,{serverId:server.id});
  }
  if(p==='/api/servers'&&method==='PATCH'){
    const b=await body(req);const server=requireServer(res,u,b.serverId);if(!server)return;
    if(!manage(server.members[u.id]))return error(res,'Sem permissão.',403);
    if(b.name!==undefined){const n=String(b.name).trim().slice(0,45);if(n.length<3)return error(res,'Nome inválido.');server.name=n;}
    if(b.description!==undefined)server.description=String(b.description).slice(0,100);
    if(b.resetInvite)server.inviteCode=invite();save();broadcast('server-update',{serverId:server.id},Object.keys(server.members));return tokenize(res,{ok:true});
  }
  if(p==='/api/channels'&&method==='POST')return error(res,'Os canais fixos são #geral, #midias, #dados, Call e Sessão.',403);
  if(false&&p==='/api/channels'&&method==='POST'){
    const b=await body(req);const server=requireServer(res,u,b.serverId);if(!server)return;
    if(!manage(server.members[u.id]))return error(res,'Só fundador e administradores podem criar canais.',403);
    const name=String(b.name||'').trim().slice(0,40);if(name.length<2)return error(res,'Nome de canal muito curto.');
    const ch={id:uid(),serverId:server.id,name,type:b.type==='voice'?'voice':'text',category:String(b.category||'CONVERSAS').slice(0,40),readOnly:!!b.readOnly,restricted:!!b.restricted,description:String(b.description||'').slice(0,160),position:db.channels.filter(c=>c.serverId===server.id).length};
    db.channels.push(ch);save();broadcast('channel-update',{serverId:server.id},Object.keys(server.members));return tokenize(res,{channel:ch},201);
  }
  const channelRoute=p.match(/^\/api\/channels\/([\w-]+)$/);
  if(channelRoute&&(method==='PATCH'||method==='DELETE'))return error(res,'Os canais do sinais escarlate estão fixos nesta versão.',403);
  if(false&&channelRoute&&(method==='PATCH'||method==='DELETE')){
    const ch=db.channels.find(c=>c.id===channelRoute[1]);if(!ch)return error(res,'Canal não encontrado.',404);
    const server=requireServer(res,u,ch.serverId);if(!server)return;
    if(!manage(server.members[u.id]))return error(res,'Sem permissão.',403);
    if(method==='DELETE'){
      db.channels=db.channels.filter(c=>c.id!==ch.id);db.messages=db.messages.filter(m=>m.channelId!==ch.id);
      for(const [id,v] of voices)if(v.room===ch.id)leaveVoice(id);
    } else {const b=await body(req);
      if(b.name!==undefined){const name=String(b.name).trim().slice(0,40);if(name.length<2)return error(res,'Nome inválido.');ch.name=name;}
      for(const k of ['description','category'])if(b[k]!==undefined)ch[k]=String(b[k]).slice(0,k==='description'?160:40);
      for(const k of ['readOnly','restricted'])if(b[k]!==undefined)ch[k]=!!b[k];
    }
    save();broadcast('channel-update',{serverId:server.id},Object.keys(server.members));return tokenize(res,{ok:true});
  }
  if(p==='/api/roles'&&method==='POST')return error(res,'Os cargos são definidos automaticamente: Mestre e Player.',403);
  if(p==='/api/typing'&&method==='POST'){
    const b=await body(req);const ch=db.channels.find(c=>c.id===b.channelId);
    if(ch&&readable(ch,u)){const sv=db.servers.find(x=>x.id===ch.serverId);broadcast('typing',{userId:u.id,channelId:ch.id},Object.keys(sv.members));}
    else if(b.dmUserId&&db.users.some(x=>x.id===b.dmUserId))sendTo(b.dmUserId,'typing',{userId:u.id,dmUserId:u.id});
    return tokenize(res,{ok:true});
  }
  if(p==='/api/voice/join'&&method==='POST'){
    const b=await body(req);const ch=db.channels.find(c=>c.id===b.channelId);
    if(!ch||ch.type!=='voice'||!readable(ch,u))return error(res,'Canal de voz inválido.',403);
    const people=voicePeople(ch.id).filter(x=>x.id!==u.id);
    const server=db.servers.find(x=>x.id===ch.serverId);
    const serverMuted=!!server?.voiceMutedUsers?.[u.id];
    voices.set(u.id,{room:ch.id,muted:serverMuted,serverMuted,deaf:false,video:false,sharing:false});voiceState();
    return tokenize(res,{people,serverMuted});
  }
  if(p==='/api/voice/leave'&&method==='POST'){leaveVoice(u.id);return tokenize(res,{ok:true});}
  if(p==='/api/voice/state'&&method==='POST'){
    const b=await body(req);const v=voices.get(u.id);if(!v)return error(res,'Não está em chamada.',400);
    for(const k of ['muted','deaf','video','sharing'])if(b[k]!==undefined)v[k]=!!b[k];if(v.serverMuted)v.muted=true;voiceState();return tokenize(res,{ok:true,muted:v.muted,serverMuted:!!v.serverMuted});
  }
  if(p==='/api/voice/signal'&&method==='POST'){
    const b=await body(req);const mine=voices.get(u.id),theirs=voices.get(b.to);
    if(!mine||!theirs||mine.room!==theirs.room)return error(res,'Participante não está na mesma chamada.',403);
    if(!['offer','answer','candidate','media-info'].includes(b.kind))return error(res,'Sinal inválido.');
    sendTo(b.to,'signal',{from:u.id,kind:b.kind,data:b.data});return tokenize(res,{ok:true});
  }
  return error(res,'Rota não encontrada.',404);
}
const eventTickets=new Map();
const loginAttempts=new Map();
const app=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const pathname=decodeURIComponent(url.pathname);
  try{
    if(pathname.startsWith('/api/'))return await api(req,res,pathname,url.searchParams);
    if(req.method!=='GET'&&req.method!=='HEAD')return error(res,'Método indisponível.',405);
    if(pathname.includes('..'))return error(res,'Caminho inválido.',400);
    return serveFile(req,res,pathname);
  }catch(e){console.error('Erro:',e.message);if(!res.headersSent)return error(res,e.message||'Erro interno.',e.status||500);}
});
initialize().then(()=>app.listen(PORT,HOST,()=>console.log('SINALIS online na porta '+PORT))).catch(err=>{console.error('Falha ao iniciar banco de dados:',err);process.exit(1)});
async function shutdown(){if(saveTimer)clearTimeout(saveTimer);await persistImmediate().catch(console.error);if(pool)await pool.end().catch(console.error);process.exit(0)}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
