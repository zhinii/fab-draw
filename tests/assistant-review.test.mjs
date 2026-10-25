import test from 'node:test';
import assert from 'node:assert/strict';
import {askAssistant,canSkipRecipeReview} from '../src/assistant.mjs';
import {buildReviewSVG} from '../src/review-render.mjs';
import {newDocument,createShape,shapePath} from '../src/geometry.mjs';
import {validateTask,validateReply,validateVisualReview,providerMessages,callQwen,profileShape,DEFAULT_BASE} from '../server/cad-system.mjs';

const image={data:'data:image/png;base64,AAAA',width:1024,height:512};
const shape={type:'path',name:'Dog',x:20,y:20,width:100,height:70,points:[[0,0],[100,0],[60,70],[10,60]],closed:true,smooth:false,provenance:'estimated',params:{}};
const proposal=(changes={})=>({reply:'A proposed outline.',needsInput:false,operations:[{op:'add',shape:{...shape,...changes}}],assumptions:[]});
const passed={verdict:'pass',recognizedObject:'A stylized dog in side view',confidence:.92,summary:'The head, legs and tail read coherently as a dog.',issues:[]};
const rejected={verdict:'revise',recognizedObject:'An angular quadrilateral',confidence:.96,summary:'This does not read as a dog.',issues:['Add a recognizable head with muzzle and ear, four leg shapes and a raised tail.']};
const args=(extra={})=>({question:'A dog silhouette 100 mm wide',language:'en',document:newDocument(),...extra});
const ok=data=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
const renderer=async()=>image;
const candidate=(extra={})=>({image,operations:proposal().operations,measurements:[{name:'Dog',width:100,height:70,provenance:'estimated'}],revision:0,...extra});
const config={key:'test-only-not-real',base:DEFAULT_BASE,model:'qwen3.8-flash',visionModel:'qwen3.7-plus'};

