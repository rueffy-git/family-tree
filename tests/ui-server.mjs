// Synthetic browser integration fixture. Never serves real family records and
// never makes a request to GitHub. This file is outside the published docs folder.
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {encrypt} from '../docs/crypto.js';
import {arrange} from '../docs/layout.js';
import {repository} from '../docs/github.js';
import {fixture} from './fixture.mjs';
const docs=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../docs');
const data=fixture();data.layout=await arrange(data,'main');
let envelope=await encrypt(data,'TESTONLYCODE',{format:'code'}),revision=1,writes=0;
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/__test_state'){json({writes,revision});return;}
    if(url.pathname==='/__test_api'){
      const target=new URL(url.searchParams.get('url'));if(target.origin!=='https://api.github.com'){json({},400);return;}
      const token=req.headers.authorization;
      if(!['Bearer github_pat_synthetic_owner','Bearer github_pat_synthetic_visitor'].includes(token)){json({},401);return;}
      if(target.pathname==='/user'){json({id:token.includes('_owner')?repository.ownerId:123,login:'synthetic-owner'});return;}
      if(target.pathname==='/repos/rueffy-git/family-tree'){json({id:repository.id,owner:{id:repository.ownerId},permissions:{push:true}});return;}
      if(target.pathname!==`/repos/rueffy-git/family-tree/contents/${repository.file}`){json({},404);return;}
      if(req.method==='PUT'){
        if(!token.includes('_owner')){json({},403);return;}
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
        if(body.sha!==String(revision)){json({},409);return;}
        envelope=JSON.parse(Buffer.from(body.content,'base64').toString('utf8'));revision++;writes++;json({content:{sha:String(revision)},commit:{sha:'synthetic-commit'}});return;
      }
      json({type:'file',encoding:'base64',sha:String(revision),content:Buffer.from(JSON.stringify(envelope)).toString('base64')});return;
    }
    if(!url.pathname.startsWith('/family-tree/')){json({},404);return;}
    const name=decodeURIComponent(url.pathname.slice('/family-tree/'.length))||'index.html';
    if(name==='tree.enc.json'){json(envelope);return;}
    if(name==='editor-test-adapter.js'){
      res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});
      res.end(`import {createEditor as realEditor} from './editor.js';import {OwnerConnection} from './github.js';export function createEditor(bridge){return realEditor(bridge,{connection:new OwnerConnection((url,options)=>fetch('/__test_api?url='+encodeURIComponent(url),options))});}`);return;
    }
    const file=path.resolve(docs,name),rel=path.relative(docs,file);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('outside');
    let bytes=await readFile(file);
    if(name==='app.js')bytes=Buffer.from(bytes.toString().replace("import('./editor.js')","import('./editor-test-adapter.js')"));
    if(name==='index.html')bytes=Buffer.from(bytes.toString().replaceAll('Our family tree','Synthetic test tree'));
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(bytes);
  }catch{json({error:'Test server request failed'},500);}
});
server.listen(4174,'127.0.0.1',()=>console.log('Synthetic UI checks: http://127.0.0.1:4174/family-tree/'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
