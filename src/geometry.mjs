import polygonClipping from 'polygon-clipping';
import {retainedBracket} from './measured-bracket.mjs';

// Every coordinate is in millimetres. Curves are flattened only for checks,
// booleans and DXF; SVG retains the analytical curves. Maximum chord error is
// 0.025 mm (boolean output records its 0.05 mm two-stage tolerance).
export const FLATTEN_TOLERANCE = 0.025;
const EPS = 1e-7;
const MAX = 100000;
const TYPES = new Set(['rect', 'ellipse', 'line', 'path', 'text', 'plate', 'gear']);
const ROLES = new Set(['cut', 'score', 'engrave', 'reference']);
const PROVENANCE = new Set(['specified', 'estimated', 'calculated']);
const clone = value => structuredClone(value);
const uid = () => globalThis.crypto?.randomUUID?.() || `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const fail = message => { throw new Error(message); };
const finite = (n, label, min = -MAX, max = MAX) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) fail(`${label} must be a finite number from ${min} to ${max}.`);
  return n;
};
const nfmt = n => String(Number((Math.abs(n) < 0.0000005 ? 0 : n).toFixed(6)));
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS;
const closedRing = points => points.length && !same(points[0], points.at(-1)) ? [...points, [...points[0]]] : points;
const openRing = points => points.length > 1 && same(points[0], points.at(-1)) ? points.slice(0, -1) : points;
const escapeXML = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

function inspectFinite(value, path = 'data', depth = 0) {
  if (depth > 25) fail('Document nesting exceeds the supported limit.');
  if (typeof value === 'number' && !Number.isFinite(value)) fail(`${path} is not finite.`);
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) inspectFinite(child, `${path}.${key}`, depth + 1);
}

export function newDocument() {
  return {version: 1, name: 'Untitled design', units: 'mm', sheet: {width: 300, height: 200, material: 'cardboard', thickness: 3}, shapes: []};
}

const GLYPHS = {
  A: [[[0,6],[2,0],[4,6]],[[.7,4],[3.3,4]]],
  B: [[[0,6],[0,0],[2.8,0],[4,1],[4,2],[2.8,3],[0,3]],[[2.8,3],[4,4],[4,5],[2.8,6],[0,6]]],
  C: [[[4,1],[3,0],[1,0],[0,1],[0,5],[1,6],[3,6],[4,5]]],
  D: [[[0,0],[2,0],[4,1.5],[4,4.5],[2,6],[0,6],[0,0]]],
  E: [[[4,0],[0,0],[0,6],[4,6]],[[0,3],[3,3]]],
  F: [[[4,0],[0,0],[0,6]],[[0,3],[3,3]]],
  G: [[[4,1],[3,0],[1,0],[0,1],[0,5],[1,6],[4,6],[4,3],[2,3]]],
  H: [[[0,0],[0,6]],[[4,0],[4,6]],[[0,3],[4,3]]],
  I: [[[0,0],[4,0]],[[2,0],[2,6]],[[0,6],[4,6]]],
  J: [[[0,0],[4,0],[4,5],[3,6],[1,6],[0,5]]],
  K: [[[0,0],[0,6]],[[4,0],[0,3],[4,6]]],
  L: [[[0,0],[0,6],[4,6]]],
  M: [[[0,6],[0,0],[2,3],[4,0],[4,6]]],
  N: [[[0,6],[0,0],[4,6],[4,0]]],
  O: [[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]]],
  P: [[[0,6],[0,0],[3,0],[4,1],[4,2],[3,3],[0,3]]],
  Q: [[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]],[[2.5,4.5],[4,6]]],
  R: [[[0,6],[0,0],[3,0],[4,1],[4,2],[3,3],[0,3]],[[2,3],[4,6]]],
  S: [[[4,1],[3,0],[1,0],[0,1],[0,2],[1,3],[3,3],[4,4],[4,5],[3,6],[1,6],[0,5]]],
  T: [[[0,0],[4,0]],[[2,0],[2,6]]],
  U: [[[0,0],[0,5],[1,6],[3,6],[4,5],[4,0]]],
  V: [[[0,0],[2,6],[4,0]]],
  W: [[[0,0],[1,6],[2,3],[3,6],[4,0]]],
  X: [[[0,0],[4,6]],[[4,0],[0,6]]],
  Y: [[[0,0],[2,3],[4,0]],[[2,3],[2,6]]],
  Z: [[[0,0],[4,0],[0,6],[4,6]]],
  '0': [[[1,0],[3,0],[4,1],[4,5],[3,6],[1,6],[0,5],[0,1],[1,0]],[[.5,5.5],[3.5,.5]]],
  '1': [[[1,1],[2,0],[2,6]],[[0,6],[4,6]]],
  '2': [[[0,1],[1,0],[3,0],[4,1],[4,2],[0,6],[4,6]]],
  '3': [[[0,0],[4,0],[2,3],[4,4],[4,5],[3,6],[0,6]]],
  '4': [[[3,6],[3,0],[0,4],[4,4]]],
  '5': [[[4,0],[0,0],[0,3],[3,3],[4,4],[4,5],[3,6],[0,6]]],
  '6': [[[4,0],[1,0],[0,2],[0,5],[1,6],[3,6],[4,5],[4,4],[3,3],[0,3]]],
  '7': [[[0,0],[4,0],[1,6]]],
  '8': [[[1,0],[3,0],[4,1],[4,2],[3,3],[1,3],[0,2],[0,1],[1,0]],[[1,3],[0,4],[0,5],[1,6],[3,6],[4,5],[4,4],[3,3]]],
  '9': [[[4,3],[1,3],[0,2],[0,1],[1,0],[3,0],[4,1],[4,4],[3,6],[0,6]]],
  '-': [[[0,3],[4,3]]], '_': [[[0,6],[4,6]]], '+': [[[0,3],[4,3]],[[2,1],[2,5]]],
  '.': [[[1.8,5.8],[2.2,6]]], ',': [[[2,5],[1,6]]], ':': [[[2,1.8],[2,2.2]],[[2,4.8],[2,5.2]]],
  '/': [[[0,6],[4,0]]], '\\': [[[0,0],[4,6]]], '(': [[[3,0],[1,1],[1,5],[3,6]]], ')': [[[1,0],[3,1],[3,5],[1,6]]],
  '!': [[[2,0],[2,4]],[[2,5.8],[2,6]]], '?': [[[0,1],[1,0],[3,0],[4,1],[4,2],[2,3],[2,4]],[[2,5.8],[2,6]]],
  '=': [[[0,2],[4,2]],[[0,4],[4,4]]], ' ': []
};

export function createShape(type, props = {}) {
  if (!TYPES.has(type)) fail(`Unsupported shape type: ${type}.`);
  inspectFinite(props);
  const defaults = {rect:[50,30],ellipse:[40,40],line:[50,0],path:[50,50],text:[60,12],plate:[80,40],gear:[44,44]}[type];
  const shape = {id:uid(), name:type[0].toUpperCase()+type.slice(1), type, x:20, y:20, width:defaults[0], height:defaults[1], rotation:0, role:type==='text'?'engrave':'cut', locked:false, provenance:'specified', ...clone(props), params:{...props.params}};
  if (type === 'path') {
    shape.points ??= [[0,0],[shape.width,0],[shape.width,shape.height],[0,shape.height]];
    shape.closed ??= true;
    shape.smooth ??= false;
  }
  if (type === 'line') shape.points ??= [[0,0],[shape.width,shape.height]];
  if (type === 'text') {
    shape.text ??= 'FAB LAB';
    if (props.width == null) shape.width = Math.max(1, shape.text.length * 6 - 2) * shape.height / 6;
  }
  if (type === 'plate') shape.params = {holeDiameter:5,edgeInset:15,cornerRadius:3,...shape.params};
  if (type === 'gear') {
    shape.params = {teeth:20,module:2,pressureAngle:20,bore:5,...shape.params};
    const diameter = shape.params.module * (shape.params.teeth + 2);
    if (props.width != null && Math.abs(props.width-diameter)>EPS || props.height != null && Math.abs(props.height-diameter)>EPS) fail('Gear width and height must equal module × (teeth + 2). Change module to resize a gear.');
    shape.width = shape.height = diameter;
  }
  return validateShape(shape);
}

function validatePoints(points, label, min = 2) {
  if (!Array.isArray(points) || points.length < min || points.length > 20000) fail(`${label} must contain ${min} to 20000 coordinate pairs.`);
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2) fail(`${label} contains an invalid coordinate pair.`);
    finite(p[0],`${label} X`); finite(p[1],`${label} Y`);
  }
}

function validateShape(input) {
  const s = clone(input);
  if (!s || typeof s !== 'object' || !TYPES.has(s.type)) fail('Unknown shape type.');
  if (typeof s.id !== 'string' || !s.id.length || s.id.length>150) fail('Shape ID must be a nonempty string of at most 150 characters.');
  if (typeof s.name !== 'string' || s.name.length > 300) fail('Shape name must be a string of at most 300 characters.');
  // Grouping is selection metadata, never a geometry transform. Null supports
  // explicit ungrouping through the same atomic update operation as any edit.
  for(const [key,max] of [['groupId',150],['groupName',120]]) {
    if(s[key]!=null && (typeof s[key]!=='string' || !s[key].trim() || s[key].length>max))fail(`${key} must be null or a nonempty string of at most ${max} characters.`);
  }
  finite(s.x,'X'); finite(s.y,'Y'); finite(s.width,'Width',s.type==='line'?0:0.01,10000); finite(s.height,'Height',s.type==='line'?0:0.01,10000); finite(s.rotation,'Rotation',-360000,360000);
  if (!ROLES.has(s.role)) fail('Role must be cut, score, engrave, or reference.');
  if (!PROVENANCE.has(s.provenance)) fail('Provenance must be specified, estimated, or calculated.');
  if (typeof s.locked !== 'boolean') fail('Locked must be true or false.');
  if (!s.params || typeof s.params !== 'object' || Array.isArray(s.params)) fail('Shape params must be an object.');
  if (s.type==='path') {
    if (typeof s.closed!=='boolean' || typeof s.smooth!=='boolean') fail('Path closed and smooth must be boolean.');
    validatePoints(s.points,'Path points',s.closed?3:2);
    if (s.contours != null) {
      if (!Array.isArray(s.contours) || !s.contours.length || s.contours.length > 1000) fail('Contours must be a nonempty array of at most 1000 paths.');
      s.contours.forEach(p=>validatePoints(p,'Contour points',s.closed?3:2));
    }
  }
  if (s.type==='line') { validatePoints(s.points,'Line points'); if(s.points.length!==2 || same(s.points[0],s.points[1])) fail('A line needs two distinct endpoints.'); }
  if (s.type==='text') {
    if (typeof s.text!=='string' || !s.text.trim() || s.text.length>160) fail('Text needs 1 to 160 characters.');
    for (const c of s.text.toUpperCase()) if (!(c in GLYPHS)) fail(`The vector font does not support “${c}”. Use Latin letters, digits, spaces, or basic punctuation.`);
  }
  if (s.type==='rect' && s.params.cornerRadius!=null) finite(s.params.cornerRadius,'Corner radius',0,Math.min(s.width,s.height)/2);
  if (s.type==='plate') {
    const p=s.params;
    finite(p.holeDiameter,'Hole diameter',0.1,Math.min(s.width,s.height));
    finite(p.edgeInset,'Hole edge inset',p.holeDiameter/2,s.width/2);
    finite(p.cornerRadius,'Corner radius',0,Math.min(s.width,s.height)/2);
    if (s.width-2*p.edgeInset <= p.holeDiameter+EPS) fail('Plate holes must be separate; increase width or decrease hole inset/diameter.');
    if (p.holeDiameter>=s.height-EPS || p.edgeInset<=p.holeDiameter/2+EPS) fail('Plate holes need material between each hole and the plate edge.');
    const qx=Math.abs(p.edgeInset-s.width/2)-(s.width/2-p.cornerRadius),qy=-(s.height/2-p.cornerRadius);
    const edgeDistance=-(Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-p.cornerRadius);
    if(edgeDistance<=p.holeDiameter/2+EPS)fail('Plate holes intersect the rounded outer edge. Reduce the corner radius or move the holes inward.');
  }
  if (s.type==='gear') {
    const p=s.params;
    finite(p.teeth,'Teeth',8,160); if(!Number.isInteger(p.teeth)) fail('Gear tooth count must be a whole number.');
    finite(p.module,'Gear module',0.1,50); finite(p.pressureAngle,'Pressure angle',14.5,30);
    finite(p.bore,'Bore diameter',0,Math.max(0,p.module*(p.teeth-2.5)-0.1));
    const d=p.module*(p.teeth+2);
    if (Math.abs(s.width-d)>EPS || Math.abs(s.height-d)>EPS) fail('Gear dimensions must match module × (teeth + 2); nonuniform gear scaling is not supported.');
  }
  return s;
}

export function validateDocument(doc) {
  inspectFinite(doc);
  if (!doc || doc.version !== 1 || doc.units !== 'mm') fail('Expected a version 1 drawing in millimetres.');
  if(typeof doc.name!=='string' || doc.name.length>300) fail('Document name must be a string of at most 300 characters.');
  if(!doc.sheet || typeof doc.sheet!=='object') fail('Sheet settings are required.');
  finite(doc.sheet.width,'Sheet width',1,10000); finite(doc.sheet.height,'Sheet height',1,10000); finite(doc.sheet.thickness,'Material thickness',0.01,1000);
  if(typeof doc.sheet.material!=='string' || doc.sheet.material.length>200) fail('Material must be a string of at most 200 characters.');
  if(!Array.isArray(doc.shapes) || doc.shapes.length>2000) fail('A document supports at most 2000 shapes.');
  const result=clone(doc), ids=new Set();
  result.shapes=doc.shapes.map(s=>{const shape=validateShape(s);if(ids.has(shape.id))fail(`Duplicate shape ID: ${shape.id}.`);ids.add(shape.id);return shape;});
  return result;
}

export function duplicateShape(shape) {
  const copy={...clone(shape),id:uid(),name:`${shape.name} copy`,x:shape.x+10,y:shape.y+10,locked:false};
  // A copied object must not unexpectedly join its source object's group.
  // Multi-object UI duplication may explicitly assign a new shared group ID.
  delete copy.groupId;delete copy.groupName;
  return copy;
}

export function applyOperations(document, operations) {
  if(!Array.isArray(operations) || operations.length>60) fail('Provide at most 60 drawing operations.');
  inspectFinite(operations);
  const doc=validateDocument(document);
  for(const operation of operations) {
    if(!operation || typeof operation!=='object')fail('Invalid operation.');
    const {op}=operation;
    if(op==='sheet') {
      if(!operation.changes || typeof operation.changes!=='object' || Array.isArray(operation.changes))fail('Sheet changes must be an object.');
      for(const key of Object.keys(operation.changes))if(!['width','height','material','thickness'].includes(key))fail(`Unsupported sheet setting: ${key}.`);
      doc.sheet={...doc.sheet,...clone(operation.changes)}; continue;
    }
    if(op==='add') {
      if(!operation.shape || typeof operation.shape!=='object')fail('Add requires a shape.');
      doc.shapes.push(createShape(operation.shape.type,operation.shape)); continue;
    }
    if(!['update','delete','duplicate'].includes(op)) fail(`Unknown operation: ${op}.`);
    const index=doc.shapes.findIndex(s=>s.id===operation.id); if(index<0)fail(`Shape ${operation.id} does not exist.`);
    const before=doc.shapes[index];
    if(op==='duplicate') {
      const dup=duplicateShape(before); dup.x=before.x+finite(operation.dx??10,'Duplicate X offset');dup.y=before.y+finite(operation.dy??10,'Duplicate Y offset');doc.shapes.push(dup);continue;
    }
    const changes=operation.changes;
    if(before.locked && !(op==='update' && changes && Object.keys(changes).length===1 && changes.locked===false)) fail(`${before.name} is locked. Unlock it before changing it.`);
    if(op==='delete') {doc.shapes.splice(index,1);continue;}
    if(!changes || typeof changes!=='object' || Array.isArray(changes))fail('Update requires changes.');
    if('id' in changes || 'type' in changes)fail('Updates cannot replace a shape ID or type.');
    if('params' in changes && (!changes.params || typeof changes.params!=='object' || Array.isArray(changes.params)))fail('Updated params must be an object.');
    const after={...before,...clone(changes),params:{...before.params,...changes.params}};
    if(before.type==='gear') {
      const diameter=after.params.module*(after.params.teeth+2);
      if(('width' in changes && Math.abs(changes.width-diameter)>EPS) || ('height' in changes && Math.abs(changes.height-diameter)>EPS)) {
        if('module' in (changes.params||{}) || 'teeth' in (changes.params||{}))fail('Gear size conflicts with its module or tooth count.');
        const target=changes.width??changes.height;
        if('width' in changes && 'height' in changes && Math.abs(changes.width-changes.height)>EPS)fail('Gear scaling must be uniform.');
        const ratio=target/before.width;
        after.params.module=before.params.module*ratio;after.params.bore=before.params.bore*ratio;
      }
      after.width=after.height=after.params.module*(after.params.teeth+2);
    }
    if(['path','line'].includes(before.type) && (changes.width!=null || changes.height!=null)) {
      const sx=before.width===0?1:after.width/before.width,sy=before.height===0?1:after.height/before.height;
      const scale=p=>[p[0]*sx,p[1]*sy];
      if(!('points' in changes))after.points=before.points.map(scale);
      if(before.contours && !('contours' in changes))after.contours=before.contours.map(r=>r.map(scale));
      if(before.type==='line' && !('points' in changes)) {
        // Preserve endpoint order and negative slopes. A previously collapsed
        // axis has no direction to scale, so extend endpoint 2 positively.
        if(before.width===0&&after.width>0)after.points[1][0]=after.points[0][0]+after.width;
        if(before.height===0&&after.height>0)after.points[1][1]=after.points[0][1]+after.height;
      }
    }
    doc.shapes[index]=validateShape(after);
  }
  return validateDocument(doc);
}

function arcPoints(cx,cy,rx,ry,start=0,end=Math.PI*2) {
  const r=Math.max(rx,ry),maxAngle=r<=FLATTEN_TOLERANCE?Math.PI/4:2*Math.acos(Math.max(-1,Math.min(1,1-FLATTEN_TOLERANCE/r)));
  let count=Math.max(2,Math.ceil(Math.abs(end-start)/maxAngle));
  // Include cardinal points on complete circles/ellipses so exported diameters
  // remain exact even in a polyline-only downstream importer.
  if(Math.abs(Math.abs(end-start)-Math.PI*2)<EPS)count=Math.ceil(count/4)*4;
  return Array.from({length:count+1},(_,i)=>[cx+rx*Math.cos(start+(end-start)*i/count),cy+ry*Math.sin(start+(end-start)*i/count)]);
}
function rectanglePoints(w,h,r=0) {
  if(!r)return [[0,0],[w,0],[w,h],[0,h],[0,0]];
  return closedRing([
    ...arcPoints(w-r,r,r,r,-Math.PI/2,0),...arcPoints(w-r,h-r,r,r,0,Math.PI/2),
    ...arcPoints(r,h-r,r,r,Math.PI/2,Math.PI),...arcPoints(r,r,r,r,Math.PI,Math.PI*1.5)
  ]);
}
const bezierSegments=(points,closed)=>{
  const pts=closed?openRing(points):points,segments=[];
  // Shape-preserving Catmull-style interpolation. Each anchor shares a tangent
  // between its incoming and outgoing cubic (C1 continuity). Clamp each tangent
  // component to BOTH neighbouring anchor intervals, so every control point
  // stays inside its segment's coordinate bounds. At a local extremum that
  // component becomes zero. Thus the curve hits the anchor extrema without
  // overshooting the requested dimensions; this also applies to DXF flattening.
  const tangents=pts.map((p,i)=>{
    const previous=i>0?pts[i-1]:closed?pts.at(-1):p;
    const next=i<pts.length-1?pts[i+1]:closed?pts[0]:p;
    return p.map((coordinate,axis)=>{
      const before=coordinate-previous[axis],after=next[axis]-coordinate;
      let lower=-Infinity,upper=Infinity;
      if(closed||i>0){lower=Math.max(lower,Math.min(0,before));upper=Math.min(upper,Math.max(0,before));}
      if(closed||i<pts.length-1){lower=Math.max(lower,Math.min(0,after));upper=Math.min(upper,Math.max(0,after));}
      return Math.max(lower,Math.min(upper,(next[axis]-previous[axis])/6));
    });
  });
  for(let i=0;i<(closed?pts.length:pts.length-1);i++) {
    const j=(i+1)%pts.length,p1=pts[i],p2=pts[j],t1=tangents[i],t2=tangents[j];
    segments.push([p1,[p1[0]+t1[0],p1[1]+t1[1]],[p2[0]-t2[0],p2[1]-t2[1]],p2]);
  }
  return segments;
};
const distanceLine=(p,a,b)=>{
  const dx=b[0]-a[0],dy=b[1]-a[1];
  if(Math.hypot(dx,dy)<EPS)return Math.hypot(p[0]-a[0],p[1]-a[1]);
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
};
function flattenCubic(c,out,depth=0) {
  if(depth>=16 || Math.max(distanceLine(c[1],c[0],c[3]),distanceLine(c[2],c[0],c[3]))<=FLATTEN_TOLERANCE) {out.push(c[3]);return;}
  const mid=(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
  const a=mid(c[0],c[1]),b=mid(c[1],c[2]),d=mid(c[2],c[3]),e=mid(a,b),f=mid(b,d),g=mid(e,f);
  flattenCubic([c[0],a,e,g],out,depth+1);flattenCubic([g,f,d,c[3]],out,depth+1);
}
function pathPoints(points,closed,smooth) {
  if(!smooth)return (closed?closedRing(points):points).map(p=>[...p]);
  const result=[[...points[0]]];for(const c of bezierSegments(points,closed))flattenCubic(c,result);return result;
}
function gearPoints(s) {
  const {teeth:z,module:m,pressureAngle}=s.params,phi=pressureAngle*Math.PI/180;
  const pitch=m*z/2,base=pitch*Math.cos(phi),outer=pitch+m,root=pitch-1.25*m,c=s.width/2;
  const inv=r=>{const t=Math.sqrt(Math.max(0,(r/base)**2-1));return t-Math.atan(t);};
  const half=Math.PI/(2*z),invPitch=Math.tan(phi)-phi,minR=Math.max(root,base);
  const halfAt=r=>half+invPitch-inv(r),pts=[];
  const polar=(r,a)=>[c+r*Math.cos(a),c+r*Math.sin(a)];
  const segments=Math.max(8,Math.ceil(Math.sqrt((outer-minR)/FLATTEN_TOLERANCE)*2));
  for(let k=0;k<z;k++) {
    const a=k*2*Math.PI/z,rootHalf=halfAt(minR);
    pts.push(polar(root,a-rootHalf));
    for(let i=0;i<=segments;i++){const r=minR+(outer-minR)*i/segments;pts.push(polar(r,a-halfAt(r)));}
    const tip=arcPoints(c,c,outer,outer,a-halfAt(outer),a+halfAt(outer));pts.push(...tip.slice(1));
    for(let i=segments-1;i>=0;i--){const r=minR+(outer-minR)*i/segments;pts.push(polar(r,a+halfAt(r)));}
    pts.push(polar(root,a+rootHalf));
    const valley=arcPoints(c,c,root,root,a+rootHalf,(k+1)*2*Math.PI/z-rootHalf);pts.push(...valley.slice(1));
  }
  return closedRing(pts);
}
function localPolylines(s) {
  switch(s.type) {
    case 'rect':return [rectanglePoints(s.width,s.height,s.params.cornerRadius||0)];
    case 'ellipse':return [arcPoints(s.width/2,s.height/2,s.width/2,s.height/2)];
    case 'line':return [s.points];
    case 'path':return (s.contours||[s.points]).map(p=>pathPoints(p,s.closed,s.smooth));
    case 'plate': {
      const {holeDiameter:d,edgeInset:i,cornerRadius:r}=s.params;
      return [rectanglePoints(s.width,s.height,r),arcPoints(i,s.height/2,d/2,d/2),arcPoints(s.width-i,s.height/2,d/2,d/2)];
    }
    case 'gear':return [gearPoints(s),...(s.params.bore?[arcPoints(s.width/2,s.height/2,s.params.bore/2,s.params.bore/2)]:[])];
    case 'text': {
      const chars=[...s.text.toUpperCase()],sx=s.width/Math.max(1,chars.length*6-2),sy=s.height/6;
      return chars.flatMap((char,i)=>GLYPHS[char].map(path=>path.map(([x,y])=>[(x+i*6)*sx,y*sy])));
    }
    default:fail('Unsupported shape.');
  }
}
function transformPoint(p,s) {
  const a=s.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),x=p[0]-s.width/2,y=p[1]-s.height/2;
  return [s.x+s.width/2+x*c-y*sn,s.y+s.height/2+x*sn+y*c];
}
export function getShapePoints(shape) { return localPolylines(shape).map(r=>r.map(p=>transformPoint(p,shape))); }
export function normalizePathBounds(input) {
  const s=validateShape(input);
  if(s.type!=='path'&&s.type!=='line')fail('Only paths and lines have editable point bounds.');
  const contours=s.type==='path'&&s.contours?s.contours:[s.points],bounds=boundsOf(contours.flat());
  const width=s.type==='line'?bounds.width:Math.max(0.01,bounds.width),height=s.type==='line'?bounds.height:Math.max(0.01,bounds.height);
  // The new box centre is expressed in the old local coordinate system first.
  // Transforming it before replacing width/height preserves every world point
  // even when the old box is rotated and a node moved beyond its old extents.
  const centre=transformPoint([bounds.x+width/2,bounds.y+height/2],s);
  const shifted=contours.map(r=>r.map(([x,y])=>[x-bounds.x,y-bounds.y]));
  s.x=centre[0]-width/2;s.y=centre[1]-height/2;s.width=width;s.height=height;
  s.points=shifted[0];
  if(s.type==='path'&&s.contours)s.contours=shifted;
  return validateShape(s);
}
export function shapeTransform(s) { return `translate(${nfmt(s.x)} ${nfmt(s.y)}) rotate(${nfmt(s.rotation)} ${nfmt(s.width/2)} ${nfmt(s.height/2)})`; }
function polyPath(points,closed) {return `M ${points.map(p=>`${nfmt(p[0])} ${nfmt(p[1])}`).join(' L ')}${closed?' Z':''}`;}
function circlePath(cx,cy,rx,ry) {return `M ${nfmt(cx-rx)} ${nfmt(cy)} A ${nfmt(rx)} ${nfmt(ry)} 0 1 0 ${nfmt(cx+rx)} ${nfmt(cy)} A ${nfmt(rx)} ${nfmt(ry)} 0 1 0 ${nfmt(cx-rx)} ${nfmt(cy)} Z`;}
function rectPath(w,h,r) {
  if(!r)return `M 0 0 H ${nfmt(w)} V ${nfmt(h)} H 0 Z`;
  return `M ${nfmt(r)} 0 H ${nfmt(w-r)} A ${r} ${r} 0 0 1 ${w} ${r} V ${h-r} A ${r} ${r} 0 0 1 ${w-r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h-r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
}
export function shapePath(s) {
  const measured=retainedBracket(s);if(measured)return measured.svg;
  if(s.type==='ellipse')return circlePath(s.width/2,s.height/2,s.width/2,s.height/2);
  if(s.type==='rect')return rectPath(s.width,s.height,s.params.cornerRadius||0);
  if(s.type==='plate') {const {holeDiameter:d,edgeInset:i,cornerRadius:r}=s.params;return `${rectPath(s.width,s.height,r)} ${circlePath(i,s.height/2,d/2,d/2)} ${circlePath(s.width-i,s.height/2,d/2,d/2)}`;}
  if(s.type==='gear')return `${polyPath(gearPoints(s),true)}${s.params.bore?' '+circlePath(s.width/2,s.height/2,s.params.bore/2,s.params.bore/2):''}`;
  if(s.type==='path' && s.smooth)return (s.contours||[s.points]).map(points=>`M ${points[0].map(nfmt).join(' ')} ${bezierSegments(points,s.closed).map(c=>`C ${c.slice(1).map(p=>p.map(nfmt).join(' ')).join(' ')}`).join(' ')}${s.closed?' Z':''}`).join(' ');
  return localPolylines(s).map(p=>polyPath(p,s.type==='path'&&s.closed)).join(' ');
}
function boundsOf(points) {
  if(!points.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const [x,y]of points){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  return {x:minX,y:minY,width:maxX-minX,height:maxY-minY};
}
export function shapeBounds(s) {
  if(s.type==='ellipse') {
    const a=s.rotation*Math.PI/180,rx=s.width/2,ry=s.height/2,ex=Math.hypot(rx*Math.cos(a),ry*Math.sin(a)),ey=Math.hypot(rx*Math.sin(a),ry*Math.cos(a));
    return {x:s.x+rx-ex,y:s.y+ry-ey,width:2*ex,height:2*ey};
  }
  return boundsOf(getShapePoints(s).flat())||{x:s.x,y:s.y,width:s.width,height:s.height};
}
export function documentBounds(doc,includeReference=false) {
  return boundsOf(doc.shapes.filter(s=>includeReference||s.role!=='reference').flatMap(s=>{const b=shapeBounds(s);return [[b.x,b.y],[b.x+b.width,b.y+b.height]];}));
}

function area(ring) {let sum=0;for(let i=0;i<ring.length-1;i++)sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];return sum/2;}
function cross(a,b,c) {return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function crosses(a,b,c,d) {
  if(Math.max(a[0],b[0])<Math.min(c[0],d[0])-EPS || Math.max(c[0],d[0])<Math.min(a[0],b[0])-EPS || Math.max(a[1],b[1])<Math.min(c[1],d[1])-EPS || Math.max(c[1],d[1])<Math.min(a[1],b[1])-EPS)return false;
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if(abC*abD<0 && cdA*cdB<0)return true;
  const on=(p,u,v)=>p[0]>=Math.min(u[0],v[0])-EPS&&p[0]<=Math.max(u[0],v[0])+EPS&&p[1]>=Math.min(u[1],v[1])-EPS&&p[1]<=Math.max(u[1],v[1])+EPS;
  return Math.abs(abC)<EPS&&on(c,a,b)||Math.abs(abD)<EPS&&on(d,a,b)||Math.abs(cdA)<EPS&&on(a,c,d)||Math.abs(cdB)<EPS&&on(b,c,d);
}
// Diagnostic only: original anchor indices survive subdivision, so repair
// feedback identifies editable edges instead of opaque flattened segment IDs.
// It uses the same curves/tolerance as preflight and never changes acceptance.
export function firstPathIntersection(input) {
  const s=validateShape(input);if(s.type!=='path')return null;
  const segments=[];
  for(const [contour,source]of (s.contours||[s.points]).entries()) {
    const points=s.closed?openRing(source):source,parts=[];
    if(s.smooth)for(const [edge,cubic]of bezierSegments(points,s.closed).entries()) {
      const flat=[cubic[0]];flattenCubic(cubic,flat);
      for(let i=0;i<flat.length-1;i++)parts.push({a:flat[i],b:flat[i+1],edge});
    }
    else for(let edge=0;edge<(s.closed?points.length:points.length-1);edge++)parts.push({a:points[edge],b:points[(edge+1)%points.length],edge});
    parts.forEach((part,index)=>segments.push({...part,contour,index,count:parts.length,from:part.edge,to:(part.edge+1)%points.length,start:points[part.edge],end:points[(part.edge+1)%points.length]}));
  }
  let checks=0;
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++) {
    const a=segments[i],b=segments[j];
    if(a.contour===b.contour&&(Math.abs(a.index-b.index)<=1||s.closed&&a.index===0&&b.index===a.count-1))continue;
    if(same(a.a,a.b)||same(b.a,b.b))continue;
    if(++checks>500000)return null;
    if(!crosses(a.a,a.b,b.a,b.b))continue;
    const dx=a.b[0]-a.a[0],dy=a.b[1]-a.a[1],ex=b.b[0]-b.a[0],ey=b.b[1]-b.a[1],den=dx*ey-dy*ex;
    let point,kind;
    if(Math.abs(den)>EPS) {
      const t=((b.a[0]-a.a[0])*ey-(b.a[1]-a.a[1])*ex)/den;
      const u=((b.a[0]-a.a[0])*dy-(b.a[1]-a.a[1])*dx)/den;
      point=[a.a[0]+t*dx,a.a[1]+t*dy];kind=[a.start,a.end,b.start,b.end].some(p=>same(p,point))?'touch':'cross';
    } else {
      const shared=[a.a,a.b,b.a,b.b].filter(p=>distanceLine(p,a.a,a.b)<EPS&&distanceLine(p,b.a,b.b)<EPS);
      point=shared[0];if(!point)continue;
      kind=shared.some(p=>!same(p,point))?'overlap':'touch';
    }
    return {contourA:a.contour,segmentA:[a.from,a.to],contourB:b.contour,segmentB:[b.from,b.to],point:[...point],kind};
  }
  return null;
}
function selfCrosses(ring) {
  const b=boundsOf(ring),count=ring.length-1,cells=Math.min(128,Math.max(1,Math.ceil(Math.sqrt(count/8))));
  if(!b || b.width<EPS || b.height<EPS)return false;
  const buckets=new Map(),seen=new Set(),cellX=b.width/cells,cellY=b.height/cells;
  let checks=0;
  for(let i=0;i<count;i++) {
    const a=ring[i],d=ring[i+1];if(same(a,d))continue;
    const x0=Math.floor((Math.min(a[0],d[0])-b.x)/cellX),x1=Math.min(cells-1,Math.floor((Math.max(a[0],d[0])-b.x)/cellX));
    const y0=Math.floor((Math.min(a[1],d[1])-b.y)/cellY),y1=Math.min(cells-1,Math.floor((Math.max(a[1],d[1])-b.y)/cellY));
    for(let x=Math.min(x0,cells-1);x<=x1;x++)for(let y=Math.min(y0,cells-1);y<=y1;y++) {
      const key=x+','+y,previous=buckets.get(key)||[];
      for(const j of previous) {
        if(Math.abs(i-j)<=1 || j===0&&i===count-1&&same(ring[0],ring.at(-1)))continue;
        const pair=i*count+j;if(seen.has(pair))continue;seen.add(pair);
        if(++checks>500000)return null; // Report an incomplete check instead of blocking the browser.
        if(crosses(a,d,ring[j],ring[j+1]))return true;
      }
      previous.push(i);buckets.set(key,previous);
    }
  }
  return false;
}
function segmentKey(a,b) {const key=p=>p.map(n=>n.toFixed(4)).join(',');return [key(a),key(b)].sort().join('|');}
export function preflight(input) {
  let doc;try{doc=validateDocument(input);}catch(error){return [{severity:'error',code:'invalid-document',message:error.message}];}
  const issues=[],segments=new Map(),drawable=doc.shapes.filter(s=>s.role!=='reference');
  if(!drawable.length)issues.push({severity:'error',code:'empty',message:'Add at least one cut, score, or engrave shape before export.'});
  const add=(s,severity,code,message)=>issues.push({severity,code,message,shapeId:s.id});
  for(const s of drawable) {
    const lines=getShapePoints(s),bounds=shapeBounds(s);
    if(bounds.x < -0.01 || bounds.y < -0.01 || bounds.x+bounds.width>doc.sheet.width+0.01 || bounds.y+bounds.height>doc.sheet.height+0.01)add(s,'warning','outside-sheet',`${s.name} extends outside the material sheet.`);
    if(s.provenance==='estimated')add(s,'warning','estimated',`${s.name} has estimated dimensions. Confirm the size before cutting.`);
    if(s.type==='gear' && s.params.teeth<2/(Math.sin(s.params.pressureAngle*Math.PI/180)**2))add(s,'warning','gear-undercut',`${s.name}: this low tooth count needs undercut/profile-shift engineering. The generated standard involute outline is a prototype.`);
    if(s.type==='gear')add(s,'warning','gear-fit',`${s.name}: no backlash or root fillet is applied. Test the mating gear and material before making a loaded mechanism.`);
    if(s.type==='text')add(s,'warning','stroke-text',`${s.name} uses single-line lettering for scoring/engraving, not a filled font or stencil.`);
    let duplicate=false,intersect=false,tiny=false,open=false,incomplete=false,degenerate=false;
    for(const ring of lines) {
      const closed=same(ring[0],ring.at(-1));
      if(s.role==='cut'&&!closed)open=true;
      if(closed&&Math.abs(area(ring))<0.25)tiny=true;
      if(closed&&s.role==='cut'&&Math.abs(area(ring))<EPS)degenerate=true;
      if(s.type==='path' && s.role==='cut') {const crossing=selfCrosses(ring);if(crossing===null)incomplete=true;else if(crossing)intersect=true;}
      for(let i=0;i<ring.length-1;i++) {
        if(same(ring[i],ring[i+1]))continue;
        const key=segmentKey(ring[i],ring[i+1]);if(segments.has(key))duplicate=true;else segments.set(key,s.id);
      }
    }
    // Crossing contours within a compound shape can produce unexpected islands.
    let contourChecks=0;
    if(s.type==='path'&&s.role==='cut')for(let i=0;i<lines.length&&!intersect&&!incomplete;i++)for(let j=i+1;j<lines.length&&!intersect&&!incomplete;j++)for(let a=0;a<lines[i].length-1&&!intersect&&!incomplete;a++)for(let b=0;b<lines[j].length-1;b++) {
      if(++contourChecks>500000){incomplete=true;break;}
      if(crosses(lines[i][a],lines[i][a+1],lines[j][b],lines[j][b+1])){intersect=true;break;}
    }
    if(open)add(s,'warning','open-cut',`${s.name} contains an open cut path; it will cut a line rather than release a closed piece.`);
    if(tiny)add(s,'warning','tiny-contour',`${s.name} contains a contour smaller than 0.25 mm². Check it against your material and kerf.`);
    if(degenerate)add(s,'error','degenerate-contour',`${s.name} has a closed contour with zero net area. Repair it before cutting.`);
    if(intersect) {
      const crossing=firstPathIntersection(s),rounded=n=>String(Number(n.toFixed(3)));
      const detail=crossing?` Zero-based contour ${crossing.contourA} edge ${crossing.segmentA.join('→')} intersects contour ${crossing.contourB} edge ${crossing.segmentB.join('→')} near local (${crossing.point.map(rounded).join(', ')}) mm.`:'';
      add(s,'error','self-intersection',`${s.name} has crossing contours.${detail} Repair or combine the outlines before cutting.`);
    }
    if(duplicate)add(s,'warning','duplicate-lines',`${s.name} repeats a line already in the drawing. Duplicate cuts can burn material.`);
    if(incomplete)add(s,'warning','complexity-check',`${s.name} is too complex for a complete intersection check. Simplify it or inspect the cutting paths in machine software.`);
  }
  return issues;
}

