import {applyOperations,booleanShapes,createShape,FLATTEN_TOLERANCE,shapeBounds,validateDocument} from './geometry.mjs';
import {validateConstructOperation} from '../server/construction-schema.mjs';

const clone=value=>structuredClone(value);
const signedArea=ring=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;

function cleanContour(ring) {
  // Trigonometric closure can leave two vertices a few floating-point ULPs
  // apart. Clipping retains both; their adjacent edges then falsely appear to
  // touch across the numerical zero-length edge. Remove consecutive numerical
  // duplicates only, far below geometric flattening or fabrication tolerances.
  const tolerance=64*Number.EPSILON*Math.max(1,...ring.flat().map(Math.abs));
  const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<=tolerance;
  const clean=[];
  for(const point of ring)if(!clean.length||!same(clean.at(-1),point))clean.push(point);
  if(clean.length>1&&same(clean[0],clean.at(-1)))clean.pop();
  return clean;
}
function cleanShape(shape) {
  const contours=shape.contours.map(cleanContour);
  return createShape('path',{...shape,points:contours[0],contours});
}

/** Turn a small, normalized construction into ordinary editable cut geometry.
 * Positive parts are united together before any subtraction, so part ordering
 * does not accidentally erase a later addition. Only the final outside box is
 * dimensional: internal features and flattened curves remain estimated.
 */
function constructShape(operation) {
  const source=operation.parts.map(part=>{
    const {operation:unused,...props}=part;
    return createShape(part.type,{...props,role:'cut',provenance:'estimated'});
  });
  const bounds=source.map(shapeBounds),left=Math.min(...bounds.map(b=>b.x)),top=Math.min(...bounds.map(b=>b.y));
  const span=Math.max(1,...source.flatMap(s=>[s.width,s.height]),Math.max(...bounds.map(b=>b.x+b.width))-left,Math.max(...bounds.map(b=>b.y+b.height))-top);
  // Work in physical-sized units before flattening. Keep at least normalized
  // size so tiny target profiles do not violate primitive minimum dimensions.
  // The final adjustment's scale is included in the recorded error tolerance.
  const workScale=Math.max(1,Math.max(operation.shape.width,operation.shape.height)/span);
  const parts=source.map(s=>createShape(s.type,{
    ...s,x:(s.x-left)*workScale,y:(s.y-top)*workScale,width:s.width*workScale,height:s.height*workScale,
    params:{...s.params,...(s.params.cornerRadius!==undefined?{cornerRadius:s.params.cornerRadius*workScale}:{})},
    ...(s.points?{points:s.points.map(([x,y])=>[x*workScale,y*workScale])}:{})
  }));
  const positive=parts.filter((s,i)=>operation.parts[i].operation==='union');
  const negative=parts.filter((s,i)=>operation.parts[i].operation==='subtract');
  // Duplicating one input only for this identity union keeps the same boolean
  // validation and canonical ring winding for one-part and multi-part plans.
  let joined=cleanShape(booleanShapes(positive.length===1?[positive[0],positive[0]]:positive,'union'));
  if(negative.length)joined=cleanShape(booleanShapes([joined,...negative],'subtract'));
  // polygon-clipping returns positive-area outer rings and negative-area holes.
  // Its canonical winding survives booleanShapes' translation to local points.
  const outerCount=joined.contours.filter(ring=>signedArea(ring)>0).length;
  const sx=operation.shape.width/joined.width,sy=operation.shape.height/joined.height;
  const contours=joined.contours.map(ring=>cleanContour(ring.map(([x,y])=>[x*sx,y*sy])));
  const shape=createShape('path',{
    ...operation.shape,...(operation.targetId?{id:operation.targetId}:{}),
    points:contours[0],contours,closed:true,smooth:false,
    params:{operation:'construction',flattenTolerance:FLATTEN_TOLERANCE*2*Math.max(sx,sy)}
  });
  return {shape,outerCount};
}

/** Returns a cloned reply; neither the drawing nor the provider reply mutates.
 * Disconnected but renderable profiles carry blocking constructionIssues so
 * the visual review loop can inspect them and request a corrected construction.
 * Consumers must treat those issues exactly like preflight errors.
 */
export function expandConstructiveReply(reply,document) {
  if(!reply||typeof reply!=='object'||!Array.isArray(reply.operations)||reply.operations.length>60)throw Error('Provide at most 60 drawing operations.');
  let preview=validateDocument(document);
  const operations=[],constructionIssues=new Map();
  for(const original of reply.operations) {
    let expanded;
    if(original?.op==='construct') {
      const operation=validateConstructOperation(original,{document:preview});
      const {shape,outerCount}=constructShape(operation);
      // A later construction replaces the complete outline of this target, so
      // its topology diagnostic must replace the earlier diagnostic as well.
      constructionIssues.delete(shape.id);
      if(operation.targetId) {
        const {id,type,locked,...changes}=shape;
        expanded={op:'update',id:operation.targetId,changes};
      }else expanded={op:'add',shape};
      if(outerCount!==1)constructionIssues.set(shape.id,{
        severity:'error',code:'construction-disconnected',shapeId:shape.id,
        message:`${shape.name} contains ${outerCount} disconnected outer pieces. Overlap neighboring union parts and avoid subtracting through the entire profile. A single connected silhouette is required; enclosed holes are allowed.`
      });
    }else expanded=clone(original);
    preview=applyOperations(preview,[expanded]);
    operations.push(expanded);
  }
  // An explicitly deleted construction cannot block unrelated surviving work.
  const ids=new Set(preview.shapes.map(s=>s.id));
  return {...clone(reply),operations,constructionIssues:[...constructionIssues.values()].filter(issue=>ids.has(issue.shapeId))};
}
