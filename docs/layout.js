const W=210,H=100,GAP=44,BRANCH=64,ROW=260;
const sum=values=>values.reduce((a,b)=>a+b,0);
const minimum=values=>Math.min(...values),maximum=values=>Math.max(...values);
const getList=(map,key)=>{if(!map.has(key))map.set(key,[]);return map.get(key);};

// Keep the original scan's arrangement for ordinary additions and corrections.
export function originalLayout(data,focusId){
  const people=new Map(data.people.map(p=>[p.id,p])),families=new Map(data.families.map(f=>[f.id,f]));
  const focus=families.get(focusId);if(!focus)throw new Error('No central family.');
  const uf=new Map(data.people.map(p=>[p.id,p.id])),neighbours=new Map(data.people.map(p=>[p.id,new Set()]));
  const root=p=>{while(uf.get(p)!==p)p=uf.get(p);return p;};
  for(const f of families.values())if(f.parents.length===2){const[a,b]=f.parents;uf.set(root(b),root(a));neighbours.get(a).add(b);neighbours.get(b).add(a);}
  const groups=new Map();for(const p of people.keys())getList(groups,root(p)).push(p);
  for(const[g,members]of groups)if(members.length>1){
    const ends=members.filter(p=>neighbours.get(p).size===1).sort();
    if(ends.length!==2||members.some(p=>neighbours.get(p).size>2))throw new Error('Complex partnership.');
    const ordered=[ends[0]];while(ordered.length<members.length)ordered.push([...neighbours.get(ordered.at(-1))].find(p=>!ordered.includes(p)));groups.set(g,ordered);
  }
  const outgoing=new Map(),incoming=new Map();for(const g of groups.keys()){outgoing.set(g,[]);incoming.set(g,[]);}
  for(const f of families.values()){outgoing.get(root(f.parents[0])).push(f);for(const c of f.children)incoming.get(root(c)).push(f);}
  const offset=(g,f)=>sum(f.parents.map(p=>(groups.get(g).indexOf(p)-(groups.get(g).length-1)/2)*(W+GAP)))/f.parents.length;
  for(const g of groups.keys())outgoing.get(g).sort((a,b)=>offset(g,a)-offset(g,b));
  const widths=new Map(),visiting=new Set();
  function measure(g){
    if(visiting.has(g))throw new Error('Shared family group.');if(widths.has(g))return widths.get(g);visiting.add(g);
    const spans=[];for(const f of outgoing.get(g))if(f.children.length){
      const gs=f.children.map(root);if(new Set(gs).size!==gs.length)throw new Error('Related partners.');
      spans.push(sum(gs.map(measure))+BRANCH*(gs.length-1));
    }
    const width=Math.max(groups.get(g).length*(W+GAP)-GAP,sum(spans)+BRANCH*Math.max(0,spans.length-1));
    widths.set(g,width);visiting.delete(g);return width;
  }
  const mainGroup=root(focus.parents[0]),mainWidth=measure(mainGroup),nodes=new Map(),placed=new Set(),paths=[],labels=[],branches=[],levels=new Map();
  function placeGroup(g,cx,y,colour=-1){
    if(placed.has(g))throw new Error('Shared branch.');placed.add(g);
    groups.get(g).forEach((p,i)=>nodes.set(p,{id:p,x:cx+(i-(groups.get(g).length-1)/2)*(W+GAP)-W/2,y,w:W,h:H,branch:colour}));
  }
  function placeTree(g,cx,y,colour=-1){
    placeGroup(g,cx,y,colour);const fs=outgoing.get(g).filter(f=>f.children.length);
    const spans=fs.map(f=>sum(f.children.map(c=>measure(root(c))))+BRANCH*(f.children.length-1));
    let left=cx-(sum(spans)+BRANCH*Math.max(0,spans.length-1))/2;
    fs.forEach((f,i)=>{
      levels.set(f.id,y+ROW-64);let at=left;
      f.children.forEach((p,index)=>{const child=root(p),width=measure(child),nextColour=f.id===focusId?index:colour;
        placeTree(child,at+width/2,y+ROW,nextColour);
        if(f.id===focusId)branches.push({person:p,number:index+1,x:at,y:y+ROW-36,width,colour:nextColour});at+=width+BRANCH;
      });left+=spans[i]+BRANCH;
    });
  }
  placeTree(mainGroup,mainWidth/2,ROW*2+64);
  const ancestorsSeen=new Set();
  function placeAncestors(person,side){
    const child=nodes.get(person);
    for(const fid of people.get(person).parentFamilies){
      const f=families.get(fid),g=root(f.parents[0]);if(ancestorsSeen.has(g))continue;
      if(placed.has(g))throw new Error('Shared ancestor.');ancestorsSeen.add(g);
      const siblings=f.children.map(root).filter(c=>c!==root(person));
      if(siblings.some(s=>outgoing.get(s).some(f=>f.children.length)))throw new Error('Extended ancestor branch.');
      const row=[...nodes.values()].filter(n=>n.y===child.y);
      let cursor=side<0?minimum(row.map(n=>n.x))-BRANCH:maximum(row.map(n=>n.x+W))+BRANCH;
      for(const s of (side<0?[...siblings].reverse():siblings)){const width=groups.get(s).length*(W+GAP)-GAP;placeGroup(s,cursor+side*width/2,child.y);cursor+=side*(width+BRANCH);}
      const targets=f.children.map(c=>nodes.get(c).x+W/2);placeGroup(g,(minimum(targets)+maximum(targets))/2,child.y-ROW);levels.set(fid,child.y-64);
      groups.get(g).forEach((p,i)=>placeAncestors(p,groups.get(g).length===1?side:(i===0?-1:1)));
    }
  }
  focus.parents.forEach((p,i)=>placeAncestors(p,i===0?-1:1));
  const bottom=maximum([...nodes.values()].map(n=>n.y+H)),remaining=[...groups.keys()].filter(g=>!placed.has(g)&&!incoming.get(g).length&&outgoing.get(g).length);
  if(remaining.length){
    const y=bottom+230,total=sum(remaining.map(measure))+180*(remaining.length-1);let at=mainWidth/2-total/2;
    labels.push({x:at,y:y-50,title:'Connections to the main tree are not confirmed',text:'These family groups have no recorded connection to the main family.'});
    for(const g of remaining){placeTree(g,at+widths.get(g)/2,y);at+=widths.get(g)+180;}
  }
  const isolated=[...groups.keys()].filter(g=>!placed.has(g));
  if(isolated.length){
    if(isolated.some(g=>outgoing.get(g).length||incoming.get(g).length))throw new Error('Unplaced connected records.');
    const y=maximum([...nodes.values()].map(n=>n.y+H))+190,total=sum(isolated.map(g=>groups.get(g).length*(W+GAP)))-GAP;let at=mainWidth/2-total/2;
    labels.push({x:at,y:y-50,title:'People without a recorded family connection',text:'No confirmed family connection is recorded for these people.'});
    for(const g of isolated){const width=groups.get(g).length*(W+GAP)-GAP;placeGroup(g,at+width/2,y);at+=width+GAP;}
  }
  for(const f of families.values()){
    const ps=f.parents.map(p=>nodes.get(p));let anchor;
    if(ps.length===2){
      const[a,b]=ps.sort((a,b)=>a.x-b.x);if(Math.abs(b.x-a.x-(W+GAP))>.01||a.y!==b.y)throw new Error('Non-adjacent partners.');
      anchor=[(a.x+W+b.x)/2,a.y+H/2];paths.push({family:f.id,kind:'partner',points:[[a.x+W,anchor[1]],[b.x,anchor[1]]]});
    }else anchor=[ps[0].x+W/2,ps[0].y+H];
    if(f.children.length){const bus=levels.get(f.id),xs=f.children.map(c=>nodes.get(c).x+W/2);
      paths.push({family:f.id,kind:'parent',points:[anchor,[anchor[0],bus]]},{family:f.id,kind:'children',points:[[minimum([...xs,anchor[0]]),bus],[maximum([...xs,anchor[0]]),bus]]});
      f.children.forEach((c,i)=>paths.push({family:f.id,kind:'child',child:c,points:[[xs[i],bus],[xs[i],nodes.get(c).y]]}));
      if(ps.length===1)labels.push({x:anchor[0]+9,y:anchor[1]+31,text:'Only this parent is recorded',small:true});
    }
  }
  const ns=[...nodes.values()],left=minimum(ns.map(n=>n.x))-90,top=minimum(ns.map(n=>n.y))-60;
  return {nodes:ns,paths,labels,branches,bounds:[left,top,maximum(ns.map(n=>n.x+W))+90-left,maximum(ns.map(n=>n.y+H))+90-top],cardWidth:W,cardHeight:H};
}

