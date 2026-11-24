import test from 'node:test';
import assert from 'node:assert/strict';
import {Draft,savePerson,saveFamily,removePerson,blankFamily,rebuildReferences,validateRecords,parseDate} from '../docs/records.js';
import {arrange,originalLayout,checkGeometry} from '../docs/layout.js';
import {OwnerConnection,repository} from '../docs/github.js';
import {encrypt} from '../docs/crypto.js';
import {fixture} from './fixture.mjs';

test('adding a child, changing parents and undo preserve the original records',async()=>{
  const data=fixture();data.layout=await arrange(data,'main');const before=structuredClone(data),draft=new Draft(data,arrange);
  await draft.change(d=>{
    savePerson(d,'new',{name:'New Example',gender:'U',otherNames:[],tags:[],notes:[{text:'A new note'}],events:[{type:'Birth',date:'2025-03-30',qualifier:'',description:'Recorded by owner'}]});
    const f=d.families.find(f=>f.id==='couple');f.children.push('new');
  },true);
  assert.equal(draft.data.people.length,10);assert.deepEqual(draft.data.people.find(p=>p.id==='new').parentFamilies,['couple']);checkGeometry(draft.data.layout);
  await draft.change(d=>{d.families.find(f=>f.id==='couple').children=['f'];d.families.find(f=>f.id==='single').children.push('new');},true);
  assert.deepEqual(draft.data.people.find(p=>p.id==='new').parentFamilies,['single']);
  draft.undo();assert.deepEqual(draft.data.people.find(p=>p.id==='new').parentFamilies,['couple']);draft.undo();assert.deepEqual(draft.data,before);assert.equal(draft.dirty,false);draft.redo();assert.equal(draft.dirty,true);assert.deepEqual(data,before);
});
test('shared notes and events are copied when changing one person',()=>{
  const data=fixture();data.notes=[{id:'n',type:'Person Note',text:'Original'}];data.events=[{id:'event',type:'Birth',date:{kind:'dateval',val:'1900',quality:'estimated'},description:'Original date',notes:[],citations:[]}];
  for(const person of data.people.slice(0,2)){person.notes=['n'];person.events=['event'];}
  savePerson(data,'a',{name:'Alex Updated',gender:'U',otherNames:[],tags:[],notes:[{id:'n',text:'Corrected note'}],events:[{id:'event',type:'Birth',date:'1901',qualifier:'',description:'Corrected date'}]});
  assert.equal(data.notes.find(n=>n.id==='n').text,'Original');assert.equal(data.events.find(e=>e.id==='event').date.val,'1900');assert.equal(data.people[1].notes[0],'n');assert.equal(data.people[1].events[0],'event');validateRecords(data);
});
test('invalid family links and ancestry loops leave the draft unchanged',async()=>{
  const data=fixture();data.layout=await arrange(data,'main');const draft=new Draft(data,arrange),before=structuredClone(draft.data);
  await assert.rejects(draft.change(d=>{const f=blankFamily();f.parents=['f'];f.children=['a'];saveFamily(d,f);},true),/own ancestor/);
  assert.deepEqual(draft.data,before);
  await assert.rejects(draft.change(d=>{d.families[0].parents=['a','a'];},true),/repeated/);
  await assert.rejects(draft.change(d=>{d.families[0].children.push('missing');},true),/missing/);
});
test('remove person unlinks both directions and can be undone',async()=>{
  const data=fixture();data.layout=await arrange(data,'main');const draft=new Draft(data,arrange);
  await draft.change(d=>removePerson(d,'c'),true);validateRecords(draft.data);assert.equal(draft.data.people.length,8);assert.ok(draft.data.families.every(f=>!f.parents.includes('c')&&!f.children.includes('c')));draft.undo();assert.deepEqual(draft.data,data);
});
test('complex partnerships and ancestor siblings with children still draw each person once',async()=>{
  const data=fixture();data.families.push({...blankFamily(),id:'extra',parents:['c','h'],children:['i']});
  data.families.push({...blankFamily(),id:'loop-partnership',parents:['e','h'],children:[]});rebuildReferences(data);validateRecords(data);
  assert.throws(()=>originalLayout(data,'main'));const layout=await arrange(data,'main');assert.equal(layout.mode,'general');assert.equal(new Set(layout.nodes.map(n=>n.id)).size,data.people.length);checkGeometry(layout);
});
test('date editing rejects impossible dates and retains uncertain text',()=>{
  assert.throws(()=>parseDate('2025-02-30'),/valid date/);assert.throws(()=>parseDate('2025-00'),/valid date/);
  assert.deepEqual(parseDate('2024-02-29','about'),{kind:'dateval',val:'2024-02-29',type:'about'});assert.deepEqual(parseDate('Between 1880 and 1883'),{kind:'datestr',val:'Between 1880 and 1883'});
});
function githubMock({userId=repository.ownerId,push=true}={}){
  let envelope={ciphertext:'synthetic'},sha='first',puts=0,failAfterWrite=false,conflict=false;
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});assert.ok(url.startsWith('https://api.github.com/'));assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    if(url.endsWith('/user'))return Response.json({id:userId,login:'synthetic-owner'});
    if(url.endsWith('/family-tree'))return Response.json({id:repository.id,owner:{id:repository.ownerId},permissions:{push}});
    if(options.method==='PUT'){
      puts++;const body=JSON.parse(options.body);assert.equal(body.branch,'main');assert.equal(body.message,'Update family tree records');
      if(conflict||body.sha!==sha)return Response.json({}, {status:409});
      envelope=JSON.parse(Buffer.from(body.content,'base64').toString());sha='next';if(failAfterWrite)throw new Error('network');return Response.json({commit:{sha:'commit'},content:{sha}});
    }
    return Response.json({type:'file',encoding:'base64',sha,content:Buffer.from(JSON.stringify(envelope)).toString('base64')});
  };
  return {fetcher,calls,get puts(){return puts;},advance(){sha='remote-change';},failResponse(){failAfterWrite=true;},conflict(){conflict=true;}};
}
test('a family code and another GitHub account cannot enter owner mode or publish',async()=>{
  const mock=githubMock({userId:123});const conn=new OwnerConnection(mock.fetcher);
  await assert.rejects(conn.connect('FAMILY-VIEW-CODE'),/fine-grained/);assert.equal(mock.calls.length,0);
  await assert.rejects(conn.connect('github_pat_synthetic'),/Only the owner/);assert.equal(conn.connected,false);await assert.rejects(conn.publish({},'first'),/Connect/);assert.equal(mock.puts,0);
  const noPush=new OwnerConnection(githubMock({push:false}).fetcher);await assert.rejects(noPush.connect('github_pat_synthetic'),/cannot publish/);
});
test('publishing sends only ciphertext to the single authorised file, and uses its current version',async()=>{
  const mock=githubMock(),conn=new OwnerConnection(mock.fetcher);await conn.connect('github_pat_synthetic');
  const current=await conn.read(),encrypted=await encrypt({name:'Synthetic private record'},'TEST-ONLY-CODE',{format:'code'});
  const saved=await conn.publish(encrypted,current.sha);assert.equal(saved.sha,'next');assert.equal(mock.puts,1);
  const request=mock.calls.find(c=>c.options.method==='PUT');assert.equal(new URL(request.url).pathname,'/repos/rueffy-git/family-tree/contents/docs/tree.enc.json');assert.ok(!request.options.body.includes('Synthetic private record'));assert.ok(!request.options.body.includes('TEST-ONLY-CODE'));assert.ok(!request.options.body.includes('github_pat_'));
  conn.disconnect();await assert.rejects(conn.read(),/Connect/);
});
test('concurrent remote changes cannot be overwritten, including a race after the check',async()=>{
  const mock=githubMock(),conn=new OwnerConnection(mock.fetcher);await conn.connect('github_pat_synthetic');const current=await conn.read();mock.advance();
  await assert.rejects(conn.publish({ciphertext:'new'},current.sha),/online tree changed/);assert.equal(mock.puts,0);
  const second=githubMock(),other=new OwnerConnection(second.fetcher);await other.connect('github_pat_synthetic');second.conflict();await assert.rejects(other.publish({ciphertext:'new'},'first'),/online tree changed/);assert.equal(second.puts,1);
});
test('a lost save response is checked once and never causes a duplicate write',async()=>{
  const mock=githubMock(),conn=new OwnerConnection(mock.fetcher);await conn.connect('github_pat_synthetic');mock.failResponse();
  const result=await conn.publish({ciphertext:'new'},'first');assert.equal(result.sha,'next');assert.equal(mock.puts,1);
});
