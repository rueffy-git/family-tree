// Family records are the source of truth. Diagram positions are derived from them.
export const collections = ['people','families','events','notes','citations','sources'];
export const clone = value => structuredClone(value);
export const newId = prefix => `${prefix}-${crypto.randomUUID()}`;

export function blankPerson() {
  return {id:newId('P'),name:'',otherNames:[],gender:'U',events:[],families:[],parentFamilies:[],notes:[],citations:[],tags:[]};
}
export function blankFamily() {
  return {id:newId('F'),parents:[],children:[],events:[],notes:[],citations:[],relationship:'Unknown',childRelations:[]};
}
export function rebuildReferences(data) {
  const people = new Map(data.people.map(p=>[p.id,p]));
  for (const person of people.values()) { person.families=[]; person.parentFamilies=[]; }
  for (const family of data.families) {
    for (const id of family.parents) people.get(id)?.families.push(family.id);
    for (const id of family.children) people.get(id)?.parentFamilies.push(family.id);
    family.childRelations=(family.childRelations||[]).filter(r=>family.children.includes(r.id));
  }
  data.counts=Object.fromEntries(collections.map(name=>[name,data[name].length]));
  return data;
}
export function validateRecords(data) {
  if (!data || data.version!==1) throw new Error('This is not a supported family tree.');
  const maps={};
  for (const key of collections) {
    if (!Array.isArray(data[key])) throw new Error(`The ${key} records are missing.`);
    maps[key]=new Map();
    for (const value of data[key]) {
      if (!value || typeof value.id!=='string' || !value.id || maps[key].has(value.id)) throw new Error(`There is a missing or repeated ID in ${key}.`);
      maps[key].set(value.id,value);
    }
  }
  const refs=(record,field,target)=>{
    if (!Array.isArray(record[field]) || new Set(record[field]).size!==record[field].length || record[field].some(id=>!maps[target].has(id)))
      throw new Error(`A ${field} connection is missing or repeated. Please check the record.`);
  };
  const text=(value,label,maximum=100000)=>{if(typeof value!=='string'||value.length>maximum)throw new Error(`Please check ${label}.`);};
  for (const p of data.people) {
    text(p.name,'the name',500);if(!p.name.trim())throw new Error('Every person needs a name.');
    if(!['M','F','U'].includes(p.gender))throw new Error('Please choose a recorded sex or Unknown.');
    for(const field of ['otherNames','tags'])if(!Array.isArray(p[field])||p[field].some(x=>typeof x!=='string'))throw new Error(`Please check ${field}.`);
    refs(p,'events','events');refs(p,'notes','notes');refs(p,'citations','citations');refs(p,'families','families');refs(p,'parentFamilies','families');
  }
  const next=new Map(data.people.map(p=>[p.id,new Set()]));
  const familyKeys=new Set();
  for (const f of data.families) {
    refs(f,'parents','people');refs(f,'children','people');refs(f,'events','events');refs(f,'notes','notes');refs(f,'citations','citations');
    if(f.parents.length<1||f.parents.length>2)throw new Error('Choose one or two recorded parents or partners for each family.');
    if(f.children.some(id=>f.parents.includes(id)))throw new Error('A person cannot be their own parent.');
    const key=[...f.parents].sort().join('|');
    if(familyKeys.has(key))throw new Error('These parents already have a family record. Edit that family to add children.');
    familyKeys.add(key);
    for(const id of f.parents) {
      if(!maps.people.get(id).families.includes(f.id))throw new Error('A parent connection is incomplete.');
      for(const child of f.children)next.get(id).add(child);
    }
    for(const id of f.children)if(!maps.people.get(id).parentFamilies.includes(f.id))throw new Error('A child connection is incomplete.');
  }
  for(const p of data.people){
    if(p.families.some(id=>!maps.families.get(id).parents.includes(p.id))||p.parentFamilies.some(id=>!maps.families.get(id).children.includes(p.id)))throw new Error('A family connection is incomplete.');
  }
  const visiting=new Set(),done=new Set();
  function visit(id){
    if(visiting.has(id))throw new Error('This connection would make someone their own ancestor. Check the parents and children.');
    if(done.has(id))return;
    visiting.add(id);for(const child of next.get(id))visit(child);visiting.delete(id);done.add(id);
  }
  for(const id of next.keys())visit(id);
  for(const e of data.events){text(e.type,'the event type',200);text(e.description,'the event description');refs(e,'notes','notes');refs(e,'citations','citations');}
  for(const n of data.notes)text(n.text,'the note');
  for(const c of data.citations){if(!maps.sources.has(c.source))throw new Error('A source is missing.');refs(c,'notes','notes');refs(c,'citations','citations');}
  for(const s of data.sources){text(s.title,'the source title');refs(s,'notes','notes');refs(s,'citations','citations');}
  return data;
}

