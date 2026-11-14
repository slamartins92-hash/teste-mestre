'use strict';
// Instala os arquivos do projeto a partir do pacote versionado.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const encoded=fs.readFileSync(path.join(__dirname,'payload.b64'),'utf8').replace(/\s+/g,'');
const source=zlib.gunzipSync(Buffer.from(encoded,'base64'));
const files=JSON.parse(source.toString('utf8'));
for(const [name,body] of Object.entries(files)){
  if(!['server.js','public/bridge.js','public/mestre.js','public/mestre.html'].includes(name))throw Error('Arquivo não permitido: '+name);
  const out=path.join(__dirname,name);
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,body,'utf8');
}
require('./server.js');