export function exportSVG(input,options={}) {
  const doc=validateDocument(input),colors={cut:'#ff0000',score:'#0000ff',engrave:'#000000',reference:'#888888'};
  const groups=[...ROLES].filter(role=>role!=='reference'||options.includeReference).map(role=>{
    const paths=doc.shapes.filter(s=>s.role===role).map(s=>`    <path id="${escapeXML(s.id)}" data-name="${escapeXML(s.name)}" data-provenance="${s.provenance}" d="${shapePath(s)}" transform="${shapeTransform(s)}"/>`).join('\n');
    return paths?`  <g id="${role}" data-operation="${role}" fill="none" fill-rule="evenodd" stroke="${colors[role]}" stroke-width="0.1">\n${paths}\n  </g>`:'';
  }).filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${nfmt(doc.sheet.width)}mm" height="${nfmt(doc.sheet.height)}mm" viewBox="0 0 ${nfmt(doc.sheet.width)} ${nfmt(doc.sheet.height)}">\n  <title>${escapeXML(options.title||doc.name)}</title>\n  <desc>Fab Draw. Units: mm. Red: cut; blue: score; black: engrave. Reference geometry omitted by default. No kerf compensation or machine settings applied.</desc>\n${groups}\n</svg>`;
}
export function exportDXF(input,options={}) {
  const doc=validateDocument(input),out=[];const pair=(code,value)=>out.push(String(code),String(value));
  pair(0,'SECTION');pair(2,'HEADER');pair(9,'$ACADVER');pair(1,'AC1015');pair(9,'$INSUNITS');pair(70,4);pair(9,'$MEASUREMENT');pair(70,1);pair(0,'ENDSEC');
  pair(0,'SECTION');pair(2,'TABLES');pair(0,'TABLE');pair(2,'LAYER');pair(70,options.includeReference?4:3);
  for(const [role,color]of [['cut',1],['score',5],['engrave',7],['reference',8]]) {if(role==='reference'&&!options.includeReference)continue;pair(0,'LAYER');pair(100,'AcDbSymbolTableRecord');pair(100,'AcDbLayerTableRecord');pair(2,role.toUpperCase());pair(70,0);pair(62,color);pair(6,'CONTINUOUS');}
  pair(0,'ENDTAB');pair(0,'ENDSEC');pair(0,'SECTION');pair(2,'ENTITIES');
  for(const s of doc.shapes) {
    if(s.role==='reference'&&!options.includeReference)continue;
    for(const line of getShapePoints(s)) {
      const closed=same(line[0],line.at(-1)),vertices=closed?openRing(line):line;
      pair(0,'LWPOLYLINE');pair(100,'AcDbEntity');pair(8,s.role.toUpperCase());pair(100,'AcDbPolyline');pair(90,vertices.length);pair(70,closed?1:0);
      for(const [x,y]of vertices){pair(10,nfmt(x));pair(20,nfmt(doc.sheet.height-y));}
    }
  }
  pair(0,'ENDSEC');pair(0,'EOF');return out.join('\r\n')+'\r\n';
}

