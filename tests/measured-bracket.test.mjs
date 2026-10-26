import test from 'node:test';
import assert from 'node:assert/strict';
import {BRACKET_EXAMPLE,bracketIssues,bracketGeometry,measuredBracketShape,readBracketPacket,retainedBracket,resolveBracket} from '../src/measured-bracket.mjs';
import {createShape,newDocument,applyOperations,preflight,shapePath,exportDXF} from '../src/geometry.mjs';
import {drawingDimensions} from '../src/dimensions.mjs';
import {askAssistant} from '../src/assistant.mjs';
const image={data:'data:image/png;base64,AAAA',width:512,height:631,confirmed:false};
test('conflicting printed chains block construction until an explicit resolution',()=>{
 const p={...BRACKET_EXAMPLE,basis:'unresolved'};
 assert.equal(bracketIssues(p).length,2);assert.throws(()=>bracketGeometry(p),/35.*40/);
 assert.ok(bracketIssues({...p,basis:'upper'}).some(s=>s.includes('width 115')));
 assert.deepEqual(bracketIssues(BRACKET_EXAMPLE),[]);
});
test('chosen bracket has all five holes, exact radii, reference extents and tangent diagonal',()=>{
 const g=bracketGeometry(BRACKET_EXAMPLE);assert.deepEqual([g.width,g.height],[110,240]);
 assert.deepEqual(g.holes.map(h=>[h.x,h.y,h.d]),[[20,15,15],[95,15,15],[20,105,15],[95,165,15],[60,90,30]]);
 assert.deepEqual(g.radii.map(r=>r.r),[15,15,15,20]);assert.equal(g.contours.length,6);
 const b=g.radii[2],l=g.radii[3];assert.ok(Math.abs((b.y-b.x+15*Math.SQRT2)-(l.y-l.x+20*Math.SQRT2))<1e-9);
 const shape=createShape('path',measuredBracketShape(BRACKET_EXAMPLE));const doc={...newDocument(),sheet:{...newDocument().sheet,height:300},shapes:[shape]};
 assert.deepEqual(preflight(doc),[]);assert.match(shapePath(shape),/A 20 20/);assert.equal((shapePath(shape).match(/ Z/g)||[]).length,6);
 assert.equal((exportDXF(doc).match(/LWPOLYLINE/g)||[]).length,6);
 assert.ok(drawingDimensions(doc).some(d=>d.label==='4 × Ø15'));assert.ok(drawingDimensions(doc).some(d=>d.label==='Ø30'));
});
test('whole-circle containment rejects holes outside the actual diagonal, not just the bounding box',()=>{
 assert.throws(()=>bracketGeometry({...BRACKET_EXAMPLE,leftVerticalSpacing:180}),/BL hole intersects/);
 assert.throws(()=>bracketGeometry({...BRACKET_EXAMPLE,smallDiameter:35}),/hole intersects/);
});
test('saved geometry retains arcs after moving but never reverts a manual node edit',()=>{
 const shape=createShape('path',measuredBracketShape(BRACKET_EXAMPLE)),doc={...newDocument(),shapes:[shape]};
 const moved=applyOperations(doc,[{op:'update',id:shape.id,changes:{x:60,rotation:90}}]).shapes[0];assert.ok(retainedBracket(moved));
 const edited=structuredClone(moved);edited.contours[0][0][0]+=1;assert.equal(retainedBracket(edited),null);assert.doesNotMatch(shapePath(edited),/A 20 20/);
 assert.ok(retainedBracket(JSON.parse(JSON.stringify(shape))));
});
test('one vision read, then conflict resolution and confirmed reconstruction use no paid requests',async()=>{
 let calls=0;const packet={...BRACKET_EXAMPLE};delete packet.basis;
 const fetcher=async()=>{calls++;return new Response(JSON.stringify({reply:`<bracket>${JSON.stringify(packet)}</bracket>`,needsInput:true,operations:[]}),{status:200});};
 const args={workflow:'dimensioned',question:'Read this drawing.',document:newDocument(),image};
 const read=await askAssistant(args,{fetcher});assert.equal(read.canConfirm,false);assert.equal(read.operations.length,0);
 const resolved=await askAssistant({...args,measurementPlan:read.measurementPlan,question:'Use the lower 40 and 75 mm dimensions.'},{fetcher});assert.equal(resolved.canConfirm,true);assert.equal(resolved.operations.length,0);
 const built=await askAssistant({...args,measurementPlan:resolved.measurementPlan,image:{...image,confirmed:true},question:'Confirm and build.'},{fetcher});
 const doc=applyOperations(args.document,built.operations);assert.equal(calls,1);assert.equal(doc.shapes.length,1);assert.equal(doc.shapes[0].contours.length,6);assert.deepEqual(preflight(doc),[]);
  const edit=await askAssistant({...args,document:doc,measurementPlan:{...resolved.measurementPlan,smallDiameter:12},measurementTargetId:doc.shapes[0].id,image:{...image,confirmed:true},question:'Confirm the updated measurements.'},{fetcher});
  const updated=applyOperations(doc,edit.operations);assert.equal(updated.shapes.length,1);assert.equal(updated.shapes[0].id,doc.shapes[0].id);assert.equal(updated.shapes[0].params.measuredBracket.smallDiameter,12);assert.equal(calls,1);
});
test('missing or unreadable dimensions remain questions and model cannot choose a conflict winner',()=>{
 const p=readBracketPacket(`<bracket>${JSON.stringify({...BRACKET_EXAMPLE,leftInset:null,basis:'lower'})}</bracket>`);
 assert.equal(p.basis,'unresolved');assert.ok(bracketIssues(p).some(s=>s.includes('leftInset')));
});
test('explicit user corrections fill missing lower readings; incomplete live-style readings cannot build',()=>{
 const incomplete={...BRACKET_EXAMPLE,basis:'unresolved',lowerLeftToCentre:null,lowerColumnSpacing:null,lowerRightToArcCentre:null,centreToLowerRight:60,lowerOffsetToArcCentre:null};
 const fixed=resolveBracket(incomplete,'Use the lower 40 and 75 mm dimensions.');assert.equal(fixed.lowerLeftToCentre,40);assert.equal(fixed.lowerColumnSpacing,75);assert.throws(()=>bracketGeometry(fixed));
 assert.ok(bracketIssues({...fixed,lowerRightToArcCentre:60,lowerOffsetToArcCentre:true}).some(s=>s.includes('height 225')));
});
test('unstructured bracket response blocks confirmation rather than drawing guessed geometry',async()=>{
 const result=await askAssistant({workflow:'dimensioned',question:'Read bracket',document:newDocument(),image},{fetcher:async()=>new Response(JSON.stringify({reply:'I read the rounded bracket.',needsInput:true,operations:[]}),{status:200})});
 assert.equal(result.canConfirm,false);assert.equal(result.measurementPlan.leftInset,null);assert.equal(result.operations.length,0);
});
