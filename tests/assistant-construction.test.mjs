import test from 'node:test';
import assert from 'node:assert/strict';
import {askAssistant} from '../src/assistant.mjs';
import {expandConstructiveReply} from '../src/construction.mjs';
import {newDocument,createShape,applyOperations,shapeBounds} from '../src/geometry.mjs';
import {validateConstructOperation} from '../server/construction-schema.mjs';
import {validateReply,validateTask,callQwen,DEFAULT_BASE} from '../server/cad-system.mjs';

const image={data:'data:image/png;base64,AAAA',width:1024,height:512};
const part=(extra={})=>({name:'volume',type:'ellipse',x:20,y:20,width:50,height:40,operation:'union',...extra});
const construct=(extra={})=>({op:'construct',shape:{name:'Custom form',x:20,y:20,width:100,height:70,role:'cut'},parts:[part()],...extra});
const reply=op=>({reply:'A constructed proposal.',needsInput:false,operations:[op],assumptions:[]});
const pass={verdict:'pass',recognizedObject:'A coherent custom form',confidence:.9,summary:'The visible form matches the requested design.',issues:[]};
const args=(extra={})=>({question:'Make a custom decorative form 100 mm wide',language:'en',document:newDocument(),...extra});
const ok=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const config={key:'test-credential-never-real',base:DEFAULT_BASE,model:'qwen3.8-flash',visionModel:'qwen3.7-plus'};

