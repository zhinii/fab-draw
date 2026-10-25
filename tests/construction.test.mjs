import test from 'node:test';
import assert from 'node:assert/strict';
import {expandConstructiveReply} from '../src/construction.mjs';
import {applyOperations,createShape,getShapePoints,newDocument,preflight,shapeBounds} from '../src/geometry.mjs';

const part=(type,x,y,width,height,extra={})=>({name:type,type,x,y,width,height,operation:'union',...extra});
const operation=(parts,extra={})=>({op:'construct',shape:{name:'Constructed profile',x:20,y:30,width:120,height:60,rotation:0,role:'cut'},parts,...extra});
const reply=op=>({reply:'Preview',operations:[op],assumptions:['Estimated outline'],needsInput:false});
const expand=(op,doc=newDocument())=>{const result=expandConstructiveReply(reply(op),doc);return {result,document:applyOperations(doc,result.operations),shape:applyOperations(doc,result.operations).shapes.at(-1)};};
const near=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} should be ${expected}`);

test('overlapping primitives become one exact-size closed editable profile',()=>{
  const {shape,result,document}=expand(operation([part('ellipse',10,20,60,40),part('rect',50,25,40,30)]));
  assert.equal(result.constructionIssues.length,0);assert.equal(shape.type,'path');assert.equal(shape.provenance,'estimated');
  assert.equal(shape.closed,true);assert.equal(shape.smooth,false);assert.equal(shape.contours.length,1);
  assert.deepEqual(shapeBounds(shape),{x:20,y:30,width:120,height:60});
  assert.equal(preflight(document).filter(i=>i.severity==='error').length,0);
  assert.equal(result.operations[0].shape.id,shape.id);
});

test('subtraction preserves an enclosed hole while normalizing final bounds',()=>{
  const {shape,result,document}=expand(operation([part('rect',0,0,100,100),part('ellipse',30,30,40,40,{operation:'subtract'})]));
  assert.equal(result.constructionIssues.length,0);assert.equal(shape.contours.length,2);
  const rings=getShapePoints(shape),hole=rings[1];
  near(Math.min(...hole.map(p=>p[0])),56);near(Math.max(...hole.map(p=>p[0])),104);
  near(Math.min(...hole.map(p=>p[1])),48);near(Math.max(...hole.map(p=>p[1])),72);
  assert.equal(preflight(document).filter(i=>i.severity==='error').length,0);
});

test('all unions happen before subtraction regardless of part placement in the list',()=>{
  const cut=part('rect',40,40,20,20,{operation:'subtract'}),base=part('rect',0,0,100,100),overlay=part('rect',30,30,40,40);
  const a=expand(operation([base,cut,overlay])).shape,b=expand(operation([base,overlay,cut])).shape;
  assert.deepEqual(a.contours,b.contours);assert.equal(a.contours.length,2);
});

test('floating and merely corner-touching pieces stay renderable with a blocking issue',()=>{
  for(const second of [part('rect',60,0,30,30),part('rect',30,30,30,30)]) {
    const {shape,result}=expand(operation([part('rect',0,0,30,30),second]));
    assert.equal(shape.contours.length,2);assert.equal(result.constructionIssues.length,1);
    assert.equal(result.constructionIssues[0].shapeId,shape.id);assert.equal(result.constructionIssues[0].severity,'error');
    assert.equal(result.constructionIssues[0].code,'construction-disconnected');assert.match(result.constructionIssues[0].message,/2 disconnected/);
    assert.deepEqual(shapeBounds(shape),{x:20,y:30,width:120,height:60});
  }
});

test('a subtraction that splits the silhouette cannot be accepted as one profile',()=>{
  const {result,shape}=expand(operation([part('rect',0,0,100,100),part('rect',45,0,10,100,{operation:'subtract'})]));
  assert.equal(shape.contours.length,2);assert.equal(result.constructionIssues[0].code,'construction-disconnected');
});

test('short smooth and rotated parts preserve exact local bounds and final rotation',()=>{
  const op=operation([part('path',0,0,100,100,{closed:true,smooth:true,points:[[0,50],[50,0],[100,50],[50,100]],rotation:30})]);
  op.shape.rotation=37;
  const {shape,result}=expand(op);
  assert.equal(shape.rotation,37);assert.equal(result.constructionIssues.length,0);
  const bounds=shapeBounds({...shape,x:0,y:0,rotation:0});
  near(bounds.x,0);near(bounds.y,0);near(bounds.width,120);near(bounds.height,60);
});

test('large profiles are flattened in physical units and report the final effective tolerance',()=>{
  const op=operation([part('ellipse',0,0,100,100)]);op.shape.width=5000;op.shape.height=2500;
  const {shape}=expand(op);
  near(shape.width,5000);near(shape.height,2500);near(shape.params.flattenTolerance,.05);
  assert.ok(shape.points.length>500,'physical-size flattening needs enough samples');
  // Cutting away most of the width makes normalization magnify the approximation.
  const narrow=operation([part('ellipse',0,0,100,100),part('rect',0,0,90,100,{operation:'subtract'})]);
  const cropped=expand(narrow).shape;
  assert.ok(cropped.params.flattenTolerance>.4,'magnified flattening error is not silently advertised as .05 mm');
});

test('ellipse clipping removes numerical duplicate cardinal vertices without losing exact dimensions',()=>{
  const op=operation([part('ellipse',20,20,50,40)]);op.shape.width=1000;op.shape.height=700;
  const doc=newDocument();doc.sheet.width=1500;doc.sheet.height=1000;
  const {shape,document}=expand(op,doc);
  assert.ok(shape.points.length>240);assert.deepEqual(shapeBounds(shape),{x:20,y:30,width:1000,height:700});
  assert.equal(preflight(document).filter(i=>i.severity==='error').length,0);
  for(let i=0;i<shape.points.length;i++) {
    const a=shape.points[i],b=shape.points[(i+1)%shape.points.length];
    assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])>1e-8);
  }
  // The same cardinal artifact must be removed before a second clipping pass.
  op.parts.push(part('ellipse',35,30,10,10,{operation:'subtract'}));
  const holed=expand(op,doc);assert.equal(holed.shape.contours.length,2);
  assert.equal(preflight(holed.document).filter(i=>i.severity==='error').length,0);
});

test('replacing a constructed target replaces stale connectivity issues',()=>{
  const target=createShape('path',{id:'target'}),doc={...newDocument(),shapes:[target]};
  const disconnected=operation([part('rect',0,0,20,20),part('rect',60,0,20,20)],{targetId:target.id});
  const connected=operation([part('rect',0,0,100,100)],{targetId:target.id});
  const fixed=expandConstructiveReply({operations:[disconnected,connected]},doc);
  assert.equal(fixed.constructionIssues.length,0);assert.equal(applyOperations(doc,fixed.operations).shapes[0].contours.length,1);
  const broken=expandConstructiveReply({operations:[connected,disconnected,disconnected]},doc);
  assert.equal(broken.constructionIssues.length,1);assert.equal(broken.constructionIssues[0].shapeId,target.id);
  assert.equal(applyOperations(doc,broken.operations).shapes[0].contours.length,2);
});

test('target replacement preserves identity and grouping, respects locks, and changes no inputs',()=>{
  const target=createShape('path',{name:'Old',groupId:'assembly',groupName:'Assembly'}),doc={...newDocument(),shapes:[target]};
  const op=operation([part('rect',0,0,100,100)],{targetId:target.id}),input=reply(op),before=structuredClone({doc,input});
  const result=expandConstructiveReply(input,doc),changed=applyOperations(doc,result.operations);
  assert.equal(result.operations[0].op,'update');assert.equal(changed.shapes.length,1);assert.equal(changed.shapes[0].id,target.id);
  assert.equal(changed.shapes[0].groupId,'assembly');assert.equal(changed.shapes[0].width,120);
  assert.deepEqual({doc,input},before);
  assert.throws(()=>expandConstructiveReply(input,{...doc,shapes:[{...target,locked:true}]}),/unlocked_path/);
  assert.throws(()=>expandConstructiveReply(reply({...op,targetId:'missing'}),doc),/unlocked_path/);
  const rect=createShape('rect');assert.throws(()=>expandConstructiveReply(reply({...op,targetId:rect.id}),{...doc,shapes:[rect]}),/unlocked_path/);
});

test('failed batches, empty results and malformed parts never mutate the original document',()=>{
  const doc=newDocument(),op=operation([part('rect',0,0,100,100)]),input=reply(op),snapshot=structuredClone({doc,input});
  assert.throws(()=>expandConstructiveReply({...input,operations:[op,{op:'delete',id:'missing'}]},doc),/does not exist/);
  assert.deepEqual({doc,input},snapshot);
  assert.throws(()=>expand(operation([part('rect',0,0,100,100),part('rect',0,0,100,100,{operation:'subtract'})])),/no geometry/);
  assert.throws(()=>expand(operation([part('path',0,0,100,100,{points:[[0,0],[100,100],[0,100],[100,0]],closed:true})])),/self-intersecting/);
  assert.throws(()=>expand(operation(Array.from({length:21},()=>part('rect',0,0,10,10)))),/parts_limit/);
  assert.throws(()=>expand(operation([part('path',0,0,10,10,{points:Array.from({length:17},()=>[0,0]),closed:true})])),/short_closed_path/);
  assert.throws(()=>expand(operation([part('rect',0,0,10,10,{unexpected:true})])),/part_fields/);
});

test('ordinary operations remain supported in an atomic mixed reply',()=>{
  const doc=newDocument(),rect=createShape('rect',{id:'ordinary'});
  const input={reply:'Both',operations:[{op:'add',shape:rect},operation([part('ellipse',0,0,100,100)])]};
  const result=expandConstructiveReply(input,doc),changed=applyOperations(doc,result.operations);
  assert.equal(changed.shapes.length,2);assert.equal(changed.shapes[0].id,'ordinary');assert.equal(changed.shapes[1].type,'path');
  assert.equal(doc.shapes.length,0);assert.equal(input.operations[1].op,'construct');
});
