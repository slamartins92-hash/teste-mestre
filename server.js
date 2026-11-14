'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.MASTER_PASSWORD || 'sinais';
const INDEX = path.join(__dirname, 'public', 'index.html');
const STATE_FILE = path.join(__dirname, '.data', 'state.json');
const sessions = new Map();
const viewers = new Set();
const failedAttempts = new Map();
const MAX_BYTES = 400_000;
let state = { active: false, text: '', updatedAt: null, revision: 0, scare: { phase: 'off', image: null } };
try {
  const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (typeof loaded.active === 'boolean' && typeof loaded.text === 'string') state = loaded;
} catch (_) {}
if (!state.scare || typeof state.scare !== 'object') state.scare = { phase: 'off', image: null };

function saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const temp = STATE_FILE + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(state));
    fs.renameSync(temp, STATE_FILE);
  } catch (err) { console.error('Não foi possível salvar estado:', err.message); }
}
function json(res, status, data, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(data));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let content = '';
    req.on('data', chunk => {
      content += chunk;
      if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) { reject(new Error('Conteúdo muito grande')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(content || '{}')); } catch (_) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(x => x.trim().split(/=(.*)/s).slice(0,2)).filter(([k,v]) => k && v !== undefined));
}
function getSession(req) {
  const token = cookies(req).sinais_admin;
  if (!token) return null;
  const expires = sessions.get(token);
  if (!expires || expires < Date.now()) { sessions.delete(token); return null; }
  return token;
}
function isPasswordCorrect(input) {
  if (typeof input !== 'string') return false;
  const a = crypto.createHash('sha256').update(input, 'utf8').digest();
  const b = crypto.createHash('sha256').update(PASSWORD, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}
function broadcast() {
  const message = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const client of viewers) {
    try { client.write(message); } catch (_) { viewers.delete(client); }
  }
}
function handleEvents(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no'
  });
  res.write(`retry: 2500\nevent: state\ndata: ${JSON.stringify(state)}\n\n`);
  viewers.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 20000);
  const clean = () => { clearInterval(ping); viewers.delete(res); };
  res.on('close', clean);
}
function cookieHeader(req, token, maxAge) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `sinais_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
function notAuthorized(res) { json(res, 401, { error: 'Acesso do mestre necessário' }); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const route = url.pathname;
  try {
    if (req.method === 'GET' && (route === '/' || route === '/index.html')) {
      return res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'same-origin'
      }).end(fs.readFileSync(INDEX));
    }
    if (req.method === 'GET' && route === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && route === '/api/state') return json(res, 200, state);
    if (req.method === 'GET' && route === '/api/events') return handleEvents(req, res);
    if (req.method === 'GET' && route === '/api/me') return json(res, 200, { admin: !!getSession(req) });
    if (req.method === 'POST' && route === '/api/login') {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).slice(0, 100);
      const record = failedAttempts.get(ip) || { count: 0, reset: Date.now() + 60000 };
      if (Date.now() > record.reset) { record.count = 0; record.reset = Date.now() + 60000; }
      if (record.count >= 10) return json(res, 429, { error: 'Muitas tentativas. Tente novamente em um minuto.' });
      const body = await readJson(req);
      if (!isPasswordCorrect(body.password)) {
        record.count++;
        failedAttempts.set(ip, record);
        return json(res, 401, { error: 'Senha incorreta' });
      }
      failedAttempts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
      return json(res, 200, { admin: true }, { 'set-cookie': cookieHeader(req, token, 43200) });
    }
    if (req.method === 'POST' && route === '/api/logout') {
      const token = getSession(req);
      if (token) sessions.delete(token);
      return json(res, 200, { admin: false }, { 'set-cookie': cookieHeader(req, '', 0) });
    }
    if (req.method === 'POST' && route === '/api/broadcast') {
      if (!getSession(req)) return notAuthorized(res);
      const body = await readJson(req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > 240) return json(res, 400, { error: 'Escreva de 1 a 240 caracteres.' });
      state = { ...state, active: true, text, updatedAt: new Date().toISOString(), revision: (state.revision || 0) + 1 };
      saveState();
      broadcast();
      return json(res, 200, { ok: true, state });
    }
    if (req.method === 'DELETE' && route === '/api/broadcast') {
      if (!getSession(req)) return notAuthorized(res);
      state = { ...state, active: false, text: '', updatedAt: new Date().toISOString(), revision: (state.revision || 0) + 1 };
      saveState();
      broadcast();
      return json(res, 200, { ok: true, state });
    }
    if (req.method === 'POST' && route === '/api/scare/start') {
      if (!getSession(req)) return notAuthorized(res);
      state = { ...state, scare: { phase:'glitch', image:null }, revision:(state.revision||0)+1, updatedAt:new Date().toISOString() };
      saveState(); broadcast(); return json(res,200,{ok:true,state});
    }
    if (req.method === 'POST' && route === '/api/scare/reveal') {
      if (!getSession(req)) return notAuthorized(res);
      if (!state.scare || state.scare.phase === 'off') return json(res,409,{error:'Inicie o glitch antes de mostrar a imagem.'});
      const body=await readJson(req);
      const image=body.image;
      if (image !== 'dog' && !(typeof image==='string' && image.length < 290000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)))
        return json(res,400,{error:'Imagem inválida ou grande demais.'});
      state = { ...state, scare:{phase:'reveal',image}, revision:(state.revision||0)+1, updatedAt:new Date().toISOString() };
      saveState(); broadcast(); return json(res,200,{ok:true,state});
    }
    if (req.method === 'POST' && route === '/api/scare/stop') {
      if (!getSession(req)) return notAuthorized(res);
      state = { ...state, scare:{phase:'off',image:null}, revision:(state.revision||0)+1, updatedAt:new Date().toISOString() };
      saveState(); broadcast(); return json(res,200,{ok:true,state});
    }
    if (route.startsWith('/api/')) return json(res, 404, { error: 'Rota não encontrada' });
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Não encontrado');
  } catch (err) {
    if (!res.headersSent && !res.destroyed) json(res, 400, { error: err.message || 'Erro na requisição' });
  }
});
server.listen(PORT, HOST, () => console.log(`SINAIS: http://localhost:${PORT}`));