export function dateText(date) {
  if(!date)return '';
  if(date.kind==='daterange'||date.kind==='datespan')return `${date.start||''} to ${date.stop||''}`;
  return date.val||'';
}
export function parseDate(value,qualifier='') {
  value=value.trim();if(!value)return null;
  if(/^\d{4}(-\d{2}){0,2}$/.test(value)){
    const [y,m,d]=value.split('-').map(Number);
    if(y<1||m===0||m>12||d===0||d>new Date(Date.UTC(y,m,0)).getUTCDate())throw new Error('Use a valid date, such as 2025-03-30, a year, or a written description.');
    return {kind:'dateval',val:value,...(qualifier?{type:qualifier}:{})};
  }
  return {kind:'datestr',val:value};
}

// A shared transcription note/event must not change on another person's record.
function saveNotes(data,rows,oldIds) {
  const known=new Map(data.notes.map(n=>[n.id,n]));
  return rows.filter(row=>row.text.trim()).map(row=>{
    const old=oldIds.includes(row.id)?known.get(row.id):null;
    if(old&&old.text===row.text)return old.id;
    const note={...(old||{type:'Person Note'}),id:newId('N'),text:row.text};data.notes.push(note);return note.id;
  });
}
export function savePerson(data,id,fields) {
  let person=data.people.find(p=>p.id===id);
  if(!person){person=blankPerson();person.id=id;data.people.push(person);}
  Object.assign(person,{name:fields.name.trim(),gender:fields.gender,otherNames:fields.otherNames,tags:fields.tags});
  person.notes=saveNotes(data,fields.notes,person.notes);
  const oldEvents=new Map(data.events.map(e=>[e.id,e]));
  person.events=fields.events.filter(row=>row.type.trim()).map(row=>{
    const old=person.events.includes(row.id)?oldEvents.get(row.id):null;
    const date=old&&dateText(old.date)===row.date&&((old.date?.type)||'')===row.qualifier?clone(old.date):parseDate(row.date,row.qualifier);
    if(old&&old.type===row.type.trim()&&old.description===row.description&&JSON.stringify(old.date)===JSON.stringify(date))return old.id;
    const event={...(old||{notes:[],citations:[]}),id:newId('E'),type:row.type.trim(),date,description:row.description};
    data.events.push(event);return event.id;
  });
  return rebuildReferences(data);
}
export function saveFamily(data,family) {
  const index=data.families.findIndex(f=>f.id===family.id);
  if(index<0)data.families.push(clone(family));else data.families[index]=clone(family);
  return rebuildReferences(data);
}
export function removePerson(data,id) {
  data.people=data.people.filter(p=>p.id!==id);
  for(const family of data.families){family.parents=family.parents.filter(p=>p!==id);family.children=family.children.filter(p=>p!==id);}
  data.families=data.families.filter(f=>f.parents.length);
  return rebuildReferences(data);
}
export function focusFamily(data) {
  if(data.families.some(f=>f.id===data.focusFamily))return data.focusFamily;
  const branchIds=data.layout?.branches?.map(b=>b.person)||[];
  return data.families.find(f=>branchIds.length&&JSON.stringify(f.children)===JSON.stringify(branchIds))?.id ||
    [...data.families].sort((a,b)=>b.children.length-a.children.length)[0]?.id;
}

export class Draft {
  constructor(data,arrange){this.data=clone(data);this.arrange=arrange;this.undoStack=[];this.redoStack=[];this.base=JSON.stringify(data);}
  get dirty(){return JSON.stringify(this.data)!==this.base;}
  async change(edit,relayout=false){
    const next=clone(this.data);next.focusFamily=focusFamily(next);edit(next);rebuildReferences(next);validateRecords(next);
    if(relayout)next.layout=await this.arrange(next,focusFamily(next));
    this.undoStack.push(this.data);if(this.undoStack.length>50)this.undoStack.shift();this.data=next;this.redoStack=[];
  }
  undo(){if(this.undoStack.length){this.redoStack.push(this.data);this.data=this.undoStack.pop();}}
  redo(){if(this.redoStack.length){this.undoStack.push(this.data);this.data=this.redoStack.pop();}}
  saved(data){this.data=clone(data);this.base=JSON.stringify(data);this.undoStack=[];this.redoStack=[];}
}
