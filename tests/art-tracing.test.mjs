import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {tracePixels} from '../src/trace-core.mjs';
import {traceShapes} from '../src/art-tracing.mjs';
import {newDocument,applyOperations,documentBounds,exportSVG,exportDXF,preflight,getShapePoints} from '../src/geometry.mjs';
import {askAssistant} from '../src/assistant.mjs';
const raster=(paint,w=80,h=60)=>{const data=new Uint8ClampedArray(w*h*4).fill(255);for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(paint(x,y)){const i=(y*w+x)*4;data[i]=data[i+1]=data[i+2]=0;}return {data,width:w,height:h};};
const stroke=raster((x,y)=>x>=10&&x<=65&&y>=25&&y<=31);
test('thick straight ink becomes one centre path, not two outline edges',()=>{
 const trace=tracePixels(stroke);assert.equal(trace.paths.length,1);assert.equal(trace.paths[0].closed,false);assert.ok(trace.paths[0].points.every(p=>Math.abs(p[1]-28)<2));
 const outline=tracePixels(stroke,{mode:'outline'});assert.equal(outline.paths.length,1);assert.equal(outline.paths[0].closed,true);assert.ok(Math.max(...outline.paths[0].points.map(p=>p[1]))-Math.min(...outline.paths[0].points.map(p=>p[1]))>=6);
});
test('outline tracing preserves inner holes and separates touching pixel corners',()=>{
 const ring=raster((x,y)=>x>=10&&x<=60&&y>=10&&y<=50&&!(x>17&&x<53&&y>17&&y<43));
 const outline=tracePixels(ring,{mode:'outline'});assert.equal(outline.paths.length,2);assert.ok(outline.paths.every(p=>p.closed));
 const shapes=traceShapes(outline).shapes,doc={...newDocument(),shapes};assert.equal(preflight(doc).filter(e=>e.severity==='error').length,0);assert.match(exportSVG(doc),/ Z/);assert.match(exportDXF(doc),/LWPOLYLINE/);
 const corners=raster((x,y)=>x>=10&&x<16&&y>=10&&y<16||x>=16&&x<22&&y>=16&&y<22);assert.equal(tracePixels(corners,{mode:'outline'}).paths.length,2);
});
test('a closed stroke remains a closed centreline and disconnected strokes stay separate',()=>{
 const ring=raster((x,y)=>Math.abs(Math.hypot(x-40,y-30)-18)<3);const trace=tracePixels(ring);assert.equal(trace.paths.length,1);assert.equal(trace.paths[0].closed,true);
 const two=raster((x,y)=>x>10&&x<65&&(y>=10&&y<=16||y>=40&&y<=46));assert.equal(tracePixels(two).paths.length,2);
});
test('empty, oversized and heavily filled inputs fail clearly instead of producing a fake trace',()=>{
 assert.throws(()=>tracePixels(raster(()=>false)),/No dark lines/);assert.throws(()=>tracePixels(raster(()=>true)),/Too much/);assert.throws(()=>tracePixels({data:[],width:5000,height:1}),/1024/);
});
test('traced paths resize and rotate as a group through chat without provider calls',async()=>{
 const input=raster((x,y)=>x>=10&&x<=65&&(y>=10&&y<=16||y>=40&&y<=46)),shapes=traceShapes(tracePixels(input),{width:100}).shapes;
 let doc={...newDocument(),shapes};const ids=shapes.map(s=>s.id),fetcher=()=>{throw Error('Unexpected paid call');};
 const edit=async question=>{const result=await askAssistant({question,document:doc,selectedIds:ids,workflow:'art'}, {fetcher});assert.equal(result.requestCount,0);doc=applyOperations(doc,result.operations);return result;};
 const before=documentBounds(doc,true);assert.ok(Math.abs(before.width-100)<1e-6);
 await edit('make it 120 mm wide');assert.ok(Math.abs(documentBounds(doc,true).width-120)<1e-6);
 const centre=documentBounds(doc,true);await edit('rotate 90 degrees');const rotated=documentBounds(doc,true);assert.ok(Math.abs(rotated.height-120)<1e-6);assert.ok(Math.abs(rotated.x+rotated.width/2-centre.x-centre.width/2)<1e-6);
 const y=doc.shapes[0].y;await edit('move down 10 mm');assert.equal(doc.shapes[0].y,y+10);
 await edit('smooth this');assert.ok(doc.shapes.every(s=>s.smooth));assert.ok(getShapePoints(doc.shapes[0])[0].length>=2);
 assert.match(exportSVG(doc),/id="score"/);assert.match(exportDXF(doc),/SCORE/);
});
test('chat edits leave locked artwork unchanged',async()=>{
 const shapes=traceShapes(tracePixels(stroke)).shapes;shapes[0].locked=true;
 const result=await askAssistant({question:'rotate 30 degrees',document:{...newDocument(),shapes},selectedIds:shapes.map(s=>s.id)},{fetcher:()=>{throw Error('No provider');}});assert.equal(result.needsInput,true);assert.deepEqual(result.operations,[]);
});
test('the original Kimi artwork produces editable single lines and closed outlines',()=>{
 const data=gunzipSync(readFileSync(new URL('./fixtures/kimi-art-1000x700.rgba.gz',import.meta.url)));
 for(const mode of ['single','outline']){
  const trace=tracePixels({data,width:1000,height:700},{mode});assert.equal(trace.paths.length,mode==='single'?4:5);assert.equal(trace.paths.filter(p=>p.closed).length,mode==='single'?1:5);
  const shapes=traceShapes(trace).shapes,doc={...newDocument(),shapes};assert.ok(shapes.every(s=>s.type==='path'&&s.points.length<100));assert.deepEqual(preflight(doc).filter(i=>i.severity==='error'),[]);
  assert.match(exportSVG(doc),/<path/);assert.match(exportDXF(doc),/LWPOLYLINE/);
 }
});
test('crossing strokes share a junction without duplicate centreline segments',()=>{
 const cross=raster((x,y)=>x>10&&x<70&&y>=27&&y<=33||y>5&&y<55&&x>=37&&x<=43);
 const paths=tracePixels(cross).paths;assert.equal(paths.length,4);
 const ends=paths.flatMap(p=>[p.points[0],p.points.at(-1)]).map(p=>p.join(','));assert.equal(Math.max(...ends.map(p=>ends.filter(q=>q===p).length)),4);
});
