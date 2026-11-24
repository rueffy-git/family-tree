import {OwnerConnection,repository} from './github.js';
import {decrypt,encrypt} from './crypto.js';
import {Draft,blankPerson,blankFamily,savePerson,saveFamily,removePerson,clone,dateText,validateRecords,rebuildReferences,focusFamily} from './records.js';
import {arrange,checkGeometry} from './layout.js';

const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const button=(text,action,cls='')=>{const node=el('button',text,cls);node.type='button';node.addEventListener('click',action);return node;};
function field(label,value='',kind='input'){
  const wrap=el('label',undefined,'edit-field');wrap.append(el('span',label));const input=el(kind);input.value=value;wrap.append(input);return {wrap,input};
}
function selectField(label,options,value){
  const f=field(label,'','select');for(const[v,t]of options){const o=el('option',t);o.value=v;f.input.append(o);}f.input.value=value;return f;
}
const lines=value=>value.split('\n').map(s=>s.trim()).filter(Boolean);
const shortDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Adelaide',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

export function createEditor(bridge,{connection=new OwnerConnection()}={}){
  let draft=null,file=null,baseline=null,working=false,generation=0,activeDialog=null,publicationTimer=null;
  const toolbar=el('section',undefined,'owner-toolbar');toolbar.setAttribute('aria-label','Owner editing controls');toolbar.hidden=true;
  const status=el('p','Owner editor','owner-status');status.setAttribute('role','status');
  const actions=el('div',undefined,'owner-actions');
  const add=button('Add person',()=>editPerson());
  const families=button('Family connections',()=>familyList());
  const undo=button('Undo',()=>{draft.undo();refresh();});
  const redo=button('Redo',()=>{draft.redo();refresh();});
  const backup=button('Private backup',()=>prepareSave('backup'));
  const restore=button('Open backup',()=>openBackup());
  const publish=button('Review and publish',()=>prepareSave('publish'),'primary');
  const done=button('Finish editing',()=>finish());
  actions.append(add,families,undo,redo,backup,restore,publish,done);toolbar.append(status,actions);
  document.getElementById('stage').before(toolbar);

  function dialog(title){
    activeDialog?.close();const box=el('dialog',undefined,'editor-dialog'),top=el('div',undefined,'editor-heading');
    const heading=el('h2',title);heading.id=`heading-${crypto.randomUUID()}`;box.setAttribute('aria-labelledby',heading.id);
    top.append(heading,button('Close',()=>{if(!working)box.close();},'quiet'));box.append(top);document.body.append(box);activeDialog=box;
    box.addEventListener('close',()=>{box.querySelectorAll('input,textarea').forEach(n=>n.value='');box.remove();if(activeDialog===box)activeDialog=null;});
    box.addEventListener('cancel',event=>{if(working)event.preventDefault();});return box;
  }
  function message(box){const node=el('p','','edit-message');node.setAttribute('role','status');box.append(node);return node;}
  function setBusy(value){working=value;toolbar.querySelectorAll('button').forEach(b=>b.disabled=value);document.getElementById('lock').disabled=value;document.getElementById('owner-edit').disabled=value;}
  function refresh(id){
    if(!draft)return;bridge.showData(draft.data,id);undo.disabled=!draft.undoStack.length;redo.disabled=!draft.redoStack.length;publish.disabled=!draft.dirty;
    status.textContent=draft.dirty?'Private draft — changes are not yet visible to your family.':'Owner editor — select a person to edit their details.';
  }
  async function apply(change,relayout,box,msg,id){
    if(working||!connection.connected)return;setBusy(true);msg.textContent='Updating your draft…';const turn=generation;
    box.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await draft.change(change,relayout);if(turn!==generation)return;box.close();refresh(id);}
    catch(error){msg.textContent=error.message;}
    finally{if(turn===generation){setBusy(false);box.querySelectorAll('button').forEach(b=>b.disabled=false);undo.disabled=!draft.undoStack.length;redo.disabled=!draft.redoStack.length;publish.disabled=!draft.dirty;}}
  }
  function confirmAction(title,text,action){
    const box=dialog(title);box.append(el('p',text));const row=el('div',undefined,'edit-actions');row.append(button('Cancel',()=>box.close()),button('Confirm',()=>{box.close();action();},'danger'));box.append(row);box.showModal();
  }
  function finish(){
    if(working)return;
    const end=()=>{if(baseline)bridge.showData(baseline);disconnect();};
    if(draft?.dirty)confirmAction('Discard this draft?','Your unpublished changes will be removed. The online tree will stay as it is. Download a private backup first if you want to keep the draft.',end);else end();
  }
  function disconnect(){
    generation++;clearTimeout(publicationTimer);connection.disconnect();activeDialog?.close();draft=null;file=null;baseline=null;toolbar.hidden=true;setBusy(false);
    document.getElementById('owner-edit').textContent='Owner editing';
  }
  async function open(){
    if(working)return;
    if(connection.connected){toolbar.hidden=false;return;}
    const box=dialog('Owner editing');
    box.append(el('p','Only the rueffy-git GitHub account can publish changes. The family viewing code does not allow editing.'));
    const help=el('details'),summary=el('summary','Set up my private editing key');help.append(summary);
    const setup=el('ol');
    const first=el('li','Open GitHub and sign in to your account. '),link=el('a','Create a private editing key');
    link.href='https://github.com/settings/personal-access-tokens/new?name=Family%20tree%20editor&description=Publish%20encrypted%20family%20tree%20records&target_name=rueffy-git&expires_in=90&contents=write';link.target='_blank';link.rel='noopener noreferrer';first.append(link);
    setup.append(first,el('li','Under Repository access, choose Only select repositories and select family-tree.'),el('li','Check Contents is set to Read and write. Leave other permissions unchanged.'),el('li','Create the key, keep it in your password manager, and paste it below. Do not share it with family members.'));
    help.append(setup,el('p','GitHub calls this a fine-grained personal access token. It is used only for this editing session. You will need it again after closing or reloading the page.'));box.append(help);
    const form=el('form'),key=field('Private GitHub editing key');key.input.type='password';key.input.autocomplete='off';key.input.spellcheck=false;key.input.required=true;key.input.placeholder='github_pat_…';
    const submit=el('button','Connect my account','primary');submit.type='submit';form.append(key.wrap,submit);const msg=message(form);box.append(form);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(working)return;setBusy(true);submit.disabled=true;msg.textContent='Checking your GitHub account…';let token=key.input.value;key.input.value='';const turn=generation;
      try{
        await connection.connect(token);token='';const current=await connection.read();
        if(turn!==generation){connection.disconnect();return;}
        if(JSON.stringify(current.envelope)!==JSON.stringify(bridge.getEnvelope()))throw new Error('A newer tree is online. Reload the page and open it before starting to edit.');
        const data=bridge.getData();validateRecords(data);baseline=clone(data);file=current;draft=new Draft(data,arrange);toolbar.hidden=false;
        document.getElementById('owner-edit').textContent='Owner connected';box.close();refresh();
      }catch(error){connection.disconnect();msg.textContent=error.message;}
      finally{token='';if(turn===generation){setBusy(false);submit.disabled=false;}}
    });box.showModal();key.input.focus();
  }

  function editPerson(id){
    if(!connection.connected||working)return;bridge.closePerson();
    const isNew=!id,person=id?draft.data.people.find(p=>p.id===id):blankPerson();id=person.id;
    const box=dialog(isNew?'Add a person':`Edit ${person.name}`),form=el('form');
    const name=field('Full name',person.name);name.input.required=true;name.input.maxLength=500;
    const sex=selectField('Sex recorded',[['U','Unknown / not recorded'],['F','Female'],['M','Male']],person.gender);
    const aliases=field('Other names — one per line',person.otherNames.join('\n'),'textarea');
    const tags=field('Record labels — one per line',person.tags.join('\n'),'textarea');
    const grid=el('div',undefined,'edit-grid');grid.append(name.wrap,sex.wrap,aliases.wrap,tags.wrap);form.append(grid);
    form.append(el('h3','Dates and events'),el('p','Use YYYY-MM-DD for a full date, a year on its own, or a written description.','edit-help'));
    const events=el('div'),eventRows=[];
    function addEvent(event={type:'Birth',date:null,description:''}){
      const row=el('fieldset',undefined,'edit-event');row.append(el('legend',event.id?'Recorded event':'New event'));
      const type=field('Event type',event.type),date=field('Date',dateText(event.date)),qualifier=selectField('Date certainty',[['','As recorded'],['about','About'],['before','Before'],['after','After'],['estimated','Estimated'],['calculated','Calculated']],event.date?.type||'');
      if(event.date?.type&&!qualifier.input.value){const option=el('option',event.date.type);option.value=event.date.type;qualifier.input.append(option);qualifier.input.value=event.date.type;}
      type.input.required=true;
      const description=field('Event details',event.description,'textarea');const rowGrid=el('div',undefined,'edit-grid');rowGrid.append(type.wrap,date.wrap,qualifier.wrap,description.wrap);
      const item={row,id:event.id,type,date,qualifier,description};eventRows.push(item);row.append(rowGrid,button('Remove event',()=>{row.remove();eventRows.splice(eventRows.indexOf(item),1);},'quiet danger'));events.append(row);
    }
    person.events.forEach(id=>addEvent(draft.data.events.find(e=>e.id===id)));form.append(events,button('Add event',()=>addEvent()));
    form.append(el('h3','Notes'));const notes=el('div'),noteRows=[];
    function addNote(note={text:''}){
      const row=el('div',undefined,'edit-note'),text=field('Note',note.text,'textarea');text.input.rows=5;const item={row,id:note.id,text};noteRows.push(item);
      row.append(text.wrap,button('Remove note',()=>{row.remove();noteRows.splice(noteRows.indexOf(item),1);},'quiet danger'));notes.append(row);
    }
    person.notes.forEach(id=>addNote(draft.data.notes.find(n=>n.id===id)));form.append(notes,button('Add note',()=>addNote()));
    if(!isNew){form.append(el('h3','Connections'));const row=el('div',undefined,'edit-actions');row.append(button('Edit parents and siblings',()=>familyList(id,'parents')),button('Edit partners and children',()=>familyList(id,'children')));form.append(row,el('p','Apply any details above before opening the connection editor.','edit-help'));}
    const msg=message(form),footer=el('div',undefined,'edit-actions');const submit=el('button','Apply to draft','primary');submit.type='submit';footer.append(button('Cancel',()=>box.close()),submit);
    if(!isNew)footer.prepend(button('Remove person',()=>confirmAction('Remove this person?',`Remove ${person.name} and their connections from this draft? Other people will be kept. You can undo this before publishing.`,()=>{
      const progress=dialog('Removing person'),m=message(progress);progress.showModal();apply(data=>removePerson(data,id),true,progress,m);
    }),'danger'));
    form.append(footer);box.append(form);
    form.addEventListener('submit',event=>{event.preventDefault();const fields={name:name.input.value,gender:sex.input.value,otherNames:lines(aliases.input.value),tags:lines(tags.input.value),notes:noteRows.map(n=>({id:n.id,text:n.text.input.value})),events:eventRows.map(e=>({id:e.id,type:e.type.input.value,date:e.date.input.value,qualifier:e.qualifier.input.value,description:e.description.input.value}))};apply(data=>savePerson(data,id,fields),isNew,box,msg,id);});
    box.showModal();name.input.focus();
  }
  function personName(id){return draft.data.people.find(p=>p.id===id)?.name||'Unknown person';}
  function familyName(f){return f.parents.map(personName).join(' + ')||'New family';}
  function familyList(personId,kind){
    if(!connection.connected||working)return;bridge.closePerson();const box=dialog('Family connections');
    box.append(el('p','A family record joins one or two parents or partners with their children. It does not assume a marriage.'));
    const search=field('Find a family');search.input.type='search';box.append(search.wrap);const list=el('div',undefined,'family-list');box.append(list);
    const render=()=>{
      list.replaceChildren();const q=search.input.value.toLocaleLowerCase();
      const relevant=draft.data.families.filter(f=>(!personId||(kind==='parents'?f.children.includes(personId):kind==='children'?f.parents.includes(personId):f.parents.includes(personId)||f.children.includes(personId)))&&`${familyName(f)} ${f.children.map(personName).join(' ')}`.toLocaleLowerCase().includes(q));
      for(const f of relevant){const b=button(familyName(f),()=>editFamily(f.id));b.append(el('small',`${f.children.length} ${f.children.length===1?'child':'children'}${f.relationship&&f.relationship!=='Unknown'?' · '+f.relationship:''}`));list.append(b);}
      if(!relevant.length)list.append(el('p','No matching family records.'));
    };search.input.addEventListener('input',render);render();
    box.append(button('Add family connection',()=>editFamily(null,personId,kind),'primary'));box.showModal();
  }
  function editFamily(id,personId,kind){
    const family=id?clone(draft.data.families.find(f=>f.id===id)):blankFamily();
    if(!id&&personId){if(kind==='parents')family.children=[personId];else family.parents=[personId];}
    const box=dialog(id?'Edit family connections':'Add family connections'),form=el('form');
    const choices=[['','Not recorded'],...draft.data.people.map(p=>[p.id,p.name]).sort((a,b)=>a[1].localeCompare(b[1]))];
    const a=selectField('First parent or partner',choices,family.parents[0]||''),b=selectField('Second parent or partner',choices,family.parents[1]||'');
    const rel=field('Relationship recorded',family.relationship||'Unknown');const grid=el('div',undefined,'edit-grid');grid.append(a.wrap,b.wrap,rel.wrap);form.append(grid);
    form.append(el('p','Use one parent if the other is unknown. Choose a person already in the tree; use Add person first for someone new.','edit-help'),el('h3','Children'));
    const children=[...family.children],childList=el('div',undefined,'child-list'),picker=selectField('Choose a child to add',choices,'');
    function renderChildren(){
      childList.replaceChildren();children.forEach((id,index)=>{
        const row=el('div',undefined,'child-row');row.append(el('span',personName(id)));
        const up=button('Move up',()=>{[children[index-1],children[index]]=[children[index],children[index-1]];renderChildren();},'quiet');up.disabled=index===0;
        const down=button('Move down',()=>{[children[index+1],children[index]]=[children[index],children[index+1]];renderChildren();},'quiet');down.disabled=index===children.length-1;
        row.append(up,down,button('Remove',()=>{children.splice(index,1);renderChildren();},'quiet danger'));childList.append(row);
      });if(!children.length)childList.append(el('p','No children are linked to this family.','edit-help'));
    }
    renderChildren();form.append(childList,picker.wrap,button('Add selected child',()=>{if(picker.input.value&&!children.includes(picker.input.value)){children.push(picker.input.value);picker.input.value='';renderChildren();}}));
    form.append(el('p','Removing a connection keeps the person in the tree. Child order controls branch order where possible.','edit-help'));
    const msg=message(form),footer=el('div',undefined,'edit-actions'),submit=el('button','Apply connections','primary');submit.type='submit';footer.append(button('Cancel',()=>box.close()),submit);
    if(id)footer.prepend(button('Remove this family connection',()=>confirmAction('Remove this connection?','The parents, partners and children will all be kept. Only this family connection will be removed from the draft.',()=>{
      const progress=dialog('Removing connection'),m=message(progress);progress.showModal();apply(data=>{data.families=data.families.filter(f=>f.id!==id);},true,progress,m);
    }),'danger'));
    form.append(footer);box.append(form);form.addEventListener('submit',event=>{
      event.preventDefault();family.parents=[a.input.value,b.input.value].filter(Boolean);family.children=children;family.relationship=rel.input.value.trim()||'Unknown';
      apply(data=>saveFamily(data,family),true,box,msg,personId||family.parents[0]);
    });box.showModal();
  }
  function changesSummary(){
    const result=[];for(const[key,label]of [['people','people'],['families','family connections']]){
      const old=new Map(baseline[key].map(v=>[v.id,v])),now=new Map(draft.data[key].map(v=>[v.id,v]));
      const added=[...now.keys()].filter(id=>!old.has(id)).length,removed=[...old.keys()].filter(id=>!now.has(id)).length;
      const changed=[...now].filter(([id,v])=>old.has(id)&&JSON.stringify(old.get(id))!==JSON.stringify(v)).length;
      if(added||changed||removed)result.push(`${label}: ${added} added, ${changed} changed, ${removed} removed`);
    }return result.length?result:['The draft contains updated records.'];
  }
  function download(envelope){
    const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)+'\n'],{type:'application/json'}));const a=el('a');a.href=url;a.download=`family-tree-backup-${shortDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function prepareSave(mode){
    if(!connection.connected||working)return;const box=dialog(mode==='publish'?'Review and publish':'Save a private backup'),form=el('form');
    const list=el('ul');changesSummary().forEach(text=>list.append(el('li',text)));form.append(list);
    form.append(el('p',mode==='publish'?'Publishing will replace the online tree with this draft. Family members will see the changes after the website updates.':'This downloads an encrypted copy of the current draft. The family code will be needed to open it.'));
    const code=field('Family access code');code.input.type='password';code.input.required=true;code.input.autocomplete='off';code.input.spellcheck=false;
    form.append(code.wrap,el('p','Use the existing family code. This keeps the printed access cards working.','edit-help'));
    const msg=message(form),footer=el('div',undefined,'edit-actions'),submit=el('button',mode==='publish'?'Publish changes':'Download encrypted backup','primary');submit.type='submit';footer.append(button('Cancel',()=>box.close()),submit);form.append(footer);box.append(form);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(working)return;setBusy(true);box.querySelectorAll('button').forEach(b=>b.disabled=true);const turn=generation;let secret=code.input.value;code.input.value='';
      try{
        msg.textContent='Checking the family code…';try{await decrypt(file.envelope,secret);}catch{throw new Error('The family code did not match. Please check it and try again.');}
        const next=clone(draft.data);validateRecords(next);checkGeometry(next.layout);
        next.updated=shortDate();next.editorRevision=(next.editorRevision||0)+1;next.focusFamily=focusFamily(next);
        msg.textContent='Protecting the updated records…';const envelope=await encrypt(next,secret,{format:file.envelope.version===2?'code':'passphrase'});secret='';
        if(turn!==generation)return;
        if(mode==='backup'){download(envelope);box.close();status.textContent='Private backup downloaded. Your draft is still open.';}
        else{
          msg.textContent='Saving to your GitHub repository…';const result=await connection.publish(envelope,file.sha);if(turn!==generation)return;
          file={sha:result.sha,envelope};baseline=clone(next);draft.saved(next);bridge.setEnvelope(envelope);box.close();refresh();
          status.textContent='Saved to GitHub. Waiting for the family website to update…';watchPublication(envelope,turn,0);
        }
      }catch(error){if(turn===generation)msg.textContent=error.message;}
      finally{secret='';if(turn===generation){setBusy(false);box.querySelectorAll('button').forEach(b=>b.disabled=false);undo.disabled=!draft.undoStack.length;redo.disabled=!draft.redoStack.length;publish.disabled=!draft.dirty;}}
    });box.showModal();code.input.focus();
  }
  async function watchPublication(envelope,turn,attempt){
    if(turn!==generation||!connection.connected)return;
    try{const response=await fetch(new URL(`./tree.enc.json?revision=${encodeURIComponent(file.sha)}`,import.meta.url),{cache:'no-store',credentials:'omit'});if(response.ok&&JSON.stringify(await response.json())===JSON.stringify(envelope)){if(!draft.dirty)status.textContent='Published. Your family can now see the updated tree.';return;}}catch{/* The saved draft remains available. */}
    if(attempt>=24){if(!draft.dirty)status.textContent='Saved to GitHub. The website is taking longer to update. You can safely finish editing.';return;}
    publicationTimer=setTimeout(()=>watchPublication(envelope,turn,attempt+1),5000);
  }
  function openBackup(){
    if(!connection.connected||working)return;const box=dialog('Open a private backup'),form=el('form');form.append(el('p','This will replace the current draft. Nothing changes online until you publish.'));
    const upload=field('Encrypted backup file');upload.input.type='file';upload.input.accept='.json,application/json';upload.input.required=true;
    const code=field('Code used for this backup');code.input.type='password';code.input.required=true;code.input.autocomplete='off';form.append(upload.wrap,code.wrap);const msg=message(form),submit=el('button','Open as draft','primary');submit.type='submit';form.append(submit);box.append(form);
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(working)return;const chosen=upload.input.files[0];if(!chosen||chosen.size>10000000){msg.textContent='Choose an encrypted family backup smaller than 10 MB.';return;}
      setBusy(true);submit.disabled=true;let secret=code.input.value;code.input.value='';const turn=generation;
      try{
        const restored=await decrypt(JSON.parse(await chosen.text()),secret);secret='';rebuildReferences(restored);validateRecords(restored);restored.layout=await arrange(restored,focusFamily(restored));
        if(turn!==generation)return;await draft.change(data=>{for(const key of Object.keys(data))delete data[key];Object.assign(data,restored);});box.close();refresh();
      }catch(error){msg.textContent=`The backup could not be opened. Check the file and its code. ${error.message||''}`;}
      finally{secret='';if(turn===generation){setBusy(false);submit.disabled=false;}}
    });box.showModal();
  }
  window.addEventListener('beforeunload',e=>{if(draft?.dirty||working){e.preventDefault();e.returnValue='';}});
  return {
    open,disconnect,
    get connected(){return connection.connected;},
    get dirty(){return !!draft?.dirty;},
    canLock(){if(working)return false;if(draft?.dirty){confirmAction('Discard this draft?','Locking removes unpublished changes. The online tree will stay unchanged.',()=>{disconnect();bridge.lock();});return false;}return true;},
    personControls(content,id){if(!connection.connected)return;const row=el('div',undefined,'person-edit-actions');row.append(button('Edit this person',()=>editPerson(id),'primary'),button('Edit connections',()=>familyList(id)));content.prepend(row);}
  };
}
