export function fixture(){
  const family=(id,parents,children)=>({id,parents,children,relationship:'Unknown',notes:[],events:[],citations:[],childRelations:[]});
  const families=[family('main',['a','b'],['c','d']),family('couple',['c','e'],['f']),family('single',['c'],['g'])];
  const people='abcdefghi'.split('').map((id,i)=>({id,name:['Alex Example','Bailey Example','Casey Example','Drew Example','Ellis Example','Fran Example','Gale Example','Harper Example','Indigo Example'][i],otherNames:[],gender:'U',events:[],notes:[],citations:[],tags:[],families:families.filter(f=>f.parents.includes(id)).map(f=>f.id),parentFamilies:families.filter(f=>f.children.includes(id)).map(f=>f.id)}));
  return {version:1,updated:'2026-11-24',focusFamily:'main',people,families,events:[],notes:[],sources:[],citations:[]};
}