test('construct schema bounds plans and refuses ignored fields or false exact internal dimensions',()=>{
  const original=construct(),normalized=validateConstructOperation(original);
  assert.equal(normalized.shape.provenance,'estimated');assert.equal(normalized.parts[0].rotation,0);assert.equal(original.shape.provenance,undefined);
  for(const invalid of [construct({parts:Array.from({length:21},()=>part())}),construct({parts:[part({params:{holes:[]}})]}),construct({parts:[part({operation:'subtract'})]}),construct({shape:{...original.shape,provenance:'specified'}}),construct({parts:[part({type:'path',closed:true,points:Array.from({length:17},(_,i)=>[i,0])})]}),construct({parts:[part({x:-1})]})])assert.throws(()=>validateConstructOperation(invalid),/construction/);
});
test('construct operations retain the photo confirmation gate and existing target lock',()=>{
  assert.throws(()=>validateReply(reply(construct()),{imageConfirmed:false}),/confirmation/);
  const document=newDocument();document.shapes.push(createShape('path',{id:'locked',locked:true}));
  assert.throws(()=>validateReply(reply(construct({targetId:'locked'})),{document}),/unlocked_path/);
});
test('ordinary construction drafting uses the existing text model and returns only a validated plan',async()=>{
  const task=validateTask(args());
  const result=await callQwen(task,config,{fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.model,config.model);assert.match(body.messages[0].content,/CONSTRUCT is the DEFAULT/);
    return ok({choices:[{message:{content:JSON.stringify(reply(construct()))},finish_reason:'stop'}]});
  }});
  assert.equal(result.operations[0].op,'construct');assert.equal(result.operations[0].shape.provenance,'estimated');
});
test('client renders expanded construction but sends original small plan for vision and revision',async()=>{
  const document=newDocument();document.sheet.width=1500;document.sheet.height=1000;
  const op=construct({shape:{name:'Large custom form',x:20,y:20,width:1000,height:700}});let rendered=false,reviewed=false;
  const result=await askAssistant(args({document}),{renderer:async({shapes})=>{rendered=true;assert.equal(shapes[0].type,'path');assert.ok(shapes[0].points.length>240);return image;},fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.phase==='review'){reviewed=true;assert.equal(body.candidate.operations[0].op,'construct');assert.equal(body.candidate.operations[0].parts.length,1);assert.equal(body.candidate.operations[0].shape.points,undefined);return ok({review:pass});}
    return ok(reply(op));
  }});
  assert.ok(rendered&&reviewed);assert.equal(result.operations[0].op,'add');assert.equal(result.operations[0].shape.type,'path');
  assert.equal(shapeBounds(result.operations[0].shape).width,1000);assert.match(result.assumptions.join(' '),/internal proportions are estimated/);assert.equal(document.shapes.length,0);
});
test('disconnected constructions reach visual revision and cannot pass until connected',async()=>{
  const disconnected=construct({parts:[part({type:'rect',x:0,width:10}),part({type:'rect',x:70,width:10})]});
  const connected=construct({parts:[part({type:'rect',x:0,width:10}),part({type:'rect',x:5,width:10})]});
  const phases=[];let renders=0;
  const result=await askAssistant(args(),{renderer:async({shapes})=>{renders++;if(renders===1)assert.equal(shapes[0].contours.length,2);return image;},fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);phases.push(body.phase);
    if(body.phase==='review')return ok({review:pass});
    if(body.phase==='revise'){assert.equal(body.candidate.operations[0].parts[1].x,70);assert.match(body.candidate.critique.issues[0],/disconnected/);return ok(reply(connected));}
    return ok(reply(disconnected));
  }});
  assert.deepEqual(phases,['draft','review','revise','review']);assert.equal(result.constructionIssues.length,0);assert.equal(result.visualReview.reviews[0].verdict,'revise');
});
test('construct target resize is reviewed even when normalized outline remains identical',async()=>{
  const initial=expandConstructiveReply(reply(construct({parts:[part({type:'rect'})]})),newDocument());
  const document=applyOperations(newDocument(),initial.operations),target=document.shapes[0];let reviews=0;
  const op=construct({shape:{name:'Resized',x:20,y:20,width:120,height:70},parts:[part({type:'rect'})],targetId:target.id});
  const result=await askAssistant(args({document,question:'Resize this custom form'}),{renderer:async({shapes})=>{assert.equal(shapes[0].id,target.id);return image;},fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);if(body.phase==='review'){reviews++;return ok({review:pass});}return ok(reply(op));
  }});
  assert.equal(reviews,1);assert.equal(result.operations[0].op,'update');assert.equal(result.operations[0].id,target.id);assert.equal(document.shapes[0].width,100);
});
test('provider review failures expose a fixed validation tag without provider text or credentials',async()=>{
  const task=validateTask({...args(),phase:'review',candidate:{image,operations:[construct()],revision:0,measurements:[{name:'Form',width:100,height:70,provenance:'estimated'}]}});
  let calls=0;
  await assert.rejects(callQwen(task,config,{fetcher:async()=>{calls++;return ok({choices:[{message:{content:JSON.stringify({...pass,confidence:80,recognizedObject:config.key})},finish_reason:'stop'}]});}}),error=>error.code==='response'&&error.reason==='visual_review_confidence'&&!JSON.stringify(error).includes(config.key));
  assert.equal(calls,2);
});
test('client retains a safe review reason tag for diagnostics without accepting construction',async()=>{
  await assert.rejects(askAssistant(args(),{renderer:async()=>image,fetcher:async(_url,options)=>ok(JSON.parse(options.body).phase==='review'?{error:'response',reason:'visual_review_confidence'}:reply(construct()),JSON.parse(options.body).phase==='review'?502:200)}),error=>error.code==='visual_review_unavailable'&&error.detail.includes('visual_review_confidence'));
});
test('AI cannot unlock a shape before modifying or deleting it in the same batch',()=>{
  const document=newDocument();document.shapes.push(createShape('path',{id:'locked',locked:true}));
  assert.throws(()=>validateReply({reply:'Remove',needsInput:false,operations:[{op:'update',id:'locked',changes:{locked:false}},{op:'delete',id:'locked'}]},{document}),/manual_unlock/);
  assert.throws(()=>validateReply({reply:'Move',needsInput:false,operations:[{op:'update',id:'locked',changes:{x:50}}]},{document}),/manual_unlock/);
  assert.equal(document.shapes[0].locked,true);
});