test('candidate rendering uses cropped actual exported paths twice without labels or grid',()=>{
  const doc=newDocument(),path=createShape('path',{...shape,name:'DOG NAME MUST NOT GUIDE REVIEW'});
  const svg=buildReviewSVG(doc,[path]),d=shapePath(path);
  assert.equal(svg.split(`d="${d}"`).length-1,2);
  assert.match(svg,/width="1024" height="512"/);
  assert.match(svg,/viewBox="14\.5 14\.5 111 81"/);
  assert.ok(!svg.includes('DOG NAME'));assert.ok(!svg.includes('data-name'));assert.ok(!svg.includes('<text'));
  assert.match(svg,/fill="#000000"/);assert.match(svg,/fill="none"/);
});
test('review rendering never invents closed filled silhouettes from open or scoring paths',()=>{
  const doc=newDocument(),open=createShape('path',{...shape,closed:false}),score=createShape('path',{...shape,id:'score',role:'score'});
  const svg=buildReviewSVG(doc,[open,score]);
  assert.ok(!svg.includes('fill="#000000"'));assert.equal((svg.match(/<path/g)||[]).length,4);
});
test('visual-review schema rejects optimistic passes and drawing mutations',()=>{
  assert.deepEqual(validateVisualReview(passed),passed);
  for(const invalid of [{...passed,confidence:.5},{...passed,issues:['missing ears']},{...passed,operations:[]},{...rejected,issues:[]},{...passed,verdict:'looks fine'}])assert.throws(()=>validateVisualReview(invalid),/visual_review/);
});
test('review phase is separate from uploaded photos and cannot bypass their confirmation',()=>{
  const task=validateTask({...args(),phase:'review',candidate:candidate()});
  assert.equal(task.image,undefined);assert.equal(task.phase,'review');
  assert.throws(()=>validateTask({...args(),image:{...image,confirmed:false},phase:'review',candidate:candidate()}),/confirmation/);
  assert.throws(()=>validateTask({...args(),phase:'draft',candidate:candidate()}),/candidate_phase/);
  assert.throws(()=>validateTask({...args(),phase:'revise',candidate:candidate({revision:1,critique:passed})}),/critique/);
  const initial=providerMessages(validateTask({...args(),image:{...image,confirmed:false}})).at(-1).content;
  assert.ok(initial.some(c=>c.type==='text'&&c.text.includes('Unconfirmed source')));
});
test('review and visual revision both call vision with candidate raster and original dimensions',async()=>{
  for(const phase of ['review','revise']) {
    const task=validateTask({...args(),phase,candidate:candidate(phase==='revise'?{revision:1,critique:rejected}:{})});
    const result=await callQwen(task,config,{fetcher:async(_url,options)=>{
      const sent=JSON.parse(options.body);assert.equal(sent.model,config.visionModel);
      const content=sent.messages.at(-1).content;assert.ok(content.some(c=>c.type==='image_url'&&c.image_url.url===image.data));
      const context=JSON.parse(content[0].text);assert.equal(context.question,args().question);assert.equal(context.candidate.measurements[0].width,100);
      if(phase==='revise'){assert.equal(context.candidate.critique.summary,rejected.summary);assert.deepEqual(context.candidate.operations,task.candidate.operations);}
      else {assert.equal(context.candidate.operations,undefined);assert.equal(context.candidate.critique,undefined);assert.equal(context.document,undefined);}
      return ok({choices:[{message:{content:JSON.stringify(phase==='review'?passed:proposal())},finish_reason:'stop'}]});
    }});
    if(phase==='review'){assert.equal(result.review.verdict,'pass');assert.equal(result.operations,undefined);}
    else assert.equal(result.operations[0].shape.width,100);
  }
});
test('recipe bypass requires exact geometry and an unambiguous matching request',()=>{
  const butterfly=profileShape('butterfly',{width:100});
  assert.equal(canSkipRecipeReview(butterfly,'Make a butterfly silhouette 100 mm wide'),true);
  assert.equal(canSkipRecipeReview({...butterfly,name:'Dog'},'Make a dog'),false);
  assert.equal(canSkipRecipeReview(butterfly,'Make a dog with butterfly wings'),false);
  assert.equal(canSkipRecipeReview({...butterfly,points:shape.points},'Make a butterfly'),false);
  assert.throws(()=>validateReply(proposal({recipe:'butterfly'})),/recipe_geometry_mismatch/);
});
test('client accepts a freeform outline only after an explicit visual pass',async()=>{
  const input=args(),phases=[],bodies=[];let renders=0;
  const result=await askAssistant({...input,onProgress:p=>phases.push(p.phase)},{renderer:async request=>{renders++;assert.equal(request.shapes.length,1);assert.equal(request.shapes[0].width,100);return image;},fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);return ok(body.phase==='review'?{review:passed}:proposal());
  }});
  assert.equal(renders,1);assert.deepEqual(phases,['drafting','reviewing']);assert.equal(bodies.length,2);
  assert.equal(result.visualReview.status,'passed');assert.equal(result.visualReview.reviews.length,1);
  assert.match(result.assumptions.at(-1),/does not verify physical/);assert.equal(input.document.shapes.length,0);
});
test('failed visual candidate is revised with its image and concrete critique before acceptance',async()=>{
  const bodies=[];let reviews=0;
  const result=await askAssistant(args(),{renderer,fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);
    if(body.phase==='review')return ok({review:++reviews===1?rejected:passed});
    if(body.phase==='revise'){assert.equal(body.candidate.image.data,image.data);assert.deepEqual(body.candidate.critique,rejected);assert.equal(body.document.shapes.length,0);}
    return ok(proposal());
  }});
  assert.deepEqual(bodies.map(b=>b.phase),['draft','review','revise','review']);
  assert.equal(result.visualReview.attempts,2);assert.equal(result.visualReview.reviews[0].verdict,'revise');
});
test('three failed or uncertain reviews stop honestly after two revisions',async()=>{
  const doc=newDocument();let calls=0,renders=0;
  await assert.rejects(askAssistant(args({document:doc}),{renderer:async()=>{renders++;return image;},fetcher:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);return ok(body.phase==='review'?{review:{...rejected,verdict:'uncertain'}}:proposal());
  }}),error=>error.code==='visual_review_failed'&&error.detail.includes('muzzle'));
  assert.equal(calls,6);assert.equal(renders,3);assert.equal(doc.shapes.length,0);
});
test('specified provenance and a primitive named Dog cannot bypass recognition review',async()=>{
  for(const draft of [proposal({provenance:'specified'}),{reply:'Dog',needsInput:false,operations:[{op:'add',shape:{type:'ellipse',name:'Dog',width:100,height:70}}]}]) {
    let reviews=0;
    await askAssistant(args(),{renderer,fetcher:async(_url,options)=>{const body=JSON.parse(options.body);if(body.phase==='review'){reviews++;return ok({review:passed});}return ok(draft);}});
    assert.equal(reviews,1);
  }
});
test('changed existing path is rendered and reviewed without including unrelated shapes',async()=>{
  const doc=newDocument(),old=createShape('path',{...shape,id:'dog'});doc.shapes.push(old,createShape('rect',{id:'unrelated'}));let rendered=[];
  const result=await askAssistant(args({document:doc,question:'Give this dog a larger ear'}),{renderer:async request=>{rendered=request.shapes.map(s=>s.id);return image;},fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);return ok(body.phase==='review'?{review:passed}:{reply:'Updated proposal',needsInput:false,operations:[{op:'update',id:'dog',changes:{points:[[0,0],[100,0],[70,70],[0,50]]}}]});
  }});
  assert.deepEqual(rendered,['dog']);assert.equal(result.visualReview.status,'passed');assert.deepEqual(doc.shapes[0].points,shape.points);
});
test('cancellation during rendering or a delayed visual pass never returns a proposal',async()=>{
  for(const during of ['render','review']) {
    const controller=new AbortController();let calls=0;
    await assert.rejects(askAssistant(args({signal:controller.signal}),{renderer:async()=>{if(during==='render')controller.abort();return image;},fetcher:async(_url,options)=>{
      calls++;const body=JSON.parse(options.body);if(body.phase==='review'){controller.abort();return ok({review:passed});}return ok(proposal());
    }}),e=>e.code==='cancelled');
    assert.equal(calls,during==='render'?1:2);
  }
});
test('missing renderer and malformed visual responses fail closed rather than accepting draft',async()=>{
  await assert.rejects(askAssistant(args(),{renderer:async()=>{throw Error('no canvas');},fetcher:async()=>ok(proposal())}),e=>e.code==='visual_renderer_unavailable');
  await assert.rejects(askAssistant(args(),{renderer,fetcher:async(_url,options)=>ok(JSON.parse(options.body).phase==='review'?{review:{...passed,confidence:.2}}:proposal())}),e=>e.code==='visual_review_unavailable'&&e.detail.includes('visual_review_pass_not_supported'));
});
test('review failure diagnostics distinguish local candidate validation from relay HTTP failures',async()=>{
  let calls=0;
  await assert.rejects(askAssistant(args(),{renderer:async()=>({...image,width:2048}),fetcher:async()=>{calls++;return ok(proposal());}}),e=>e.code==='visual_review_unavailable'&&e.detail==='CAD review validation: image.');
  assert.equal(calls,1);
  await assert.rejects(askAssistant(args(),{renderer,fetcher:async(_url,options)=>JSON.parse(options.body).phase==='review'?new Response(JSON.stringify({error:'response'}),{status:502}):ok(proposal())}),e=>e.code==='visual_review_unavailable'&&e.detail.includes('review')&&e.detail.includes('HTTP 502, response'));
});
test('dimensioned primitives and exact matching recipes do not require paid visual review',async()=>{
  for(const [question,draft] of [['rectangle 80 x 40',{reply:'Rectangle',needsInput:false,operations:[{op:'add',shape:{type:'rect',width:80,height:40}}]}],['make a butterfly 100 mm wide',{reply:'Built-in butterfly',needsInput:false,operations:[{op:'add',shape:{type:'profile',profile:'butterfly',width:100}}]}]]) {
    let calls=0;
    await askAssistant(args({question}),{renderer:async()=>{throw Error('must not render');},fetcher:async()=>{calls++;return ok(draft);}});assert.equal(calls,1);
  }
});
test('a confirmed source image prevents recipe bypass and remains available to the reviewer',async()=>{
  let reviews=0;
  await askAssistant(args({question:'Draw a butterfly',image:{...image,confirmed:true}}),{renderer,fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.phase==='review'){reviews++;assert.equal(body.image.confirmed,true);assert.equal(body.image.data,image.data);return ok({review:passed});}
    return ok({reply:'Proposed butterfly',needsInput:false,operations:[{op:'add',shape:{type:'profile',profile:'butterfly',width:100}}]});
  }});
  assert.equal(reviews,1);
});
test('named-object technical modifiers cannot bypass review and directional lines remain supported',async()=>{
  let reviews=0;
  await askAssistant(args({question:'Make a dog-shaped plate'}),{renderer,fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);if(body.phase==='review'){reviews++;return ok({review:passed});}
    return ok({reply:'Plate',needsInput:false,operations:[{op:'add',shape:{type:'plate',width:80,height:40,params:{holeDiameter:5,edgeInset:15,cornerRadius:0}}}]});
  }});assert.equal(reviews,1);
  const line=createShape('line',{width:0,height:50,points:[[0,0],[0,50]]});
  assert.match(buildReviewSVG(newDocument(),[line]),/<path/);
  const result=await askAssistant(args({question:'Draw a vertical line 50 mm long'}),{renderer:async()=>{throw Error('not needed');},fetcher:async()=>ok({reply:'Line',needsInput:false,operations:[{op:'add',shape:line}]})});
  assert.equal(result.visualReview,undefined);
});
test('one geometry repair plus two visual revisions stays within seven relay calls',async()=>{
  let calls=0,drafts=0;
  await assert.rejects(askAssistant(args(),{renderer,fetcher:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);
    if(body.phase==='review')return ok({review:rejected});
    return ok(++drafts===1?proposal({width:-1}):proposal());
  }}),e=>e.code==='visual_review_failed');
  assert.equal(calls,7);assert.equal(drafts,4);
});
test('a renderable crossing draft receives image-guided revision before terminal geometry failure',async()=>{
  const phases=[];let drafts=0;
  const result=await askAssistant(args(),{renderer,fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);phases.push(body.phase);
    if(body.phase==='review')return ok({review:passed});
    if(body.phase==='revise')assert.ok(body.candidate.critique.issues.some(i=>/crossing|zero net area/i.test(i)));
    return ok(++drafts===1?proposal({points:[[0,0],[100,70],[0,70],[100,0]]}):proposal());
  }});
  assert.deepEqual(phases,['draft','review','revise','review']);
  assert.equal(result.visualReview.reviews[0].verdict,'revise');
  assert.equal(result.visualReview.status,'passed');
});
test('a timeout retains the last visual critique and never blames the connection or accepts a draft',async()=>{
  let reviews=0;
  await assert.rejects(askAssistant(args(),{renderer,fetcher:async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.phase==='review'){if(++reviews===2)throw new DOMException('Timed out','TimeoutError');return ok({review:rejected});}
    return ok(proposal());
  }}),error=>error.code==='timeout'&&error.detail.includes('muzzle')&&!error.message.includes('connection')&&error.visualReview.verdict==='revise');
});