export function checkGeometry(layout,{crossings=false}={}){
  const ns=layout.nodes,segments=[];
  for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){const a=ns[i],b=ns[j];if(Math.max(a.x,b.x)<Math.min(a.x+a.w,b.x+b.w)-.01&&Math.max(a.y,b.y)<Math.min(a.y+a.h,b.y+b.h)-.01)throw new Error('The diagram has overlapping people.');}
  for(const edge of layout.paths)for(let i=1;i<edge.points.length;i++){
    const a=edge.points[i-1],b=edge.points[i],x1=Math.min(a[0],b[0]),x2=Math.max(a[0],b[0]),y1=Math.min(a[1],b[1]),y2=Math.max(a[1],b[1]);
    if(![x1,x2,y1,y2].every(Number.isFinite))throw new Error('The diagram has an incomplete connection.');
    if(x1===x2&&y1===y2)continue;
    for(const n of ns){if(x1===x2&&n.x+.01<x1&&x1<n.x+n.w-.01&&Math.max(y1,n.y)<Math.min(y2,n.y+n.h)-.01)throw new Error('A connection passes through a person.');if(y1===y2&&n.y+.01<y1&&y1<n.y+n.h-.01&&Math.max(x1,n.x)<Math.min(x2,n.x+n.w)-.01)throw new Error('A connection passes through a person.');}
    segments.push({x1,x2,y1,y2,f:edge.family});
  }
  if(crossings)for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const a=segments[i],b=segments[j];if(a.f===b.f)continue;const av=a.x1===a.x2,bv=b.x1===b.x2;
    if(av!==bv){const[v,h]=av?[a,b]:[b,a];if(h.x1-.01<=v.x1&&v.x1<=h.x2+.01&&v.y1-.01<=h.y1&&h.y1<=v.y2+.01)throw new Error('Connections cross.');}
    else if(av&&a.x1===b.x1&&Math.max(a.y1,b.y1)<Math.min(a.y2,b.y2)-.01)throw new Error('Connections overlap.');
    else if(!av&&a.y1===b.y1&&Math.max(a.x1,b.x1)<Math.min(a.x2,b.x2)-.01)throw new Error('Connections overlap.');
  }
}

