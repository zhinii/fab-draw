import test from 'node:test';
import assert from 'node:assert/strict';
import {newDocument,createShape,validateDocument,applyOperations,shapePath,shapeTransform,shapeBounds,documentBounds,exportSVG,exportDXF,preflight,duplicateShape,booleanShapes,getShapePoints,normalizePathBounds} from '../src/geometry.mjs';

const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} should equal ${expected} ± ${tolerance}`);
const withShapes=(...shapes)=>({...newDocument(),shapes});
const polygonArea=ring=>Math.abs(ring.slice(0,-1).reduce((sum,p,i)=>sum+p[0]*ring[i+1][1]-ring[i+1][0]*p[1],0)/2);

test('new document is independent, millimetre based, and valid',()=>{
  const a=newDocument(),b=newDocument();a.sheet.width=400;assert.equal(b.sheet.width,300);assert.deepEqual(validateDocument(a),a);
});

test('plate preserves specified hole diameter and edge inset when its width changes',()=>{
  const plate=createShape('plate',{x:0,y:0,width:80,height:40,params:{holeDiameter:5,edgeInset:15,cornerRadius:3}});
  const original=withShapes(plate),changed=applyOperations(original,[{op:'update',id:plate.id,changes:{width:100}}]);
  const [outer,left,right]=getShapePoints(changed.shapes[0]);
  assert.equal(original.shapes[0].width,80);assert.equal(changed.shapes[0].width,100);
  near(Math.max(...outer.map(p=>p[0])),100);
  near((Math.max(...left.map(p=>p[0]))+Math.min(...left.map(p=>p[0])))/2,15,0.025);
  near((Math.max(...right.map(p=>p[0]))+Math.min(...right.map(p=>p[0])))/2,85,0.025);
  assert.match(shapePath(changed.shapes[0]),/A 2\.5 2\.5/);
});

test('invalid plate hole overlap, edge contact and impossible corner radii are rejected',()=>{
  assert.throws(()=>createShape('plate',{width:30,height:20}),/separate/);
  assert.throws(()=>createShape('plate',{params:{edgeInset:2.5}}),/edge/);
  assert.throws(()=>createShape('plate',{width:80,height:20,params:{cornerRadius:11,holeDiameter:8,edgeInset:4.1}}),/Corner radius/);
});

test('an operation batch rolls back entirely on an unknown ID or malformed operation',()=>{
  const d=withShapes(createShape('rect'));
  const before=structuredClone(d);
  assert.throws(()=>applyOperations(d,[{op:'update',id:d.shapes[0].id,changes:{width:100}},{op:'delete',id:'missing'}]),/does not exist/);
  assert.deepEqual(d,before);
  assert.throws(()=>applyOperations(d,[{op:'fetch',url:'https://example.com'}]),/Unknown operation/);
  assert.throws(()=>applyOperations(d,Array.from({length:61},()=>({op:'sheet',changes:{}}))),/at most 60/);
});

test('IDs must be unique, metadata is retained, and mutation cannot replace shape identity',()=>{
  const s=createShape('rect',{customNote:'Student design'});
  assert.equal(validateDocument(withShapes(s)).shapes[0].customNote,'Student design');
  assert.throws(()=>validateDocument(withShapes(s,s)),/Duplicate shape ID/);
  assert.throws(()=>applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{id:'replacement'}}]),/cannot replace/);
});

test('group metadata survives project serialization and updates without changing geometry',()=>{
  const s=createShape('rect',{x:13,y:29,width:80,height:40,rotation:37,groupId:'assembly-1',groupName:'Front panel'});
  const document=validateDocument(JSON.parse(JSON.stringify(withShapes(s))));
  assert.equal(document.shapes[0].groupId,'assembly-1');assert.equal(document.shapes[0].groupName,'Front panel');
  const updated=applyOperations(document,[{op:'update',id:s.id,changes:{groupId:'assembly-2',groupName:'New assembly'}}]);
  assert.deepEqual(getShapePoints(updated.shapes[0]),getShapePoints(s));
  assert.equal(updated.shapes[0].groupId,'assembly-2');assert.equal(updated.shapes[0].groupName,'New assembly');
  const ungrouped=applyOperations(updated,[{op:'update',id:s.id,changes:{groupId:null,groupName:null}}]);
  assert.equal(ungrouped.shapes[0].groupId,null);assert.equal(ungrouped.shapes[0].groupName,null);
});

test('group metadata rejects invalid values, respects locks, and copies start ungrouped',()=>{
  for(const props of [{groupId:3},{groupId:' '},{groupId:'a'.repeat(151)},{groupName:false},{groupName:''},{groupName:'a'.repeat(121)}])assert.throws(()=>createShape('rect',props),/group(Id|Name) must/);
  const s=createShape('rect',{groupId:'assembly',groupName:'Assembly'});
  assert.throws(()=>applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{groupId:{id:'nested'}}}]),/groupId must/);
  const locked={...s,locked:true};
  assert.throws(()=>applyOperations(withShapes(locked),[{op:'update',id:s.id,changes:{groupId:null,groupName:null}}]),/locked/);
  const copy=duplicateShape(s);assert.equal(copy.groupId,undefined);assert.equal(copy.groupName,undefined);
  const batch=applyOperations(withShapes(s),[{op:'duplicate',id:s.id}]);
  assert.equal(batch.shapes[0].groupId,'assembly');assert.equal(batch.shapes[1].groupId,undefined);assert.equal(batch.shapes[1].groupName,undefined);
});

test('locked shapes reject movement and deletion but allow a separate unlock',()=>{
  const s=createShape('rect',{locked:true});const d=withShapes(s);
  assert.throws(()=>applyOperations(d,[{op:'update',id:s.id,changes:{x:100}}]),/locked/);
  assert.throws(()=>applyOperations(d,[{op:'delete',id:s.id}]),/locked/);
  assert.throws(()=>applyOperations(d,[{op:'update',id:s.id,changes:{locked:false,x:100}}]),/locked/);
  const result=applyOperations(d,[{op:'update',id:s.id,changes:{locked:false}},{op:'update',id:s.id,changes:{x:100}}]);
  assert.equal(result.shapes[0].x,100);
});

test('duplicate gets a new ID, preserves geometry and uses explicit displacement',()=>{
  const s=createShape('ellipse',{x:5,y:8});const copy=duplicateShape(s);
  assert.notEqual(copy.id,s.id);assert.equal(copy.x,15);assert.equal(copy.y,18);
  const d=applyOperations(withShapes(s),[{op:'duplicate',id:s.id,dx:-5,dy:20}]);
  assert.equal(d.shapes[1].x,0);assert.equal(d.shapes[1].y,28);
});

test('non-finite values and invalid sheet settings are rejected without coercion',()=>{
  assert.throws(()=>createShape('rect',{width:NaN}),/not finite/);
  assert.throws(()=>createShape('rect',{width:'80'}),/finite number/);
  assert.throws(()=>createShape('rect',{params:{nested:{unsafe:Infinity}}}),/not finite/);
  assert.throws(()=>applyOperations(newDocument(),[{op:'sheet',changes:{thickness:0}}]),/thickness/);
  assert.throws(()=>applyOperations(newDocument(),[{op:'sheet',changes:{url:'oops'}}]),/Unsupported/);
});

test('path dimensions scale its points while explicit point edits remain authoritative',()=>{
  const s=createShape('path',{width:40,height:20,points:[[0,0],[40,0],[40,20]],closed:true});
  const result=applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{width:80,height:40}}]);
  assert.deepEqual(result.shapes[0].points,[[0,0],[80,0],[80,40]]);
  const explicit=applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{width:80,points:[[0,0],[70,0],[70,20]]}}]);
  assert.deepEqual(explicit.shapes[0].points,[[0,0],[70,0],[70,20]]);
});

test('line resize preserves negative slope and endpoint ordering',()=>{
  const s=createShape('line',{x:10,y:20,width:50,height:30,points:[[0,30],[50,0]]});
  const resized=applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{width:100,height:60}}]).shapes[0];
  assert.deepEqual(resized.points,[[0,60],[100,0]]);
  const widthOnly=applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{width:75}}]).shapes[0];
  assert.deepEqual(widthOnly.points,[[0,30],[75,0]]);
});

test('line resize can extend a zero axis without flipping its other axis',()=>{
  const vertical=createShape('line',{width:0,height:30,points:[[0,30],[0,0]]});
  const diagonal=applyOperations(withShapes(vertical),[{op:'update',id:vertical.id,changes:{width:20}}]).shapes[0];
  assert.deepEqual(diagonal.points,[[0,30],[20,0]]);
  const horizontal=createShape('line',{width:50,height:0,points:[[50,0],[0,0]]});
  const other=applyOperations(withShapes(horizontal),[{op:'update',id:horizontal.id,changes:{height:20}}]).shapes[0];
  assert.deepEqual(other.points,[[50,0],[0,20]]);
});

test('normalizing edited rotated path bounds preserves every world point and changes measured dimensions',()=>{
  const s=createShape('path',{x:60,y:40,width:40,height:20,rotation:37,points:[[0,0],[40,0],[40,20],[0,20]],closed:true});
  s.points[0]=[-15,-8];s.points[2]=[65,45];
  const before=getShapePoints(s),normalized=normalizePathBounds(s),after=getShapePoints(normalized);
  assert.equal(normalized.width,80);assert.equal(normalized.height,53);assert.equal(normalized.rotation,37);
  for(let i=0;i<before[0].length;i++){near(after[0][i][0],before[0][i][0]);near(after[0][i][1],before[0][i][1]);}
  assert.deepEqual(normalized.points[0],[0,0]);assert.deepEqual(s.points[0],[-15,-8]);
  const again=normalizePathBounds(normalized);near(again.x,normalized.x);near(again.y,normalized.y);
});

test('normalization uses all compound contours and keeps a rotated zero-axis line in place',()=>{
  const s=createShape('path',{x:20,y:30,width:40,height:20,rotation:90,points:[[0,0],[10,0],[10,10]],contours:[[[0,0],[10,0],[10,10]],[[-20,-10],[-10,-10],[-10,0]]],closed:true});
  const normalized=normalizePathBounds(s),before=getShapePoints(s),after=getShapePoints(normalized);
  assert.equal(normalized.width,30);assert.equal(normalized.height,20);assert.deepEqual(normalized.points,normalized.contours[0]);
  for(let i=0;i<before.length;i++)for(let j=0;j<before[i].length;j++){near(after[i][j][0],before[i][j][0]);near(after[i][j][1],before[i][j][1]);}
  const line=createShape('line',{x:20,y:30,width:50,height:0,rotation:60,points:[[-10,5],[80,5]]});
  const next=normalizePathBounds(line);assert.equal(next.width,90);assert.equal(next.height,0);
  getShapePoints(line)[0].forEach((p,i)=>{near(getShapePoints(next)[0][i][0],p[0]);near(getShapePoints(next)[0][i][1],p[1]);});
});

test('flat path normalization retains valid minimum box dimensions without moving its points',()=>{
  const s=createShape('path',{width:30,height:10,rotation:20,points:[[0,5],[30,5]],closed:false});
  const result=normalizePathBounds(s);assert.equal(result.height,0.01);
  getShapePoints(s)[0].forEach((p,i)=>{near(getShapePoints(result)[0][i][0],p[0]);near(getShapePoints(result)[0][i][1],p[1]);});
});

test('rotation is around the local box centre and world point coordinates agree',()=>{
  const s=createShape('rect',{x:10,y:20,width:80,height:40,rotation:90});const b=shapeBounds(s);
  near(b.x,30);near(b.y,0);near(b.width,40);near(b.height,80);
  const p=getShapePoints(s)[0][0];near(p[0],70);near(p[1],0);
  assert.equal(shapeTransform(s),'translate(10 20) rotate(90 40 20)');
});

test('rotated ellipse reports exact analytical bounds',()=>{
  const s=createShape('ellipse',{x:0,y:0,width:80,height:40,rotation:45}),b=shapeBounds(s);
  near(b.width,Math.sqrt(4000));near(b.height,Math.sqrt(4000));near(b.x,40-Math.sqrt(1000));
});

test('smooth paths retain cubics and bound interpolation within anchor extents',()=>{
  const s=createShape('path',{x:0,y:0,width:100,height:50,points:[[0,0],[30,50],[100,0]],smooth:true,closed:false});
  assert.match(shapePath(s),/C /);assert.ok(getShapePoints(s)[0].length>10);
  const collinear=createShape('path',{x:0,y:0,width:100,height:1,points:[[0,0],[100,0],[90,0]],smooth:true,closed:false});
  near(Math.max(...getShapePoints(collinear)[0].map(p=>p[0])),100);
  near(Math.min(...getShapePoints(collinear)[0].map(p=>p[0])),0);
});

test('a normalized smooth 100 mm silhouette exports exact dimensions without overshoot',()=>{
  const s=createShape('path',{x:15,y:20,width:100,height:70,points:[[50,35],[20,0],[0,12],[20,40],[5,65],[35,70],[50,45],[65,70],[95,65],[80,40],[100,12],[80,0]],closed:true,smooth:true});
  const normalized=normalizePathBounds(s),b=shapeBounds(normalized);
  near(b.x,15);near(b.y,20);near(b.width,100);near(b.height,70);
  const exported=parseDXF(exportDXF(withShapes(normalized))).entities[0].vertices;
  near(Math.max(...exported.map(p=>p[0]))-Math.min(...exported.map(p=>p[0])),100);
  near(Math.max(...exported.map(p=>p[1]))-Math.min(...exported.map(p=>p[1])),70);
});

test('bounded cubic controls share tangents at anchors and stay inside every segment box',()=>{
  const points=[[0,20],[20,0],[60,10],[100,50],[80,70],[20,60]];
  const s=createShape('path',{width:100,height:70,points,closed:true,smooth:true});
  const commands=[...shapePath(s).matchAll(/C ([\d.\- ]+)/g)].map(m=>m[1].trim().split(/\s+/).map(Number));
  assert.equal(commands.length,points.length);
  for(let i=0;i<points.length;i++){
    const j=(i+1)%points.length,previous=commands[(i-1+points.length)%points.length],current=commands[i];
    for(let axis=0;axis<2;axis++){
      near(current[axis]-points[i][axis],points[i][axis]-previous[axis+2],0.000002);
      const min=Math.min(points[i][axis],points[j][axis]),max=Math.max(points[i][axis],points[j][axis]);
      assert.ok(current[axis]>=min-1e-6&&current[axis]<=max+1e-6);
      assert.ok(current[axis+2]>=min-1e-6&&current[axis+2]<=max+1e-6);
    }
  }
});

test('involute gear has expected addendum diameter, root diameter, bore and repeated tooth tips',()=>{
  const s=createShape('gear',{x:0,y:0,params:{teeth:24,module:2,pressureAngle:20,bore:6}});
  assert.equal(s.width,52);assert.equal(s.height,52);
  const [outer,bore]=getShapePoints(s),radii=outer.map(([x,y])=>Math.hypot(x-26,y-26));
  near(Math.max(...radii),26);near(Math.min(...radii),21.5);
  near(polygonArea(bore),Math.PI*9,0.3);
  assert.ok(radii.filter(r=>Math.abs(r-26)<EPSILON).length>=48);
  assert.equal(preflight(withShapes(s)).some(i=>i.code==='self-intersection'),false);
});
const EPSILON=1e-6;

test('gear resizing is uniform and maintains involute module and scaled bore',()=>{
  const s=createShape('gear',{params:{teeth:20,module:2,bore:5}});
  const result=applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{width:88}}]).shapes[0];
  assert.equal(result.width,88);assert.equal(result.height,88);assert.equal(result.params.module,4);assert.equal(result.params.bore,10);
  assert.throws(()=>applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{width:88,height:44}}]),/uniform/);
  const toothEdit=applyOperations(withShapes(s),[{op:'update',id:s.id,changes:{params:{teeth:30}}}]).shapes[0];
  assert.equal(toothEdit.width,64);
  assert.throws(()=>createShape('gear',{width:50}),/must equal/);
});

test('gear prototype and undercut limitations are explicit',()=>{
  const d=withShapes(createShape('gear',{params:{teeth:8,module:2,bore:2}}));
  assert.ok(preflight(d).some(i=>i.code==='gear-undercut'));
  assert.ok(preflight(d).some(i=>i.code==='gear-fit'));
});

test('stroke text exports real vectors, supports lowercase, and rejects unsupported characters',()=>{
  const s=createShape('text',{text:'Fab 2026!'});
  assert.equal(s.role,'engrave');assert.ok(getShapePoints(s).length>8);
  const svg=exportSVG(withShapes(s));assert.match(svg,/<path /);assert.doesNotMatch(svg,/<text[ >]/);
  assert.throws(()=>createShape('text',{text:'你好'}),/does not support/);
  const x=createShape('text',{text:'X'});assert.equal(preflight(withShapes(x)).some(i=>i.severity==='error'),false);
});

test('SVG declares physical mm dimensions, preserves holes and separates operation layers',()=>{
  const plate=createShape('plate',{name:'<Plate & holes>'}),reference=createShape('rect',{role:'reference'});
  const d=withShapes(plate,createShape('line',{role:'score'}),createShape('text'),reference);
  const svg=exportSVG(d);assert.match(svg,/width="300mm" height="200mm"/);assert.match(svg,/viewBox="0 0 300 200"/);
  assert.match(svg,/id="cut"/);assert.match(svg,/id="score"/);assert.match(svg,/id="engrave"/);assert.doesNotMatch(svg,/id="reference"/);
  assert.match(svg,/fill-rule="evenodd"/);assert.match(svg,/&lt;Plate &amp; holes&gt;/);
  assert.equal((shapePath(plate).match(/ Z/g)||[]).length,3);
  assert.match(exportSVG(d,{includeReference:true}),/id="reference"/);
});

function parseDXF(text) {
  const rows=text.trim().split(/\r?\n/),pairs=[];
  for(let i=0;i<rows.length;i+=2)pairs.push([Number(rows[i]),rows[i+1]]);
  const entities=[];let entity=null;
  for(const [code,value]of pairs) {
    if(code===0){if(entity)entities.push(entity);entity=value==='LWPOLYLINE'?{vertices:[],closed:false,layer:null}:null;}
    if(!entity)continue;
    if(code===8)entity.layer=value;
    if(code===70)entity.closed=value==='1';
    if(code===10)entity.vertices.push([Number(value)]);
    if(code===20)entity.vertices.at(-1).push(Number(value));
  }
  return {pairs,entities};
}

test('DXF units are millimetres and dimensions, holes, closure, roles and handedness survive export',()=>{
  const rect=createShape('rect',{x:10,y:20,width:80,height:40}),plate=createShape('plate',{x:100,y:30}),line=createShape('line',{role:'score',x:10,y:10,width:20,height:5});
  const {pairs,entities}=parseDXF(exportDXF(withShapes(rect,plate,line)));
  const unit=pairs.findIndex(([code,value])=>code===9&&value==='$INSUNITS');assert.deepEqual(pairs[unit+1],[70,'4']);
  assert.equal(entities.length,5);assert.deepEqual(entities[0].vertices,[[10,180],[90,180],[90,140],[10,140]]);
  assert.equal(entities[0].closed,true);assert.equal(entities[4].closed,false);assert.equal(entities[4].layer,'SCORE');
  assert.equal(entities.slice(1,4).every(e=>e.closed&&e.layer==='CUT'),true);
});

test('union, difference and intersection produce correct dimensional areas',()=>{
  const a=createShape('rect',{x:0,y:0,width:20,height:10}),b=createShape('rect',{x:10,y:0,width:20,height:10});
  const union=booleanShapes([a,b],'union'),intersection=booleanShapes([a,b],'intersection'),difference=booleanShapes([a,b],'difference');
  near(union.width,30);near(polygonArea(getShapePoints(union)[0]),300);near(polygonArea(getShapePoints(intersection)[0]),100);near(polygonArea(getShapePoints(difference)[0]),100);
  assert.equal(union.params.flattenTolerance,0.05);
});

test('boolean subtraction preserves interior holes and compound evenodd geometry',()=>{
  const plate=createShape('rect',{x:0,y:0,width:40,height:30}),hole=createShape('ellipse',{x:15,y:10,width:10,height:10});
  const result=booleanShapes([plate,hole],'subtract');assert.equal(result.contours.length,2);
  assert.equal(getShapePoints(result).length,2);
  assert.equal((shapePath(result).match(/ Z/g)||[]).length,2);
  const extra=createShape('rect',{x:35,y:0,width:10,height:30});
  const joined=booleanShapes([result,extra],'union');assert.equal(joined.contours.length,2);
});

test('boolean operations reject open, locked, mixed-role and empty results',()=>{
  const a=createShape('rect'),far=createShape('rect',{x:150}),locked=createShape('rect',{locked:true});
  assert.throws(()=>booleanShapes([a,createShape('line')],'union'),/closed/);
  assert.throws(()=>booleanShapes([a,locked],'union'),/Unlock/);
  assert.throws(()=>booleanShapes([a,createShape('rect',{role:'score'})],'union'),/same/);
  assert.throws(()=>booleanShapes([a,far],'intersection'),/no geometry/);
});

test('preflight detects empty/invalid documents, crossing paths, tiny contours, duplicates and estimates',()=>{
  assert.equal(preflight(newDocument())[0].code,'empty');
  assert.equal(preflight({...newDocument(),units:'in'})[0].code,'invalid-document');
  const bow=createShape('path',{points:[[0,0],[40,40],[0,40],[40,0]],closed:true});
  assert.ok(preflight(withShapes(bow)).some(i=>i.code==='self-intersection'));
  const small=createShape('rect',{width:.2,height:.2,provenance:'estimated'}),copy={...structuredClone(small),id:'different'};
  const codes=preflight(withShapes(small,copy)).map(i=>i.code);
  assert.ok(codes.includes('tiny-contour'));assert.ok(codes.includes('duplicate-lines'));assert.ok(codes.includes('estimated'));
});

test('open cut lines remain intentional exportable paths with explicit warnings',()=>{
  const line=createShape('line',{x:10,y:10,width:0,height:30});
  assert.ok(preflight(withShapes(line)).some(i=>i.code==='open-cut'));
  assert.match(exportSVG(withShapes(line)),/M 0 0 L 0 30/);
});

test('self-touching and zero-area closed cuts are identified as invalid geometry',()=>{
  const touching=createShape('path',{points:[[0,0],[30,0],[30,30],[15,0],[0,30]],closed:true});
  assert.ok(preflight(withShapes(touching)).some(i=>i.code==='self-intersection'));
  const collapsed=createShape('path',{points:[[0,0],[10,0],[20,0]],closed:true});
  assert.ok(preflight(withShapes(collapsed)).some(i=>i.code==='degenerate-contour'&&i.severity==='error'));
});

test('document bounds omit reference geometry by default',()=>{
  const d=withShapes(createShape('rect',{x:10,y:20,width:30,height:40}),createShape('rect',{role:'reference',x:500,y:500}));
  assert.deepEqual(documentBounds(d),{x:10,y:20,width:30,height:40});assert.ok(documentBounds(d,true).width>500);assert.equal(documentBounds(newDocument()),null);
});

test('large regular paths can be preflighted without quadratic scanning',()=>{
  const points=Array.from({length:12000},(_,i)=>[100+80*Math.cos(i/12000*Math.PI*2),100+80*Math.sin(i/12000*Math.PI*2)]);
  const s=createShape('path',{x:0,y:0,width:200,height:200,points,closed:true});
  const start=performance.now(),issues=preflight(withShapes(s));
  assert.equal(issues.some(i=>i.severity==='error'),false);assert.ok(performance.now()-start<5000);
});
