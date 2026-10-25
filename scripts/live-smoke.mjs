// Explicit live checks use the deployed relay's server-held key; no key is read locally.
// Health (default) is free. Other cases use the actual browser client, including
// its bounded geometry and visual repairs, so a case may send up to seven relay
// requests. Visual cases require Sharp installed or the bundled Codex runtime.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {newDocument,applyOperations,shapeBounds,preflight,exportSVG,shapePath,shapeTransform} from '../src/geometry.mjs';
import {DEFAULT_CONNECTION,askAssistant} from '../src/assistant.mjs';
import {validateReply,validateVisualReview} from '../server/cad-system.mjs';
import {expandConstructiveReply} from '../src/construction.mjs';
import {buildReviewSVG} from '../src/review-render.mjs';

const choice=process.argv[2]||'health';
const cases={
  dog:{question:'Draw a dog in side view, 100 mm wide. Make one recognizable closed silhouette for a simple decorative laser cut. Choose sensible proportions.',language:'en'},
  butterfly:{question:'Make a butterfly silhouette 100 mm wide. Use a single closed editable path. Choose its height.',language:'en'},
  plate:{question:'Make a rectangular mounting plate 80 x 40 mm, with two 5 mm diameter holes on its horizontal centreline, each hole centre 15 mm from its nearest end. Square corners.',language:'en'},
  zh:{question:'请画一个宽80毫米、高40毫米的长方形，不要圆角。',language:'zh'},
  photo:{question:'Read this dimensioned sketch. List the dimensions and ask me to confirm them before reconstructing it.',language:'en'},
};
if(choice!=='health'&&!cases[choice])throw new Error('Choose health, dog, butterfly, plate, zh, or photo.');
const diagnostic=process.argv.includes('--first-review');
const started=Date.now();
const task=choice==='health'?null:{...cases[choice],document:newDocument(),selectedIds:[],history:[],...(choice==='photo'?{image:{data:'data:image/png;base64,'+(await readFile(new URL('../outputs/dimensioned-sketch.png',import.meta.url))).toString('base64'),width:900,height:600,confirmed:false}}:{})};
const requests=[];
const renderer=async({document,shapes,signal})=>{
  signal?.throwIfAborted();const require=createRequire(import.meta.url);
  const sharp=require(require.resolve('sharp',{paths:[process.cwd(),join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')]}));
  const png=await sharp(Buffer.from(buildReviewSVG(document,shapes))).png().toBuffer();signal?.throwIfAborted();
  await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(new URL(`../outputs/live-smoke-${choice}-review-${requests.length}.png`,import.meta.url),png);
  return {data:'data:image/png;base64,'+png.toString('base64'),width:1024,height:512};
};
const fetcher=async(url,options)=>{
  if(diagnostic&&requests.length>=2)throw Object.assign(new Error('Diagnostic stopped after two relay requests.'),{code:'diagnostic_request_limit'});
  const response=await fetch(url,{...options,headers:{...options.headers,Origin:'https://zhinii.github.io'}}),record={status:response.status,phase:options.body?JSON.parse(options.body).phase:'health'};requests.push(record);
  if(!response.ok){try{const failure=await response.clone().json();record.error=failure.error;record.reason=failure.reason;}catch{}return response;}
  if(response.ok&&choice!=='health')try {
    const raw=await response.clone().json();
    if(record.phase==='review'){record.review=validateVisualReview(raw.review);return response;}
    record.operations=raw.operations;
    const proposal=expandConstructiveReply(validateReply(raw,{imageConfirmed:choice!=='photo',document:task.document}),task.document),doc=applyOperations(task.document,proposal.operations);
    record.preflight=[...(proposal.constructionIssues||[]),...preflight(doc)].map(({code,message,severity})=>({code,message,severity}));
    record.shapes=doc.shapes.map(s=>({type:s.type,width:s.width,height:s.height,pointCount:s.points?.length,bounds:shapeBounds(s)}));
    if(doc.shapes.length) {
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 300 200"><rect width="300" height="200" fill="white"/>${doc.shapes.map(s=>`<path d="${shapePath(s)}" transform="${shapeTransform(s)}" fill="#dcebe4" fill-rule="evenodd" stroke="#246e60" stroke-width=".4"/>`).join('')}</svg>`;
      await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(new URL(`../outputs/live-smoke-${choice}-proposal-${requests.length}.svg`,import.meta.url),svg);
    }
  }catch(error){record.validationError=error.message;}
  return response;
};
let summary;
try {
  const data=choice==='health'?await(await fetcher(DEFAULT_CONNECTION.url,{method:'GET',signal:AbortSignal.timeout(12000)})).json():await askAssistant(task,{fetcher,renderer});
  summary={case:choice,requests,elapsedMs:Date.now()-started,response:{reply:data.reply,needsInput:data.needsInput,operationsCount:data.operations?.length,source:data.source,assumptions:data.assumptions,perception:data.perception,visualReview:data.visualReview,...(choice==='health'?data:{})}};
  if(Array.isArray(data.operations)) {
    const doc=applyOperations(newDocument(),data.operations);
    summary.geometry=doc.shapes.map(s=>({type:s.type,name:s.name,width:s.width,height:s.height,params:Object.fromEntries(Object.entries(s.params).filter(([,v])=>typeof v==='number')),pointCount:s.points?.length,bounds:shapeBounds(s)}));
    summary.preflight=preflight(doc);
    const shape=doc.shapes[0];
    if(choice==='plate'&&(!shape||shape.type!=='plate'||shape.width!==80||shape.height!==40||shape.params.holeDiameter!==5||shape.params.edgeInset!==15))throw Error('Plate did not preserve the specified dimensions.');
    if(choice==='zh'&&(!/[\u4e00-\u9fff]/.test(data.reply)||!shape||shape.width!==80||shape.height!==40))throw Error('Chinese response or specified rectangle dimensions missing.');
    if(choice==='butterfly') {
      summary.response.builtInAttribution=/built-in editable|内置可编辑/.test([data.reply,...(data.assumptions||[])].join(' '));
      if(!shape||shape.type!=='path'||shape.points.length<20||Math.abs(shapeBounds(shape).width-100)>.0001)throw Error('Butterfly profile or actual 100 mm width missing.');
      if(!summary.response.builtInAttribution&&data.visualReview?.status!=='passed')throw Error('Neither a verified built-in outline nor a passed visual review was supplied.');
    }
    if(choice==='photo'&&(!data.needsInput||data.operations.length||data.perception?.imageStatus!=='seen'))throw Error('Photo confirmation gate missing.');
    if(doc.shapes.length){await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(new URL(`../outputs/live-smoke-${choice}.svg`,import.meta.url),exportSVG(doc));}
  }
}catch(error){summary={...summary,case:choice,requests,elapsedMs:Date.now()-started,error:error.code||error.name,message:error.message,detail:error.detail,cause:error.cause?.code};process.exitCode=1;}
await mkdir(new URL('../outputs/',import.meta.url),{recursive:true});await writeFile(new URL(`../outputs/live-smoke-${choice}.json`,import.meta.url),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