// More complex, valid ancestry uses a general graph layout. Each person appears
// once. Small family junctions keep the meaning of every parent/child edge clear.
export async function generalLayout(data,focusId){
  await import('./vendor/elk.bundled.js');
  const elk=new globalThis.ELK(),colour=new Map(),families=new Map(data.families.map(f=>[f.id,f]));
  const focus=families.get(focusId),people=new Map(data.people.map(p=>[p.id,p]));
  function mark(id,c,visited=new Set()){
    if(visited.has(id))return;visited.add(id);if(!colour.has(id))colour.set(id,c);
    for(const fid of people.get(id).families){const f=families.get(fid);for(const p of f.parents)if(!colour.has(p))colour.set(p,c);for(const child of f.children)mark(child,c,visited);}
  }
  focus?.children.forEach((id,c)=>mark(id,c));
  const children=data.people.map(p=>({id:p.id,width:W,height:H})),edges=[],edgeInfo=new Map();
  for(const f of data.families){
    const junction=`junction:${f.id}`;children.push({id:junction,width:6,height:6});
    for(const p of f.parents){const id=`${f.id}:parent:${p}`;edges.push({id,sources:[p],targets:[junction]});edgeInfo.set(id,{family:f.id,kind:'parent'});}
    for(const p of f.children){const id=`${f.id}:child:${p}`;edges.push({id,sources:[junction],targets:[p]});edgeInfo.set(id,{family:f.id,kind:'child',child:p});}
  }
  // The bundled in-process worker has no OS worker to terminate.
  const result=await elk.layout({id:'tree',layoutOptions:{'elk.algorithm':'layered','elk.direction':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'50','elk.layered.spacing.nodeNodeBetweenLayers':'85','elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES','elk.separateConnectedComponents':'true'},children,edges});
  const nodes=result.children.filter(n=>people.has(n.id)).map(n=>({id:n.id,x:n.x,y:n.y,w:W,h:H,branch:colour.get(n.id)??-1}));
  const junctions=result.children.filter(n=>!people.has(n.id)).map(n=>({x:n.x+3,y:n.y+3,w:6,h:6}));
  const paths=[];for(const edge of result.edges||[])for(const section of edge.sections||[])paths.push({...edgeInfo.get(edge.id),points:[section.startPoint,...(section.bendPoints||[]),section.endPoint].map(p=>[p.x,p.y])});
  // Junction boxes are not rendered as people; connect their boundary ports.
  for(const node of result.children.filter(n=>!people.has(n.id))){const f=node.id.slice('junction:'.length);paths.push({family:f,kind:'children',points:[[node.x+3,node.y],[node.x+3,node.y+6]]});}
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const branches=(focus?.children||[]).map((id,i)=>({person:id,number:i+1,x:byId.get(id).x,y:byId.get(id).y-22,width:W,colour:i}));
  return {mode:'general',nodes,paths,labels:[],junctions,branches,bounds:[-40,-40,Math.max(result.width||W,W)+80,Math.max(result.height||H,H)+80],cardWidth:W,cardHeight:H};
}
export async function arrange(data,focusId){
  if(!data.people.length)throw new Error('Keep at least one person in the tree.');
  try{const layout=originalLayout(data,focusId);checkGeometry(layout,{crossings:true});return layout;}
  catch{const layout=await generalLayout(data,focusId);checkGeometry(layout);return layout;}
}
