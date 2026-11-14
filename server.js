'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.MASTER_PASSWORD || 'sinais';
const INDEX = path.join(__dirname,'public','index.html');
const sessions = new Map();
const viewers = new Set();
const attempts = new Map();
let state = {active:false,text:'',revision:0,updatedAt:null};

function reply(res,status,data,headers={}) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let text='';
    req.on('data',chunk=>{
      text+=chunk;
      if(Buffer.byteLength(text)>8192){req.destroy();reject(new Error('Mensagem muito grande'));}
    });
    req.on('end',()=>{try{resolve(JSON.parse(text||'{}'));}catch(e){reject(new Error('JSON inválido'));}});
    req.on('error',reject);
  });
}
function isAllowed(req) {
  const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('teste_master='));
  if(!raw)return false;
  const token=raw.split('=')[1];
  const expiry=sessions.get(token);
  if(!expiry||expiry<Date.now()){sessions.delete(token);return false;}
  return true;
}
function cookie(req,token,age) {
  const secure=req.headers['x-forwarded-proto']==='https'?' Secure;':'';
  return 'teste_master='+token+'; Path=/; HttpOnly; SameSite=Lax; '+secure+' Max-Age='+age;
}
function broadcast(){
  const payload='event: state\ndata: '+JSON.stringify(state)+'\n\n';
  for(const stream of viewers){try{stream.write(payload);}catch(e){viewers.delete(stream);}}
}
function passwordOk(input){
  if(typeof input!=='string')return false;
  const a=crypto.createHash('sha256').update(input).digest();
  const b=crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a,b);
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  const route=url.pathname;
  try{
    if(req.method==='GET' && (route==='/'||route==='/index.html')){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return fs.createReadStream(INDEX).pipe(res);
    }
    if(req.method==='GET'&&route==='/health')return reply(res,200,{ok:true});
    if(req.method==='GET'&&route==='/api/state')return reply(res,200,state);
    if(req.method==='GET'&&route==='/api/me')return reply(res,200,{admin:isAllowed(req)});
    if(req.method==='GET'&&route==='/api/events'){
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.write('retry: 2500\nevent: state\ndata: '+JSON.stringify(state)+'\n\n');
      viewers.add(res);
      const ping=setInterval(()=>{try{res.write(': ping\n\n');}catch(e){}},20000);
      res.on('close',()=>{clearInterval(ping);viewers.delete(res);});
      return;
    }
    if(req.method==='POST'&&route==='/api/login'){
      const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0].slice(0,100);
      let rec=attempts.get(ip)||{count:0,reset:Date.now()+60000};
      if(Date.now()>rec.reset)rec={count:0,reset:Date.now()+60000};
      if(rec.count>=10)return reply(res,429,{error:'Muitas tentativas. Tente novamente em um minuto.'});
      const body=await readBody(req);
      if(!passwordOk(body.password)){
        rec.count++;attempts.set(ip,rec);
        return reply(res,401,{error:'Senha incorreta'});
      }
      attempts.delete(ip);
      const token=crypto.randomBytes(32).toString('hex');
      sessions.set(token,Date.now()+12*60*60*1000);
      return reply(res,200,{admin:true},{'Set-Cookie':cookie(req,token,43200)});
    }
    if(req.method==='POST'&&route==='/api/logout'){
      const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('teste_master='));
      if(raw)sessions.delete(raw.split('=')[1]);
      return reply(res,200,{admin:false},{'Set-Cookie':cookie(req,'',0)});
    }
    if(req.method==='POST'&&route==='/api/broadcast'){
      if(!isAllowed(req))return reply(res,401,{error:'Acesso do mestre necessário'});
      const body=await readBody(req);
      const text=typeof body.text==='string'?body.text.trim():'';
      if(!text||text.length>240)return reply(res,400,{error:'Escreva de 1 a 240 caracteres'});
      state={active:true,text,revision:state.revision+1,updatedAt:new Date().toISOString()};
      broadcast();
      return reply(res,200,{ok:true,state});
    }
    if(req.method==='DELETE'&&route==='/api/broadcast'){
      if(!isAllowed(req))return reply(res,401,{error:'Acesso do mestre necessário'});
      state={active:false,text:'',revision:state.revision+1,updatedAt:new Date().toISOString()};
      broadcast();
      return reply(res,200,{ok:true,state});
    }
    reply(res,404,{error:'Página não encontrada'});
  }catch(err){if(!res.headersSent&&!res.destroyed)reply(res,400,{error:err.message||'Erro'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log('Site teste iniciado na porta '+PORT));
