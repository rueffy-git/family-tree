import {decrypt} from './crypto.js';

const $ = id => document.getElementById(id);
const svgNS = 'http://www.w3.org/2000/svg';
const colours = ['#6f8e68','#6f8f94','#a88c59','#9b7867','#788496','#8a8f63','#77958a','#a28485','#798b62'];
let data = null, index = null, view = null, bounds = null, epoch = 0, busy = false, selected = null;
let ownerEditor = null, currentEnvelope = null;
const displayedNotes = new Set();
const pointers = new Map();
let gesture = null, moved = false, pressedPerson = null;

function element(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function svgElement(tag, attrs, text) {
  const el = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}
function formatDate(date) {
  if (!date) return '';
  const format = value => {
    if (!value) return '';
    if (!/^\d{4}(-\d{2}){0,2}$/.test(value)) return value;
    const [year, month, day] = value.split('-').map(Number);
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return [day || '', months[month-1] || '', year || ''].filter(Boolean).join(' ');
  };
  if (date.kind === 'datestr') return date.val || '';
  if (date.kind === 'daterange' || date.kind === 'datespan') return `${format(date.start)} – ${format(date.stop)}`;
  const prefix = {about:'About ',before:'Before ',after:'After ',estimated:'Estimated ',calculated:'Calculated '}[date.type] || '';
  const quality = date.quality ? `${date.quality.charAt(0).toUpperCase()}${date.quality.slice(1)} ` : '';
  return prefix + quality + format(date.val);
}
function personEvents(person) { return person.events.map(id => index.events.get(id)).filter(Boolean); }
function lifeYears(person) {
  return ['Birth','Death'].map((type, i) => {
    const event = personEvents(person).find(e => e.type === type);
    if (!event) return '';
    const raw = event.date?.val || '';
    const year = raw.match(/^\d{4}/)?.[0];
    return year ? `${i ? 'd.' : 'b.'} ${year}${event.date.type ? ' ?' : ''}` : (i ? 'Death recorded' : 'Birth recorded');
  }).filter(Boolean).join('  ·  ');
}
function wrapName(value) {
  const lines = [''];
  for (const word of value.split(/\s+/)) {
    const last = lines.length-1;
    if (lines[last] && (lines[last]+' '+word).length > 24) lines.push(word);
    else lines[last] += (lines[last] ? ' ' : '')+word;
  }
  return lines;
}
function validate(value) {
  if (value.version !== 1 || !value.layout || !Array.isArray(value.people) || !Array.isArray(value.families))
    throw new Error('Unsupported family records.');
  for (const name of ['events','notes','sources','citations']) if (!Array.isArray(value[name])) throw new Error('Incomplete family records.');
  const ids = new Set(value.people.map(p => p.id));
  if (ids.size !== value.people.length || value.layout.nodes.length !== ids.size ||
      new Set(value.layout.nodes.map(n => n.id)).size !== ids.size ||
      value.layout.nodes.some(n => !ids.has(n.id))) throw new Error('Incomplete tree layout.');
}
function renderTree() {
  const svg = $('tree');
  svg.replaceChildren();
  const lines = svgElement('g', {'aria-hidden':'true'});
  for (const edge of data.layout.paths) {
    const d = edge.points.map((p,i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ');
    lines.append(svgElement('path', {d, class:`connector ${edge.kind}`, 'data-family':edge.family}));
  }
  svg.append(lines);
  for (const junction of data.layout.junctions || []) svg.append(svgElement('circle', {cx:junction.x,cy:junction.y,r:4,class:'family-junction','aria-hidden':'true'}));
  for (const branch of data.layout.branches) {
    const person = index.people.get(branch.person);
    svg.append(svgElement('text', {x:branch.x+4, y:branch.y, class:'branch-number'}, `${String(branch.number).padStart(2,'0')}  ${person.name}`));
  }
  for (const label of data.layout.labels) {
    if (label.title) svg.append(svgElement('text', {x:label.x, y:label.y, class:'section-title'}, label.title));
    svg.append(svgElement('text', {x:label.x, y:label.y+(label.title ? 24 : 0), class:label.small?'small-note':'section-text'}, label.text));
  }
  for (const n of data.layout.nodes) {
    const p = index.people.get(n.id);
    const group = svgElement('g', {class:'person', 'data-person':p.id, id:`person-${p.id}`, tabindex:0, role:'button',
      'aria-label':`${p.name}${lifeYears(p) ? ', '+lifeYears(p) : ''}. Open details.`});
    group.append(svgElement('title', {}, p.name));
    group.append(svgElement('rect', {x:n.x, y:n.y, width:n.w, height:n.h, rx:10, class:'card'}));
    if (n.branch >= 0) group.append(svgElement('rect', {x:n.x+12, y:n.y+14, width:3, height:n.h-28, rx:1.5, fill:colours[n.branch%colours.length]}));
    const nameLines = wrapName(p.name);
    const lineHeight = nameLines.length > 3 ? 15 : 18;
    nameLines.forEach((line,i) => {
      const attrs = {x:n.x+25, y:n.y+25+i*lineHeight, class:'person-name'};
      if (line.length > 25) {attrs.textLength = n.w-39; attrs.lengthAdjust='spacingAndGlyphs';}
      group.append(svgElement('text', attrs, line));
    });
    group.append(svgElement('text', {x:n.x+25, y:n.y+n.h-13, class:'person-years'}, lifeYears(p)));
    group.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); e.stopPropagation(); showPerson(p.id);}
    });
    // Keyboard and assistive-technology activation; pointer activation is handled after drag detection.
    group.addEventListener('click', e => {if (e.detail === 0) showPerson(p.id);});
    svg.append(group);
  }
  const select = $('branch');
  select.replaceChildren(element('option', 'Complete tree'));
  select.firstChild.value = '';
  for (const b of data.layout.branches) {
    const option = element('option', `${b.number}. ${index.people.get(b.person).name}`);
    option.value = b.person; select.append(option);
  }
  bounds = data.layout.bounds;
}
function applyView() {
  if (!view) return;
  $('tree').setAttribute('viewBox', view.join(' '));
  $('zoom-level').textContent = `${Math.round($('stage').clientWidth/view[2]*100)}%`;
}
function fitBounds(rect) {
  const stage = $('stage'), ratio = stage.clientWidth/Math.max(1,stage.clientHeight);
  const width = Math.max(rect[2],rect[3]*ratio)*1.08, height = width/ratio;
  view = [rect[0]+rect[2]/2-width/2, rect[1]+rect[3]/2-height/2, width, height];
  applyView();
}
function fitTree() {
  if (!data) return;
  fitBounds(bounds); $('branch').value = '';
  $('view-status').textContent = 'The complete tree · Choose a branch or scroll to zoom in';
}
function zoom(factor, x=.5, y=.5) {
  if (!view) return;
  const stage = $('stage'), ratio = stage.clientWidth/Math.max(1,stage.clientHeight);
  const minWidth = stage.clientWidth/2.8;
  const maxWidth = Math.max(bounds[2],bounds[3]*ratio)*1.6;
  const width = Math.max(minWidth,Math.min(maxWidth,view[2]/factor)), height = width/ratio;
  view = [view[0]+(view[2]-width)*x,view[1]+(view[3]-height)*y,width,height]; applyView();
}
function selectPerson(id, move=false) {
  selected = id;
  $('tree').querySelectorAll('.selected').forEach(n => n.classList.remove('selected'));
  const node = $(`person-${id}`); node?.classList.add('selected');
  if (move) {
    const box = index.positions.get(id);
    fitBounds([box.x-400,box.y-170,box.w+800,box.h+340]);
    $('view-status').textContent = index.people.get(id).name;
  }
}
function personLink(id) {
  const p = index.people.get(id);
  const button = element('button', p?.name || 'Unknown person', 'person-link');
  button.addEventListener('click', () => {selectPerson(id,true);showPerson(id);});
  return button;
}
function section(title) {
  const block = element('section', undefined, 'record-section'); block.append(element('h3',title)); return block;
}
function appendNotes(container, ids) {
  for (const id of [...new Set(ids)]) {
    const note = index.notes.get(id);
    if (note?.text && !displayedNotes.has(note.text.trim())) {
      container.append(element('p',note.text,'note')); displayedNotes.add(note.text.trim());
    }
  }
}
function appendEvent(container, event) {
  const row = element('div',undefined,'record-event');
  row.append(element('strong',event.type),element('span',formatDate(event.date)||'Date not recorded')); container.append(row);
  if (event.description) container.append(element('p',event.description));
  appendNotes(container,event.notes);
}
function showPerson(id) {
  if (!data) return;
  const person = index.people.get(id); if (!person) return;
  displayedNotes.clear();
  selectPerson(id);
  const content = $('person-content'); content.replaceChildren();
  const name = element('h2',person.name); name.id='person-name'; name.tabIndex=-1; content.append(name);
  content.append(element('p',lifeYears(person)||'Dates not recorded','person-subtitle'));
  const events = personEvents(person);
  if (events.length) {
    const block = section('Dates and events'); events.forEach(e=>appendEvent(block,e)); content.append(block);
  }
  const parents = section('Parents and siblings');
  const knownSiblings = new Set([id]);
  const recordedParents = new Set();
  if (!person.parentFamilies.length) parents.append(element('p','Parents are not recorded.','muted'));
  for (const fid of person.parentFamilies) {
    const family = index.families.get(fid);
    family.parents.forEach(p=>recordedParents.add(p));
    const row=element('p'); family.parents.forEach(p=>row.append(personLink(p))); parents.append(row);
    if (family.parents.length===1) parents.append(element('p','Only this parent is recorded.','muted'));
    const siblings = family.children.filter(p=>p!==id);
    siblings.forEach(p=>knownSiblings.add(p));
    if (siblings.length) {parents.append(element('h4','Siblings in this recorded family')); const s=element('p');siblings.forEach(p=>s.append(personLink(p)));parents.append(s);}
    appendNotes(parents,family.notes);
  }
  // Show other children without guessing whether the unrecorded parent is shared.
  for (const parentId of recordedParents) {
    const parent = index.people.get(parentId);
    const others = [...new Set(parent.families.flatMap(fid=>index.families.get(fid).children))].filter(p=>!knownSiblings.has(p));
    if (others.length) {
      parents.append(element('h4',`Other children of ${parent.name}`));
      const row=element('p');others.forEach(p=>{row.append(personLink(p));knownSiblings.add(p);});parents.append(row);
    }
  }
  content.append(parents);
  const allFamilyIds = [...new Set([...person.families,...person.parentFamilies])];
  if (person.families.length) {
    const block = section('Partners and children');
    for (const fid of person.families) {
      const family = index.families.get(fid), partners = family.parents.filter(p=>p!==id);
      const row=element('h4');
      if (partners.length) {row.append(document.createTextNode('With '));partners.forEach(p=>row.append(personLink(p)));}
      else row.append(document.createTextNode('Children with no other parent recorded'));
      block.append(row);
      if (family.relationship && family.relationship!=='Unknown') block.append(element('p',`Relationship recorded: ${family.relationship}`,'muted'));
      family.events.map(e=>index.events.get(e)).filter(Boolean).forEach(e=>appendEvent(block,e));
      if (family.children.length) {
        const children=element('p');children.append(document.createTextNode('Children: '));
        family.children.forEach(p=>children.append(personLink(p)));block.append(children);
      }
      appendNotes(block,family.notes);
    }
    content.append(block);
  }
  if (person.notes.length || person.tags.length || person.otherNames.length || person.gender!=='U') {
    const block = section('Recorded information');
    if (person.otherNames.length) block.append(element('p',`Other names: ${person.otherNames.join('; ')}`));
    if (person.gender!=='U') block.append(element('p',`Sex recorded: ${{M:'Male',F:'Female'}[person.gender]||person.gender}`));
    if (person.tags.length) block.append(element('p',`Record labels: ${[...new Set(person.tags)].join(', ')}`,'muted'));
    appendNotes(block,person.notes); content.append(block);
  }
  const sourcesBlock = section('Sources');
  const familyRecords = allFamilyIds.map(f=>index.families.get(f));
  const familyEvents = familyRecords.flatMap(f=>f.events.map(e=>index.events.get(e))).filter(Boolean);
  const citationIds = new Set([person,...events,...familyRecords,...familyEvents].flatMap(r=>r.citations));
  const citationGroups = new Map();
  for (const cid of citationIds) {
    const citation = index.citations.get(cid); if (!citation) continue;
    if (!citationGroups.has(citation.source)) citationGroups.set(citation.source,[]);
    citationGroups.get(citation.source).push(citation);
  }
  const details = element('details'); details.append(element('summary',`View ${citationGroups.size} source${citationGroups.size===1?'':'s'} and transcription notes`));
  for (const [sid,citations] of citationGroups) {
    const source=index.sources.get(sid); if (!source) continue;
    const block=element('div',undefined,'citation'); block.append(element('strong',source.title));
    if (source.author) block.append(element('p',source.author));
    if (source.publication) block.append(element('p',source.publication));
    if (source.abbreviation) block.append(element('p',source.abbreviation));
    block.append(element('p',[...new Set(citations.map(c=>c.page).filter(Boolean))].join('; ')));
    const dates=[...new Set(citations.map(c=>formatDate(c.date)).filter(Boolean))];
    if (dates.length) block.append(element('p',`Source dates: ${dates.join('; ')}`));
    const confidence=['Very low','Low','Normal','High','Very high'];
    const levels=[...new Set(citations.map(c=>confidence[Number(c.confidence)]).filter(Boolean))];
    if(levels.length) block.append(element('p',`Recorded source confidence: ${levels.join(', ')}`));
    appendNotes(block,[...source.notes,...citations.flatMap(c=>c.notes)]);
    if (source.hasLocalScan) block.append(element('p','The original scan is kept in the family archive.'));
    details.append(block);
  }
  sourcesBlock.append(details,element('p',`Record ${person.id} · Last published ${formatDate({val:data.updated})}`,'muted'));
  content.append(sourcesBlock);
  ownerEditor?.personControls(content,id);
  const dialog=$('person-dialog');if(!dialog.open) dialog.showModal();
  name.focus({preventScroll:true});dialog.scrollTop=0;
}
function closePerson() {
  $('person-dialog').close();
  $(`person-${selected}`)?.focus({preventScroll:true});
}
function hideResults() {$('search-results').hidden=true;$('search').setAttribute('aria-expanded','false');}
function search() {
  if (!data) return;
  const query=$('search').value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim();
  const list=$('search-results');list.replaceChildren();
  if(!query){hideResults();return;}
  const matches=data.people.filter(p=>p.name.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().includes(query));
  for(const p of matches.slice(0,40)) {
    const b=element('button',p.name);b.append(element('small',lifeYears(p)||'Dates not recorded'));
    b.addEventListener('click',()=>{hideResults();selectPerson(p.id,true);showPerson(p.id);});list.append(b);
  }
  if(!matches.length) list.append(element('p','No matching person. Try part of a name.','search-empty'));
  if(matches.length>40) list.append(element('p','Type more of the name to narrow the results.','search-empty'));
  list.hidden=false;$('search').setAttribute('aria-expanded','true');
}
function lock(focus=true) {
  if(focus && ownerEditor && !ownerEditor.canLock())return;
  ownerEditor?.disconnect();currentEnvelope=null;
  displayedNotes.clear();
  epoch++;data=null;index=null;view=null;bounds=null;selected=null;gesture=null;pointers.clear();
  $('tree').replaceChildren();$('tree').removeAttribute('viewBox');$('person-content').replaceChildren();
  $('person-dialog').close();$('search').value='';$('search-results').replaceChildren();hideResults();
  $('branch').replaceChildren();$('tree-summary').textContent='';$('view-status').textContent='';
  $('viewer').hidden=true;$('locked').hidden=false;$('passphrase').value='';$('passphrase').type='password';
  $('show-passphrase').textContent='Show';$('show-passphrase').setAttribute('aria-label','Show access code');$('show-passphrase').setAttribute('aria-pressed','false');
  $('unlock-message').textContent='';if(focus)$('passphrase').focus();
}
$('unlock-form').addEventListener('submit',async e=>{
  e.preventDefault();if(busy)return;
  if(!window.isSecureContext || !crypto.subtle){$('unlock-message').textContent='Open this page using its secure HTTPS address.';return;}
  const attempt=++epoch;busy=true;$('unlock-button').disabled=true;$('unlock-message').textContent='Opening your family tree…';
  let phrase=$('passphrase').value;$('passphrase').value='';
  try {
    const response=await fetch(new URL('./tree.enc.json',import.meta.url),{cache:'no-store',credentials:'omit'});
    if(!response.ok)throw new Error('download');
    const envelope=await response.json();
    const result=await decrypt(envelope,phrase);phrase='';validate(result);
    if(attempt!==epoch)return;
    currentEnvelope=envelope;
    data=result;index={};for(const name of ['people','families','events','notes','citations','sources'])index[name]=new Map(data[name].map(v=>[v.id,v]));
    index.positions=new Map(data.layout.nodes.map(n=>[n.id,n]));
    renderTree();$('locked').hidden=true;$('viewer').hidden=false;
    $('tree-summary').textContent=`${data.people.length} people · Updated ${formatDate({val:data.updated})}`;
    fitTree();$('search').focus();$('unlock-message').textContent='';
  } catch(error) {
    if(attempt===epoch) {
      lock(false);
      $('unlock-message').textContent=error.message==='download'?'The family records could not be loaded. Please try again.':'The tree could not be opened. Check the access code and try again. If it still fails, contact the person who shared the tree.';
      $('passphrase').focus();
    }
  } finally {phrase='';busy=false;$('unlock-button').disabled=false;}
});
$('show-passphrase').addEventListener('click',()=>{
  const show=$('passphrase').type==='password';$('passphrase').type=show?'text':'password';
  $('show-passphrase').textContent=show?'Hide':'Show';$('show-passphrase').setAttribute('aria-label',show?'Hide access code':'Show access code');$('show-passphrase').setAttribute('aria-pressed',String(show));
});
$('lock').addEventListener('click',()=>lock());$('fit').addEventListener('click',fitTree);
$('owner-edit').addEventListener('click',async()=>{
  if(!data)return;
  try{
    if(!ownerEditor){
      const {createEditor}=await import('./editor.js');
      if(!data)return;
      ownerEditor=createEditor({
        getData:()=>structuredClone(data),getEnvelope:()=>structuredClone(currentEnvelope),
        setEnvelope:value=>{currentEnvelope=structuredClone(value);},closePerson,lock:()=>lock(),
        showData:(value,id)=>{
          validate(value);data=structuredClone(value);index={};
          for(const name of ['people','families','events','notes','citations','sources'])index[name]=new Map(data[name].map(v=>[v.id,v]));
          index.positions=new Map(data.layout.nodes.map(n=>[n.id,n]));
          closePerson();hideResults();renderTree();$('tree-summary').textContent=`${data.people.length} people · Updated ${formatDate({val:data.updated})}`;
          if(id&&index.people.has(id))selectPerson(id,true);else fitTree();
        }
      });
    }
    await ownerEditor.open();
  }catch{ $('view-status').textContent='The editor could not be opened. Reload the page and try again.'; }
});
$('zoom-in').addEventListener('click',()=>zoom(1.35));$('zoom-out').addEventListener('click',()=>zoom(1/1.35));
$('close-person').addEventListener('click',closePerson);
$('person-dialog').addEventListener('cancel',e=>{e.preventDefault();closePerson();});
$('person-dialog').addEventListener('click',e=>{if(e.target===$('person-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closePerson();}});
$('search').addEventListener('input',search);
$('search').addEventListener('keydown',e=>{
  if(e.key==='Escape'){hideResults();return;}
  if(e.key==='ArrowDown'){e.preventDefault();$('search-results').querySelector('button')?.focus();}
  if(e.key==='Enter'){e.preventDefault();$('search-results').querySelector('button')?.click();}
});
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))hideResults();});
$('branch').addEventListener('change',()=>{
  const b=data.layout.branches.find(b=>b.person===$('branch').value);
  if(!b){fitTree();return;}
  const ns=data.layout.nodes.filter(n=>n.branch===b.colour);
  const left=Math.min(...ns.map(n=>n.x)),top=Math.min(...ns.map(n=>n.y))-45;
  fitBounds([left,top,Math.max(...ns.map(n=>n.x+n.w))-left,Math.max(...ns.map(n=>n.y+n.h))-top]);
  $('view-status').textContent=`Branch ${b.number} · ${index.people.get(b.person).name}`;
});
const stage=$('stage');
stage.addEventListener('wheel',e=>{
  if(!view)return;e.preventDefault();const r=stage.getBoundingClientRect();
  const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?r.height:1);
  zoom(Math.exp(-Math.max(-500,Math.min(500,delta))*.0015),(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);
},{passive:false});
function snapshotGesture(){gesture={points:[...pointers.values()].map(p=>({...p})),view:[...view]};}
stage.addEventListener('pointerdown',e=>{
  if(!view||e.button!==0)return;
  if(!pointers.size){moved=false;pressedPerson=e.target.closest('[data-person]')?.dataset.person||null;}
  else moved=true;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});stage.setPointerCapture(e.pointerId);snapshotGesture();stage.classList.add('dragging');
});
stage.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)||!gesture)return;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const pts=[...pointers.values()],g=gesture;
  if(pts.length===1){
    const dx=pts[0].x-g.points[0].x,dy=pts[0].y-g.points[0].y;if(Math.hypot(dx,dy)>5)moved=true;
    view=[g.view[0]-dx*g.view[2]/stage.clientWidth,g.view[1]-dy*g.view[3]/stage.clientHeight,g.view[2],g.view[3]];applyView();
  }else if(pts.length===2&&g.points.length===2){
    moved=true;const distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),r=stage.getBoundingClientRect();
    const oldX=(g.points[0].x+g.points[1].x)/2-r.left,oldY=(g.points[0].y+g.points[1].y)/2-r.top;
    const newX=(pts[0].x+pts[1].x)/2-r.left,newY=(pts[0].y+pts[1].y)/2-r.top;
    view=[...g.view];zoom(distance(pts)/Math.max(1,distance(g.points)),oldX/r.width,oldY/r.height);
    view[0]-=(newX-oldX)*view[2]/r.width;view[1]-=(newY-oldY)*view[3]/r.height;applyView();
  }
});
function endPointer(e,cancelled=false){
  if(!pointers.has(e.pointerId))return;
  const activate=!cancelled&&!moved&&pointers.size===1&&pressedPerson;
  pointers.delete(e.pointerId);
  if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);
  if(pointers.size)snapshotGesture();else{gesture=null;stage.classList.remove('dragging');}
  if(activate)showPerson(activate);
}
stage.addEventListener('pointerup',e=>endPointer(e));stage.addEventListener('pointercancel',e=>endPointer(e,true));
stage.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))endPointer(e,true);});
stage.addEventListener('keydown',e=>{
  if(!view)return;
  if(['+','=','-','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))e.preventDefault();
  if(e.key==='+'||e.key==='=')zoom(1.3);if(e.key==='-')zoom(1/1.3);if(e.key==='Home')fitTree();
  const moves={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,-.15],ArrowDown:[0,.15]};
  if(moves[e.key]){view[0]+=view[2]*moves[e.key][0];view[1]+=view[3]*moves[e.key][1];applyView();}
});
new ResizeObserver(()=>{if(view){const cy=view[1]+view[3]/2;view[3]=view[2]*stage.clientHeight/Math.max(1,stage.clientWidth);view[1]=cy-view[3]/2;applyView();}}).observe(stage);
window.addEventListener('pagehide',()=>lock(false));
window.addEventListener('pageshow',e=>{if(e.persisted)lock();});
