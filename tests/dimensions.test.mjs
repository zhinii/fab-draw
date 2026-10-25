import test from 'node:test';
import assert from 'node:assert/strict';
import {newDocument,createShape,applyOperations,validateDocument} from '../src/geometry.mjs';
import {drawingDimensions,editDimension} from '../src/dimensions.mjs';
import {exportSVG,exportDXF} from '../src/drawing-export.mjs';
import {askAssistant} from '../src/assistant.mjs';

const plate=()=>createShape('plate',{id:'plate-1',name:'Test plate',width:80,height:40,params:{holeDiameter:5,edgeInset:15,cornerRadius:0}});
const drawing=()=>({...newDocument(),shapes:[plate()]});
test('plate dimensions stay associated through resize, save/reload and movement',()=>{
  const original=drawing(),changed=editDimension(original,'plate-1:width',100);
  assert.equal(original.shapes[0].width,80);
  assert.equal(changed.shapes[0].width,100);
  assert.deepEqual(changed.shapes[0].params,{holeDiameter:5,edgeInset:15,cornerRadius:0});
  const restored=validateDocument(JSON.parse(JSON.stringify(changed))),dims=drawingDimensions(restored);
  const values=Object.fromEntries(dims.map(d=>[d.id.split(':')[1],d.value]));
  assert.equal(values.width,100);assert.equal(values.height,40);assert.equal(values.holes,5);
  assert.equal(values['left-inset'],15);assert.equal(values['right-inset'],15);assert.equal(values['centre-height'],20);
  assert.ok(dims.some(d=>d.id==='plate-1:centre-85'));
  const moved=applyOperations(restored,[{op:'update',id:'plate-1',changes:{x:70,y:50}}]);
  assert.deepEqual(drawingDimensions(moved)[0].at.map((n,i)=>n-dims[0].at[i]),[50,30]);
});
test('dimension edits use validation and preserve circular holes',()=>{
  const doc=drawing();assert.throws(()=>editDimension(doc,'plate-1:holes',40));
  assert.throws(()=>editDimension(doc,'plate-1:centre-height',10));
  const changed=editDimension(doc,'plate-1:left-inset',18);assert.equal(changed.shapes[0].params.edgeInset,18);
  const circle={...newDocument(),shapes:[createShape('ellipse',{id:'hole',width:5,height:5})]};
  const resized=editDimension(circle,'hole:diameter',8);assert.equal(resized.shapes[0].width,8);assert.equal(resized.shapes[0].height,8);
});
test('laser exports omit annotations, drawing exports contain separate vector layers',()=>{
  const doc=drawing();
  for(const exportFile of [exportSVG,exportDXF])assert.doesNotMatch(exportFile(doc),/DIMENSIONS/);
  const svg=exportSVG(doc,{includeDimensions:true});assert.match(svg,/id="GEOMETRY"/);assert.match(svg,/id="DIMENSIONS"/);assert.match(svg,/<text[^>]*>2 × Ø5<\/text>/);assert.doesNotMatch(svg,/<image/);
  const dxf=exportDXF(doc,{includeDimensions:true});assert.match(dxf,/8\r\nDIMENSIONS\r\n/);assert.match(dxf,/2 x %%c5/);assert.match(dxf,/\$INSUNITS\r\n70\r\n4/);
  const resized=exportSVG(editDimension(doc,'plate-1:width',100),{includeDimensions:true});assert.match(resized,/>100<\/text>/);
});
test('focused photo reconstruction and chat edit take one relay request each with no visual loop',async()=>{
  const original=newDocument();let calls=0;
  const fetcher=async(_url,opts)=>{calls++;const body=JSON.parse(opts.body);assert.match(body.question,/Dimensioned drawing prototype/);return new Response(JSON.stringify({reply:'Plate ready.',needsInput:false,operations:[{op:'add',shape:plate()}]}),{status:200});};
  const result=await askAssistant({workflow:'dimensioned',question:'Confirm and reconstruct.',document:original,image:{data:'data:image/jpeg;base64,AAAA',width:900,height:600,confirmed:true}},{fetcher,renderer:()=>{throw Error('Unexpected paid review');}});
  assert.equal(calls,1);assert.equal(result.requestCount,1);
  const doc=applyOperations(original,result.operations);
  const edited=await askAssistant({workflow:'dimensioned',question:'Make it 100 mm wide.',document:doc},{fetcher:async()=>{calls++;return new Response(JSON.stringify({reply:'Width changed.',needsInput:false,operations:[{op:'update',id:'plate-1',changes:{width:100}}]}),{status:200});}});
  assert.equal(calls,2);assert.equal(applyOperations(doc,edited.operations).shapes[0].params.edgeInset,15);
});
test('invalid focused proposals stop without a repair request',async()=>{
  let calls=0;await assert.rejects(askAssistant({workflow:'dimensioned',question:'Reconstruct this plate.',document:newDocument()},{fetcher:async()=>{calls++;return new Response(JSON.stringify({reply:'Draft',needsInput:false,operations:[{op:'add',shape:{...plate(),width:10}}]}),{status:200});}}));
  assert.equal(calls,1);
});
