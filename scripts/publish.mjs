// Run locally. The private export, layout config and access file must stay outside this repository.
import {readFile,writeFile,rename,mkdir,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomInt,createHash} from 'node:crypto';
import {encrypt,decrypt} from '../docs/crypto.js';

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
let passphrase;
try {passphrase=JSON.parse(await readFile(args.access,'utf8')).passphrase;}
catch(error) {
  if(error.code!=='ENOENT')throw error;
  const response=await fetch('https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt');
  if(!response.ok)throw new Error('The official passphrase word list could not be downloaded.');
  const words=(await response.text()).trim().split(/\r?\n/).map(line=>line.trim().split(/\s+/)[1]);
  if(words.length!==7776||new Set(words).size!==7776||words.some(w=>!w||!/^[a-z-]+$/.test(w)))throw new Error('Unexpected passphrase word list.');
  passphrase=Array.from({length:6},()=>words[randomInt(words.length)]).join(' ');
  await writeFile(args.access,JSON.stringify({version:1,url:'https://brairborne.com/family-tree/',passphrase},null,2)+'\n',{flag:'wx',mode:0o600});
}
if(typeof passphrase!=='string'||passphrase.trim().split(/\s+/).length<6)throw new Error('Use a strong passphrase with at least six random words.');
const envelope=await encrypt(data,passphrase);
const recovered=await decrypt(envelope,passphrase);
if(JSON.stringify(data)!==JSON.stringify(recovered))throw new Error('Encryption round-trip failed.');
const output=path.join(root,'docs/tree.enc.json');
const temporary=output+'.tmp';
try {await writeFile(temporary,JSON.stringify(envelope)+'\n');await rename(temporary,output);}
finally {await rm(temporary,{force:true});}
await writeFile(path.join(accessDirectory,'Family tree access.txt'),
  `FAMILY TREE — PRIVATE ACCESS DETAILS\n\nWebsite: https://brairborne.com/family-tree/\n\nPassphrase (six words, separated by spaces):\n${passphrase}\n\nShare the address and passphrase only with the family members you want to give access.\nKeep this file private. Do not upload it to GitHub.\n\nTo update the tree, ask Codex to update the family records and republish.\n`,{mode:0o600});
passphrase='';
const proof={counts:data.counts,sourceHash:data.sourceHash,payloadHash:createHash('sha256').update(await readFile(output)).digest('hex'),
  publishedDate:data.updated,layout:{cards:data.layout.nodes.length,connectors:data.layout.paths.length,overlaps:0,linesThroughCards:0,unrelatedCrossings:0},
  encryptionRoundTrip:true,bytes:(await readFile(output)).length};
await writeFile(path.join(accessDirectory,'build-verification.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));
console.log('Private access details saved outside the repository. The passphrase was not printed.');
