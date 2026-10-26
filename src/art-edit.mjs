import {documentBounds,applyOperations,normalizePathBounds} from './geometry.mjs';
import {simplify} from './trace-core.mjs';

// Precise common edits do not need image interpretation or paid model calls.
export function editArtwork({question,document,selectedIds=[],language='en'}){
  if(typeof question!=='string'||!Array.isArray(document?.shapes))return null;
  const q=question.trim().toLowerCase(),selected=document.shapes.filter(s=>selectedIds.includes(s.id));
  let targets=selected;
  if(!targets.length&&document.shapes.length&&document.shapes.every(s=>s.trace)&&new Set(document.shapes.map(s=>s.groupId)).size===1)targets=document.shapes;
  if(!targets.length||!targets.every(s=>s.trace))return null;
  const reply=(en,zh,operations=[],needsInput=false)=>({reply:language==='zh'?zh:en,operations,needsInput,source:'local',assumptions:[],suggestions:[],requestCount:0});
  const b=documentBounds({shapes:targets},true),n=q.match(/-?\d+(?:\.\d+)?/),value=n?Number(n[0]):null,unit=/\bcm\b|厘米/.test(q)?10:/\bin(?:ch(?:es)?)?\b|英寸/.test(q)?25.4:1;
  let ops;
  if(/^(?:smooth|smooth (?:it|this|the lines|the drawing)|平滑|平滑线条)[.!。！]?$/.test(q))ops=targets.map(s=>({op:'update',id:s.id,changes:{smooth:true}}));
  else if(/^(?:simplify|simplify (?:it|this|the lines|the drawing)|简化|简化线条)[.!。！]?$/.test(q))ops=targets.map(s=>{
    const rings=(s.contours||[s.points]).map(points=>{const p=s.closed?[...points,points[0]]:points;const simplified=simplify(p,.15);return s.closed?simplified.slice(0,-1):simplified;});
    if(rings.some(p=>p.length<(s.closed?3:2)))throw Error('Simplifying would erase a small stroke. Select fewer paths.');
    const normalized=normalizePathBounds({...s,points:rings[0],...(s.contours?{contours:rings}:{})});const {id,type,...changes}=normalized;delete changes.trace;delete changes.groupId;delete changes.groupName;return {op:'update',id,changes};
  });
  else if(/^(?:rotate|旋转)\s*-?\d+(?:\.\d+)?\s*(?:degrees?|deg|°|度)?[.!。！]?$/.test(q)){
    const a=value*Math.PI/180,cx=b.x+b.width/2,cy=b.y+b.height/2;
    ops=targets.map(s=>{const x=s.x+s.width/2-cx,y=s.y+s.height/2-cy;return {op:'update',id:s.id,changes:{x:cx+x*Math.cos(a)-y*Math.sin(a)-s.width/2,y:cy+x*Math.sin(a)+y*Math.cos(a)-s.height/2,rotation:s.rotation+value}};});
  }else if(/^(?:move\s+(?:it\s+|this\s+)?(?:left|right|up|down)\s+\d+(?:\.\d+)?\s*(?:mm|cm|inches?|in)?|向?[左右上下]移(?:动)?\s*\d+(?:\.\d+)?\s*(?:毫米|厘米)?)之?[.!。！]?$/.test(q)){
    const dx=/left|左/.test(q)?-1:/right|右/.test(q)?1:0,dy=/up|上/.test(q)?-1:/down|下/.test(q)?1:0;
    ops=targets.map(s=>({op:'update',id:s.id,changes:{x:s.x+dx*value*unit,y:s.y+dy*value*unit}}));
  }else if(/^(?:(?:make|resize|scale)(?:\s+(?:it|this|the drawing|the artwork))?\s+(?:to\s+)?\d+(?:\.\d+)?\s*(?:mm|cm|inches?|in)?\s+(?:wide|width)|宽度?\s*(?:改为|设为)?\s*\d+(?:\.\d+)?\s*(?:毫米|厘米)?)[.!。！]?$/.test(q)){
    if(value<=0||b.width<.01)return reply('Give a positive artwork width.','请输入正数宽度。',[],true);
    const scale=value*unit/b.width;ops=targets.map(s=>({op:'update',id:s.id,changes:{x:b.x+(s.x-b.x)*scale,y:b.y+(s.y-b.y)*scale,width:s.width*scale,height:s.height*scale}}));
  }else if(/^(?:delete|remove|删除|删掉)(?:\s+(?:it|this|selected|selection))?[.!。！]?$/.test(q))ops=targets.map(s=>({op:'delete',id:s.id}));
  else return null;
  if(targets.some(s=>s.locked))return reply('Unlock the selected paths before editing them.','请先解锁选中的路径。',[],true);
  if(ops.length>60)return reply('Select a smaller group of paths.','请选择较少的路径。',[],true);
  applyOperations(document,ops);
  return reply('Here is the edit. Review the preview, then Keep it or Discard.','修改已预览。请检查后选择采用或放弃。',ops);
}