export function booleanShapes(input,operation) {
  if(!Array.isArray(input)||input.length<2||input.length>100)fail('Select 2 to 100 closed shapes to combine.');
  const alias={subtract:'difference',intersect:'intersection',join:'union'},op=alias[operation]||operation;
  if(!['union','difference','intersection','xor'].includes(op))fail('Choose union, difference, intersection, or xor.');
  const shapes=input.map(validateShape);
  if(shapes.some(s=>s.locked))fail('Unlock the selected shapes before combining them.');
  if(shapes.some(s=>s.role!==shapes[0].role))fail('Shapes must share the same cut/score/engrave role to combine.');
  const geometries=shapes.map(s=>{
    if(s.type==='line'||s.type==='text'||s.type==='path'&&!s.closed)fail('Only closed outlines can be combined.');
    const rings=getShapePoints(s);
    if(s.type==='path')for(const ring of rings){const crossing=selfCrosses(ring);if(crossing===null)fail('This path is too complex to verify safely before combining. Simplify it first.');if(crossing)fail('Repair self-intersecting outlines before combining shapes.');}
    return rings.reduce((result,ring)=>result.length?polygonClipping.xor(result,[[closedRing(ring)]]):[[closedRing(ring)]],[]);
  });
  const result=polygonClipping[op](...geometries);
  if(!result.length)fail('The operation leaves no geometry. Nothing was changed.');
  const contours=result.flat().map(openRing),bounds=boundsOf(contours.flat());
  const local=contours.map(r=>r.map(([x,y])=>[x-bounds.x,y-bounds.y]));
  return createShape('path',{name:op==='union'?'Joined shapes':op==='difference'?'Cut-out shape':'Combined shapes',x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height,role:shapes[0].role,provenance:'calculated',points:local[0],contours:local,closed:true,smooth:false,params:{flattenTolerance:FLATTEN_TOLERANCE*2,operation:op}});
}
