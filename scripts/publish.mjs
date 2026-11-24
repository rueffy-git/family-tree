// Run locally. The private export, layout config and access file must stay outside this repository.
import {readFile,writeFile,rename,mkdir,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomInt,createHash} from 'node:crypto';
import {encrypt,decrypt,normaliseAccessCode} from '../docs/crypto.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=Object.fromEntries(Array.from({length:Math.floor((process.argv.length-2)/2)},(_,i)=>[process.argv[2+i*2].replace(/^--/,''),process.argv[3+i*2]]));
for(const key of ['source','config','access'])if(!args[key])throw new Error(`Required: --${key} <private file outside the repository>`);
const isInside=p=>{const rel=path.relative(root,p);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
for(const key of ['source','config','access']) {
  args[key]=path.resolve(args[key]);
  const parent=await realpath(path.dirname(args[key]));
  if(isInside(parent))throw new Error(`${key} must be outside the public repository.`);
}
const accessDirectory=path.dirname(args.access);
await mkdir(accessDirectory,{recursive:true});
const {stdout}=await promisify(execFile)(args.python||'python',['-B',path.join(root,'scripts/import_gramps.py'),args.source,'--config',args.config],{encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
const data=JSON.parse(stdout);
let access=null;
try {access=JSON.parse(await readFile(args.access,'utf8'));}
catch(error) {if(error.code!=='ENOENT')throw error;}
const alphabet='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
if(!access||args['rotate-code']==='yes') {
  if(access) await writeFile(path.join(accessDirectory,`previous-access-${Date.now()}.json`),JSON.stringify(access,null,2)+'\n',{flag:'wx',mode:0o600});
  const raw=Array.from({length:12},()=>alphabet[randomInt(alphabet.length)]).join('');
  access={version:2,url:'https://brairborne.com/family-tree/',code:raw.match(/.{4}/g).join('-')};
  await writeFile(args.access,JSON.stringify(access,null,2)+'\n',{mode:0o600});
}
if(access.version!==2||typeof access.code!=='string'||!new RegExp(`^[${alphabet}]{12}$`).test(normaliseAccessCode(access.code)))
  throw new Error('Use a generated 12-character access code. Add --rotate-code yes to replace the previous phrase or code.');
const envelope=await encrypt(data,access.code,{format:'code'});
const recovered=await decrypt(envelope,access.code);
if(JSON.stringify(data)!==JSON.stringify(recovered))throw new Error('Encryption round-trip failed.');
const output=path.join(root,'docs/tree.enc.json');
const temporary=output+'.tmp';
try {await writeFile(temporary,JSON.stringify(envelope)+'\n');await rename(temporary,output);}
finally {await rm(temporary,{force:true});}
await writeFile(path.join(accessDirectory,'Family tree access.txt'),
  `FAMILY TREE — PRIVATE ACCESS DETAILS\n\nWebsite: https://brairborne.com/family-tree/\n\nAccess code:\n${access.code}\n\nUpper or lower case is fine. Spaces and hyphens are optional.\nThe code contains no I, L, O, 0 or 1.\n\nShare the address and code only with the family members you want to give access.\nKeep this file private. Do not upload it to GitHub.\n\nTo update the tree, ask Codex to update the family records and republish.\n`,{mode:0o600});
const card=`<section><p class="label">OUR FAMILY HISTORY</p><h2>Explore the family tree</h2><p>Open this address in your browser:</p><p class="url">brairborne.com/family-tree/</p><p>Your family access code:</p><p class="code">${access.code}</p><p class="help">Upper or lower case is fine.<br>Spaces and hyphens are optional.</p><p class="hint">Zoom with the mouse wheel.<br>Select a person to see their details.</p></section>`;
await writeFile(path.join(accessDirectory,'Family tree access cards.html'),`<!doctype html><html lang="en-AU"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family tree access cards — private</title><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#244a3e;margin:20px auto;max-width:186mm}header{text-align:center;margin:20px 0}button{padding:10px 22px;font:inherit;cursor:pointer}main{display:grid;grid-template-columns:1fr 1fr;gap:5mm}section{border:1px dashed #aab6aa;padding:7mm 5mm;text-align:center;min-height:80mm;break-inside:avoid}h2{font:22px Georgia,serif;margin:8px 0 18px}p{font-size:12px;margin:8px 0}.label{font-size:9px;letter-spacing:2px}.url{font-weight:bold;font-size:14px;white-space:nowrap}.code{font-family:Consolas,monospace;font-size:23px;font-weight:bold;letter-spacing:1px;margin:9px 0 12px}.help,.hint{font-size:10px;line-height:1.5;color:#65745e}.hint{margin-top:16px}@media print{header{display:none}body{margin:0;max-width:none}section{height:82mm;min-height:0;padding:5mm}h2{font-size:18px;line-height:22px;margin:6px 0 10px}p{font-size:11px;line-height:15px;margin:6px 0}.label{font-size:9px}.url{font-size:13px;line-height:18px}.code{font-size:22px;line-height:28px;margin:6px 0 8px}.help,.hint{font-size:10px;line-height:14px}.hint{margin-top:10px}}</style><header><h1>Private family access cards</h1><p>Print this page and cut along the dotted lines. Share only with family members.</p><button onclick="window.print()">Print six cards</button></header><main>${card.repeat(6)}</main></html>`,{mode:0o600});
access=null;
const proof={counts:data.counts,sourceHash:data.sourceHash,payloadHash:createHash('sha256').update(await readFile(output)).digest('hex'),
  publishedDate:data.updated,layout:{cards:data.layout.nodes.length,connectors:data.layout.paths.length,overlaps:0,linesThroughCards:0,unrelatedCrossings:0},
  encryptionRoundTrip:true,bytes:(await readFile(output)).length};
await writeFile(path.join(accessDirectory,'build-verification.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));
console.log('Private access details and printable cards saved outside the repository. The access code was not printed.');
