import {editArtwork} from './art-edit.mjs';
import {createShape,applyOperations,validateDocument,shapeBounds,preflight} from './geometry.mjs';
import {validateReply,validateTask,validateVisualReview,isRecipeShape,PROVIDER_BASES,DEFAULT_BASE,profileShape,PROFILE_RECIPES} from '../server/cad-system.mjs';
import {renderReviewImage} from './review-render.mjs';
import {expandConstructiveReply} from './construction.mjs';
import {BRACKET_READ_INSTRUCTION,readBracketPacket,bracketReport,resolveBracket,measuredBracketShape,emptyBracketPlan} from './measured-bracket.mjs';

export const DEFAULT_CONNECTION=Object.freeze({url:'https://bnta-robot-lab-connection.zhinii.chatgpt.site/api/cad'});
const pick=(language,en,zh)=>language==='zh'?zh:en;
const errors={
  connection:['Could not reach Qwen. Your drawing is unchanged. Check the connection or use built-in examples.','无法连接 Qwen。图纸未改变。请检查连接或使用内置示例。'],
  auth:['The Qwen connection needs a valid key or account access. Your drawing is unchanged.','Qwen 连接需要有效密钥或账户权限。图纸未改变。'],
  quota:['The Qwen limit was reached. Wait briefly or check the account quota.','已达到 Qwen 限制。请稍后重试或检查账户配额。'],
  rate_limit:['The classroom connection is busy. Please try again in a minute.','课堂连接繁忙，请一分钟后重试。'],
  model:['This Qwen model is unavailable for the account. Check the connection settings.','当前账户无法使用此 Qwen 模型，请检查连接设置。'],
  vision_unavailable:['This connection could not read the photo. No photo measurements were accepted. Check the vision model or type the measurements.','此连接无法读取照片，尚未采纳照片尺寸。请检查视觉模型或输入尺寸。'],
  response:['Qwen returned a drawing that could not be validated. Nothing changed. Try a simpler description.','Qwen 返回的图纸未通过校验，未做任何更改。请尝试更简单的描述。'],
  geometry:['I could not produce a clean outline. Your drawing is unchanged. Review the issue below or try a different description.','未能生成清晰、无交叉的轮廓。图纸未改变。请查看下方问题或尝试另一种描述。'],
  visual_review_failed:['I could not produce a recognizable outline after the visual checks. Your drawing is unchanged. Try a clearer view or provide a reference sketch.','经过视觉检查后，仍未生成可辨认的轮廓。图纸未改变。请明确视角或提供参考草图。'],
  visual_review_unavailable:['The outline could not be visually checked. Your drawing is unchanged. Check the vision connection or try again.','无法完成轮廓的视觉检查。图纸未改变。请检查视觉模型连接或重试。'],
  visual_renderer_unavailable:['The candidate outline could not be rendered for its visual check. Your drawing is unchanged.','无法渲染候选轮廓以进行视觉检查。图纸未改变。'],
  timeout:['The AI drawing checks took too long. Your drawing is unchanged. Try again or simplify the requested outline.','AI 绘图检查用时过长。图纸未改变。请重试或简化所需轮廓。'],
  server_configuration:['The CAD connection is not configured yet. Manual drawing and built-in examples are available.','CAD 连接尚未配置，仍可手动绘图并使用内置示例。'],
  endpoint:['Use the school CAD connection or a local /api/cad endpoint. Keys can only go to the trusted bridge or localhost.','请使用学校 CAD 连接或本地 /api/cad 接口。密钥只能发送到可信连接桥或本机。'],
  image:['The photo must be JPEG or PNG, no more than 1024 pixels on either side and 450 KB after compression.','照片须为 JPEG 或 PNG，长边不超过 1024 像素，压缩后不超过 450 KB。'],
  cancelled:['Cancelled. Your drawing is unchanged.','已取消。图纸未改变。'],
  offline_unknown:['Built-in examples understand basic shapes, butterfly, heart, tree, fish, and dimensioned plates. Connect Qwen for open-ended designs.','内置示例支持基本图形、蝴蝶、爱心、树、鱼和标注尺寸的板件。连接 Qwen 可自由描述设计。'],
  document_size:['This drawing is too large for one AI request. Manual editing and export still work.','此图纸过大，无法在一次 AI 请求中处理。仍可手动编辑和导出。'],
};
export function assistantError(code,language='en') {
  const pair=errors[code]||errors.connection;
  const error=new Error(pick(language,...pair));error.code=code;return error;
}
function endpoint(connection={}) {
  const address=connection.url||DEFAULT_CONNECTION.url;
  let url;try{url=new URL(address,globalThis.location?.href||'http://127.0.0.1:4227/');}catch{throw new Error('endpoint');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/api/cad'||(!local&&url.protocol!=='https:')||(local&&!['https:','http:'].includes(url.protocol)))throw new Error('endpoint');
  const headers={'Content-Type':'application/json'};
  if(connection.key) {
    if(!local&&url.href!==DEFAULT_CONNECTION.url)throw new Error('endpoint');
    if(typeof connection.key!=='string'||!connection.key.trim()||connection.key.length>512||/\s/.test(connection.key.trim()))throw new Error('auth');
    const base=(connection.base||DEFAULT_BASE).replace(/\/$/,'');if(!PROVIDER_BASES.has(base))throw new Error('endpoint');
    headers.Authorization='Bearer '+connection.key.trim();headers['X-Alibaba-Base']=base;
    if(connection.model!==undefined){if(typeof connection.model!=='string'||!/^[\w.\-]{1,100}$/.test(connection.model))throw new Error('model');headers['X-Alibaba-Model']=connection.model;}
  }
  return {url:url.href,headers};
}
function combinedSignal(signal,ms) {
  return signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);
}
function validationDetail(language,phase,error) {
  // Only fixed validator identifiers are exposed, never request/image contents.
  const reason=/^[a-z_]{1,160}$/.test(error?.message||'')?error.message:'invalid_response';
  return pick(language,`CAD ${phase} validation: ${reason}.`,`CAD ${phase} 校验：${reason}。`);
}
export async function checkConnection(connection=DEFAULT_CONNECTION,signal,fetcher=globalThis.fetch) {
  if(connection.mode==='offline'||connection.offline)return {configured:false,verified:false,service:'Built-in examples',source:'offline'};
  const config=endpoint(connection);
  const response=await fetcher(config.url,{method:'GET',cache:'no-store',signal:combinedSignal(signal,12000)});
  let data;try{data=await response.json();}catch{throw new Error('response');}
  if(!response.ok||typeof data?.configured!=='boolean'||typeof data?.service!=='string'||!data.service.includes('Fab Draw'))throw new Error('connection');
  // Health is deliberately free: the provider checks account/key access on the first prompt.
  return {configured:data.configured||Boolean(connection.key),verified:false,service:data.service,model:connection.key&&connection.model?connection.model:typeof data.model==='string'?data.model:undefined,visionModel:typeof data.visionModel==='string'?data.visionModel:undefined,sessionKey:Boolean(connection.key),source:'qwen'};
}
export async function askAssistant(args, {fetcher=globalThis.fetch,renderer=renderReviewImage,onProgress=args.onProgress}={}) {
  const {question,language='en',document,selectedIds=[],history=[],image,connection=DEFAULT_CONNECTION,signal}=args;
  const dimensioned=args.workflow==='dimensioned';
  if(!image&&!args.measurementPlan){const localEdit=editArtwork(args);if(localEdit)return localEdit;}
  if(signal?.aborted)throw assistantError('cancelled',language);
  if(dimensioned&&args.measurementPlan){
    const plan=resolveBracket(args.measurementPlan,question),report=bracketReport(plan,language);
    if(!image?.confirmed||!report.canConfirm)return report;
    const target=args.measurementTargetId?document.shapes.find(s=>s.id===args.measurementTargetId):null;
    if(args.measurementTargetId&&!target)throw Error('The original bracket no longer exists. Start a new reconstruction.');
    if(target&&(target.type!=='path'||!target.params?.measuredBracket))throw Error('The selected object is not a measured bracket. Nothing was replaced.');
    if(target?.locked)throw Error('Unlock this bracket before changing its measurements.');
    const shape=measuredBracketShape(plan,target?{x:target.x,y:target.y,rotation:target.rotation,name:target.name,role:target.role}:{}),operations=[];
    if(document.sheet.height<shape.height+60||document.sheet.width<shape.width+60)operations.push({op:'sheet',changes:{width:Math.max(document.sheet.width,shape.width+60),height:Math.max(document.sheet.height,shape.height+60)}});
    if(target){const {type,...changes}=shape;operations.push({op:'update',id:target.id,changes});}else operations.push({op:'add',shape});
    return {...report,reply:language==='zh'?'已按确认的尺寸构建圆角支架，包含四个小孔和一个大孔。请检查预览。':'Built the measured bracket with all five holes and true circular fillets. The chosen dimension relationships were checked locally. Review the preview before keeping it.',needsInput:false,operations,requestCount:0};
  }
  if(connection.mode==='offline'||connection.offline) {
    const result=localAssistant(args);
    if(!result)throw assistantError('offline_unknown',language);
    return result;
  }
  let config,task;
  try {
    config=endpoint(connection);
    const doc=validateDocument(document);
    const focusedQuestion=dimensioned?`Dimensioned drawing prototype: one flat part, one orthographic view, millimetres. Use written or user-confirmed dimensions, never pixel estimates. Ask for missing or conflicting measurements. Supported shapes: plate, rect, circular ellipse, straight path, line. No construct, gear, artistic profiles or tracing of dimension arrows/text. Prefer a plate for two equal holes centred vertically and equally inset from each end; explicitly set cornerRadius (0 for square corners). Preserve hole diameter and edgeInset when changing plate width. For other outlines explain any positions not constrained. User request: ${question}`:question;
    task=validateTask({question:dimensioned&&image?'Dimensioned drawing prototype. '+BRACKET_READ_INSTRUCTION+' IMPORTANT: Put the measurement JSON INSIDE the reply string, enclosed by <bracket> and </bracket>. Do not put measurements in an extra top-level response field, where they would be discarded. The outer response must use reply, needsInput:true, operations:[], assumptions:[], suggestions:[]. For a matching bracket the reply must contain the full block, not a promise to list values. Use the latest user request in history.':focusedQuestion,language,document:doc,selectedIds,history:[...history.slice(-9).filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:String(m.content??m.reply??'').slice(0,4000)})),...(dimensioned&&image?[{role:'user',content:question}]:[])],...(image?{image}:{})});
  } catch(error) { throw assistantError(errors[error.message]?error.message:'geometry',language); }
  const requestSignal=combinedSignal(signal,180000),reviews=[];
  let geometryRepairs=0,revision=0,requestCount=0;
  const timedOut=()=>{const error=assistantError('timeout',language),last=reviews.at(-1);if(last){error.detail=[last.summary,...last.issues].join(' ').slice(0,1400);error.visualReview=last;}return error;};
  const ensureActive=()=>{if(requestSignal.aborted)throw signal?.aborted?assistantError('cancelled',language):timedOut();};
  const progress=(phase,critique)=>{ensureActive();try{onProgress?.({phase,attempt:revision+1,maxAttempts:3,...(critique?{critique}:{})});}catch(error){if(requestSignal.aborted)ensureActive();}};
  const request=async body=>{
    ensureActive();if(++requestCount>7)throw assistantError('visual_review_failed',language);
    const callSignal=combinedSignal(requestSignal,65000);
    try {
      let checked;
      try{checked=validateTask(body);}catch(error){const failure=assistantError('response',language);failure.detail=validationDetail(language,body.phase||'draft',error);throw failure;}
      const serialized=JSON.stringify(checked);
      if(new TextEncoder().encode(serialized).length>900000)throw assistantError('document_size',language);
      const response=await fetcher(config.url,{method:'POST',redirect:'error',headers:config.headers,body:serialized,signal:callSignal});
      let data;try{data=await response.json();}catch{const failure=assistantError('response',language);failure.detail=pick(language,`The CAD relay returned unreadable JSON (${body.phase}, HTTP ${response.status}).`,`CAD 连接返回了无法读取的 JSON（${body.phase}，HTTP ${response.status}）。`);throw failure;}
      ensureActive();
      if(!response.ok){
        const code=typeof data?.error==='string'&&/^[a-z_]{1,80}$/.test(data.error)?data.error:'connection',failure=assistantError(code,language);
        const reason=typeof data?.reason==='string'&&/^[a-z_]{1,160}$/.test(data.reason)?data.reason:undefined;
        failure.detail=pick(language,`CAD relay ${body.phase} failed (HTTP ${response.status}, ${code}${reason?`; ${reason}`:''}).`,`CAD 连接 ${body.phase} 失败（HTTP ${response.status}，${code}${reason?`；${reason}`:''}）。`);
        throw failure;
      }
      return data;
    } catch(error) {
      if(signal?.aborted)throw assistantError('cancelled',language);
      if(callSignal.aborted||error.name==='TimeoutError')throw timedOut();
      if(error.code)throw error;
      throw assistantError('connection',language);
    }
  };
  for(;;) {
    progress(revision?'revising':'drafting',task.candidate?.critique?.summary);
    const data=await request(task);
    let result,preview,newShapes,geometryIssue,sourceOperations;
    try {
      const proposed=validateReply(data,{imageConfirmed:!image||image.confirmed===true,document,language});
      if(dimensioned&&image){
        const plan=readBracketPacket(proposed.reply);if(plan)return bracketReport(plan,language);
        const description=[proposed.reply,...proposed.assumptions,...history.map(m=>m.content)].join(' ');
        if(/bracket|支架/i.test(description)&&/round|R\s*20|圆角/i.test(description)){
          return {...bracketReport(emptyBracketPlan(),language),reply:language==='zh'?'识别出了圆角支架，但未能可靠提取完整尺寸。尚未生成图形。请打开“尺寸读数”核对填写；不要反复发送确认消息。':'The rounded bracket was recognised, but a complete structured measurement reading was not returned. Nothing has been drawn. Open Measurements to review/fill the values rather than repeatedly confirming an incomplete reading.'};
        }
      }
      sourceOperations=proposed.operations;
      result=expandConstructiveReply(proposed,document);
      // Atomic validation uses the same model as mouse editing and fabrication export.
      preview=applyOperations(document,result.operations);
      const beforeIds=new Set(document.shapes.map(s=>s.id)),updatedIds=new Set(result.operations.filter(o=>o.op==='update').map(o=>o.id));
      newShapes=preview.shapes.filter(s=>!beforeIds.has(s.id)||updatedIds.has(s.id)&&(outlineChanged(document.shapes.find(old=>old.id===s.id),s)||sourceOperations.some(op=>op.op==='construct'&&op.targetId===s.id)));
      if(dimensioned&&(sourceOperations.some(op=>op.op==='construct')||newShapes.some(s=>!['plate','rect','ellipse','path','line'].includes(s.type)||s.smooth||s.provenance==='estimated')))throw new Error('This prototype needs confirmed measurements and simple straight outlines or circles. Please clarify the missing measurements.');
      for(const shape of preview.shapes)if(shape.type==='path'&&(!beforeIds.has(shape.id)||updatedIds.has(shape.id))) {
        const bounds=shapeBounds({...shape,x:0,y:0,rotation:0});
        if(Math.max(Math.abs(bounds.x),Math.abs(bounds.y),Math.abs(bounds.width-shape.width),Math.abs(bounds.height-shape.height))>1e-5)throw new Error('Path points do not match the declared outside dimensions. Set points to start at local 0,0 and span exactly width and height.');
      }
      geometryIssue=result.constructionIssues?.find(issue=>issue.severity==='error')||preflight(preview).find(issue=>issue.severity==='error'&&issue.shapeId&&(!beforeIds.has(issue.shapeId)||updatedIds.has(issue.shapeId)));
      // Finite, schema-valid paths can still cross themselves. Render these
      // drafts for image-guided correction instead of exhausting text repairs
      // before the visual model ever sees what it drew. They cannot be accepted.
      if(geometryIssue)geometryIssue={...geometryIssue,detail:geometryIssue.message};
      ensureActive();
    } catch(error) {
      if(error.code)throw error;
      if(!dimensioned&&geometryRepairs++===0){
        task.history=[...task.history.slice(-9),{role:'assistant',content:JSON.stringify(data).slice(0,4000)}];
        task.feedback=`Previous proposal rejected atomically: ${String(error.message).slice(0,500)}. No changes applied. Correct it using the CURRENT document. For ordinary objects prefer construct with overlapping local primitives rather than a long perimeter. Repair invalid dimensions/fields without inventing measurements. Return a question with no operations if fit-critical dimensions remain unresolved.`;continue;
      }
      const failure=assistantError('geometry',language);failure.detail=String(error.message).slice(0,800);throw failure;
    }
    const hasConstruction=sourceOperations.some(op=>op.op==='construct');
    if(dimensioned){
      if(geometryIssue){const error=assistantError('geometry',language);error.detail=geometryIssue.detail;throw error;}
      return {...result,source:'qwen',...(data.perception?{perception:data.perception}:{}),requestCount};
    }
    const needsReview=hasConstruction||!!geometryIssue||newShapes.length>0&&!isSimpleGeometryRequest(question,newShapes)&&!(!image&&newShapes.every(s=>canSkipRecipeReview(s,question)))||reviews.length>0;
    if(!needsReview||result.needsInput) return {...result,source:'qwen',...(data.perception?{perception:data.perception}:{}),...(reviews.length?{visualReview:{status:'unresolved',attempts:reviews.length,reviews}}:{})};
    if(!newShapes.length)throw visualFailure(reviews.at(-1),language);
    progress('reviewing');
    let rendered;
    try{rendered=await renderer({document:preview,shapes:newShapes,signal:combinedSignal(requestSignal,12000)});ensureActive();}
    catch(error){if(signal?.aborted)throw assistantError('cancelled',language);if(requestSignal.aborted||error.name==='TimeoutError')throw timedOut();throw assistantError('visual_renderer_unavailable',language);}
    // Preserve the small construction plan in vision/revision context. Only its
    // expanded path reaches the editor; flattened contours can exceed the AI's
    // raw-point cap and must not replace the usable component plan here.
    const candidate={image:rendered,operations:sourceOperations,revision,measurements:newShapes.map(s=>{const b=shapeBounds(s);return {name:s.name,width:b.width,height:b.height,provenance:s.provenance};})};
    let review;
    try{const assessed=await request({...task,phase:'review',candidate,...(geometryIssue?{feedback:`Geometry check failed: ${geometryIssue.detail}. The rendered draft is provisional and cannot be accepted until this is repaired. Also assess its actual resemblance to the requested object.`}:{})});
      try{review=validateVisualReview(assessed.review);}catch(error){const failure=assistantError('response',language);failure.detail=validationDetail(language,'review',error);throw failure;}
    }
    catch(error){if(['cancelled','timeout','auth','quota','rate_limit'].includes(error.code))throw error;const failure=assistantError('visual_review_unavailable',language);if(error.detail)failure.detail=error.detail;if(reviews.length)failure.visualReview=reviews.at(-1);throw failure;}
    if(geometryIssue)review={...review,verdict:'revise',summary:review.summary,issues:[geometryIssue.detail,...review.issues].slice(0,6)};
    reviews.push(review);ensureActive();
    if(review.verdict==='pass') {
      const notice=pick(language,'AI visual check passed. Review the preview yourself; this does not verify physical dimensions, fit or safety.','AI 视觉检查通过。请自行检查预览；这不代表实物尺寸、配合或安全性已验证。');
      const constructionNotice=pick(language,'Built by combining local shapes. The requested outside dimensions are exact; internal proportions are estimated.','通过组合局部图形构建。要求的外部尺寸精确；内部比例为估计值。');
      return {...result,source:'qwen',assumptions:[...result.assumptions,...(hasConstruction?[constructionNotice]:[]),notice],visualReview:{status:'passed',attempts:reviews.length,summary:review.summary,recognizedObject:review.recognizedObject,reviews},...(data.perception?{perception:data.perception}:{})};
    }
    if(revision>=2){const failure=visualFailure(review,language);if(geometryIssue){failure.code='geometry';failure.message=assistantError('geometry',language).message;}throw failure;}
    revision++;
    task={...task,phase:'revise',candidate:{...candidate,revision,critique:review},feedback:`The actual rendered candidate failed visual review: ${review.summary} ${review.issues.join(' ')}. Original drawing is unchanged. Inspect the candidate image and replace the whole proposal with a recognizable outline preserving all user-specified measurements.`};
  }
}

function visualFailure(review,language) {
  const error=assistantError('visual_review_failed',language);
  error.detail=review?[review.summary,...review.issues].join(' ').slice(0,1400):'';
  error.visualReview=review;return error;
}
export function canSkipRecipeReview(shape,question) {
  if(!isRecipeShape(shape))return false;
  const words=String(question).toLowerCase().replace(/[0-9.,×-]+/g,' ').match(/[\p{L}]+/gu)||[];
  const allowed=new Set(['a','an','the','make','draw','create','add','please','me','silhouette','outline','profile','path','wide','width','high','height','tall','mm','millimetres','millimeters','cm','centimeters','by','x','closed','editable','single','use','built','in','choose','its',shape.recipe]);
  // Contextual/custom/multi-object requests are reviewed even when a recipe is
  // valid; e.g. a butterfly relabelled Dog cannot bypass the identity check.
  return words.includes(shape.recipe)&&words.every(word=>allowed.has(word));
}
function outlineChanged(before,after) {
  if(before?.type!=='path'||after.type!=='path')return false;
  const signature=s=>JSON.stringify({closed:s.closed,smooth:s.smooth,contours:(s.contours||[s.points]).map(c=>c.map(([x,y])=>[+(x/s.width).toFixed(8),+(y/s.height).toFixed(8)]))});
  return signature(before)!==signature(after);
}
function isSimpleGeometryRequest(question,shapes) {
  const text=String(question).toLowerCase();
  if(shapes.some(s=>s.type==='path'))return false;
  const tokens=text.replace(/[0-9.,×-]+/g,' ').match(/[\p{L}]+/gu)||[];
  const names=['rectangle','rect','square','circle','ellipse','line','text','lettering','plate','gear'];
  const allowed=new Set([...names,'a','an','the','make','draw','create','add','please','me','width','wide','height','high','tall','long','length','diameter','radius','with','without','rounded','round','corners','corner','mm','cm','millimetres','millimeters','inches','inch','in','by','x','of','to','and','is','no','horizontal','vertical','diagonal','horizontally','vertically','rectangular','mounting','spur','involute','module','teeth','tooth','bore','pressure','angle','degree','degrees','hole','holes','centre','center','centreline','centerline','centred','centered','each','its','their','nearest','from','end','ends','offset','offsets','two','one','on','square','educational','example']);
  if(tokens.some(w=>names.includes(w))&&tokens.every(w=>allowed.has(w)))return true;
  // Chinese primitive requests: strip only known dimension/command words. Any
  // remaining object name forces visual review rather than trusting its label.
  if(/长方形|矩形|正方形|圆形|椭圆|直线|安装板|板件|齿轮/.test(text))return !text.replace(/长方形|矩形|正方形|圆形|椭圆|直线|安装板|板件|齿轮|毫米|厘米|英寸|不要|圆角|直角|垂直|水平|孔径|边距|模数|压力角|内孔|中心|两个|两端|距|齿|孔|度|宽|高|长|直径|半径|请|画|绘制|一个|一条|的|为|有|\d|[\s.,，。×x：:、-]/g,'');
  return false;
}

const number='([0-9]+(?:\\.[0-9]+)?)';
function measures(text) {
  const unit=/\b(inches|inch|in)\b|英寸/.test(text)?25.4:/\bcm\b|厘米/.test(text)?10:1;
  const pair=text.match(new RegExp(number+'\\s*(?:mm|cm|毫米|厘米|in(?:ch(?:es)?)?)?\\s*(?:x|×|by|乘)\\s*'+number,'i'));
  const width=text.match(new RegExp('(?:width|wide|long|length|宽|长)(?:\\s*(?:is|of|to|为|到))?\\s*'+number,'i'))||text.match(new RegExp(number+'\\s*(?:mm|cm|毫米|厘米|in(?:ch(?:es)?)?)?\\s*(?:wide|long|宽|长)','i'));
  const height=text.match(new RegExp('(?:height|high|tall|高)(?:\\s*(?:is|of|to|为|到))?\\s*'+number,'i'))||text.match(new RegExp(number+'\\s*(?:mm|cm|毫米|厘米|in(?:ch(?:es)?)?)?\\s*(?:high|tall|高)','i'));
  return {unit,width:pair?Number(pair[1])*unit:width?Number(width[1])*unit:undefined,height:pair?Number(pair[2])*unit:height?Number(height[1])*unit:undefined};
}
function localResult(language,reply,operations=[],suggestions=[],assumptions=[],needsInput=false) {
  return {reply,operations,suggestions,assumptions,needsInput,source:'offline'};
}
/** A deliberately limited deterministic helper. This is not a replacement for Qwen. */
export function localAssistant({question,language='en',document,selectedIds=[],history=[],image}) {
  if(typeof question!=='string')return null;
  const say=(en,zh)=>pick(language,en,zh);
  const answer=(en,zh,ops=[],assumptions=[],needsInput=false)=>localResult(language,say(en,zh),ops,[],assumptions,needsInput);
  if(image)return answer('Built-in examples cannot read photos. Connect Qwen vision, or type the measurements and choose a basic shape.','内置示例无法读取照片。请连接 Qwen 视觉功能，或输入尺寸并选择基本图形。',[],[],true);
  const q=question.toLowerCase().trim(),doc=validateDocument(document);
  const selected=selectedIds.map(id=>doc.shapes.find(s=>s.id===id)).filter(Boolean);
  const targets=selected.length?selected:doc.shapes.length===1?doc.shapes:[];
  const safe=(result)=>{applyOperations(doc,result.operations);return result;};
  if(/^(hello|hi|hey|你好|您好)[!！.。\s]*$/.test(q))return answer('What shall we make? Try “a butterfly 100 mm wide” or “a rectangle 80 × 40 mm”. These are built-in examples.','我们来做什么？试试“100 毫米宽的蝴蝶”或“80 × 40 毫米的长方形”。这是内置示例。');
  if(/^(delete|remove|删除|删掉)(?:\s+(?:it|this|selected|selection|它|这个))?[.!。！\s]*$/.test(q)) {
    if(!targets.length)return answer('Select the shapes you want to delete first.','请先选中要删除的图形。',[],[],true);
    return safe(answer('I’ll delete the selected shapes.','将删除选中的图形。',targets.map(s=>({op:'delete',id:s.id}))));
  }
  if(/^(copy|duplicate|复制)(?:\s+(?:it|this|selected|selection|它|这个))?[.!。！\s]*$/.test(q)) {
    if(!targets.length)return answer('Select the shape you want to copy first.','请先选中要复制的图形。',[],[],true);
    return safe(answer('I’ll make a copy, offset 10 mm.','将复制一份，偏移 10 毫米。',targets.map(s=>({op:'duplicate',id:s.id,dx:10,dy:10}))));
  }
  if(/rotate|旋转/.test(q)) {
    const angle=q.match(/-?\d+(?:\.\d+)?/);
    if(!targets.length||!angle)return answer('Select a shape and give an angle, for example “rotate 45 degrees”.','选中图形并输入角度，例如“旋转 45 度”。',[],[],true);
    return safe(answer(`I’ll rotate by ${angle[0]}°.`,`将旋转 ${angle[0]}°。`,targets.map(s=>({op:'update',id:s.id,changes:{rotation:s.rotation+Number(angle[0])}}))));
  }
  if(/\bmove\b|移动/.test(q)) {
    const d=q.match(/-?\d+(?:\.\d+)?/),dir=/left|左/.test(q)?[-1,0]:/right|右/.test(q)?[1,0]:/up|上/.test(q)?[0,-1]:/down|下/.test(q)?[0,1]:null;
    if(!targets.length||!d||!dir)return answer('Select a shape and say a distance and direction, such as “move right 10 mm”.','选中图形并说明距离和方向，例如“向右移动 10 毫米”。',[],[],true);
    const distance=Number(d[0])*measures(q).unit;
    return safe(answer(`I’ll move ${distance} mm.`,`将移动 ${distance} 毫米。`,targets.map(s=>({op:'update',id:s.id,changes:{x:s.x+distance*dir[0],y:s.y+distance*dir[1]}}))));
  }
  const dimensions=measures(q);
  if(targets.length&&/resize|make (?:it|this|them|the selected)|改为|改成|调整/.test(q)&&(dimensions.width||dimensions.height)) {
    if(targets.some(s=>s.type==='gear'))return answer('Use the gear parameters to resize a gear while preserving its tooth geometry.','请用齿轮参数调整大小，以保留齿形。',[],[],true);
    return safe(answer('I’ll update the specified outside dimensions; plate holes keep their sizes and end offsets.','将更新指定的外部尺寸；板件孔径和端距保持不变。',targets.map(s=>({op:'update',id:s.id,changes:{...(dimensions.width?{width:dimensions.width}:{}),...(dimensions.height?{height:dimensions.height}:{})}}))));
  }
  let context=q;
  // A numerical follow-up may complete the immediately preceding basic-shape request.
  if(!/butterfly|heart|tree|fish|rectangle|rect|circle|ellipse|plate|蝴蝶|爱心|心形|树|鱼|矩形|长方形|圆|板/.test(q)&&dimensions.width&&dimensions.height) {
    const previous=history.filter(m=>m.role==='user').at(-1)?.content||'';
    context=String(previous).toLowerCase()+' '+q;
  }
  const size=measures(context),x=20+doc.shapes.length%6*8,y=20+doc.shapes.length%6*8;
  const profile=/butterfly|蝴蝶/.test(context)?'butterfly':/heart|爱心|心形/.test(context)?'heart':/tree|树/.test(context)?'tree':/fish|鱼/.test(context)?'fish':null;
  if(profile) {
    const {name:[en,zh],width:w,height:h}=PROFILE_RECIPES[profile],width=size.width||w,height=size.height||h*(width/w);
    const shape=createShape('path',profileShape(profile,{x,y,width,height},language));
    return safe(answer(`Here is a built-in ${en.toLowerCase()} profile, ${width} × ${Math.round(height*100)/100} mm. Drag its points to reshape it.`,`这是内置${zh}轮廓，${width} × ${Math.round(height*100)/100} 毫米。可拖动节点改变外形。`,[{op:'add',shape}],[say('The outline is a suggested silhouette; the displayed outside dimensions are exact.','轮廓为建议造型；显示的外部尺寸为精确值。')]));
  }
  if(/plate|板件|安装板|底板/.test(context)) {
    const diameter=context.match(new RegExp('(?:diameter|holes?|孔径|孔直径)\\s*(?:of|is|为|[:：])?\\s*'+number,'i'))||context.match(new RegExp(number+'\\s*(?:mm|毫米)?\\s*(?:holes?|孔)','i'));
    const inset=context.match(new RegExp('(?:inset|offset|端距|边距)\\s*(?:of|is|为|[:：])?\\s*'+number,'i'))||context.match(new RegExp(number+'\\s*(?:mm|毫米)?\\s*(?:from (?:each|the) (?:end|edge)|距(?:两端|端部))','i'));
    if(!size.width||!size.height||!diameter||!inset)return answer('For a two-hole plate, tell me width × height, hole diameter, and hole-centre distance from each end. For example: 80 × 40 mm, 5 mm holes, 15 mm from each end.','两孔板需要宽 × 高、孔径，以及孔中心距两端的距离。例如：80 × 40 毫米，孔径 5 毫米，端距 15 毫米。',[],[],true);
    const shape=createShape('plate',{name:say('Mounting plate','安装板'),x,y,width:size.width,height:size.height,provenance:'specified',params:{holeDiameter:Number(diameter[1])*size.unit,edgeInset:Number(inset[1])*size.unit,cornerRadius:0}});
    return safe(answer('I’ll make the plate with two holes centred vertically and the specified end offsets.','将按指定端距制作两孔板，孔在高度方向居中。',[{op:'add',shape}],[say('Square outside corners. Hole centres are on the horizontal centreline.','外部为直角；孔中心在水平中心线上。')]));
  }
  if(/bracket|gear|pulley|garment|dress|建筑|支架|齿轮|皮带轮|服装/.test(context))return answer('This needs project-specific dimensions. Connect Qwen for a design conversation, or use the shape tools and dimension fields.','这需要项目的具体尺寸。请连接 Qwen 进行设计对话，或使用图形工具和尺寸输入框。',[],[],true);
  if(/holes?|slots?|孔|槽/.test(context))return answer('Built-in examples can make a two-hole plate when you specify its width, height, hole diameter, and end offsets. For other hole or slot layouts, connect Qwen or use the manual tools.','内置示例可按宽、高、孔径和端距生成两孔板。其他孔槽布局请连接 Qwen 或使用手动工具。',[],[],true);
  if(/rectangle|rect\b|矩形|长方形/.test(context)) {
    if(!size.width||!size.height)return answer('What width and height? For example, “80 × 40 mm”.','需要多宽、多高？例如“80 × 40 毫米”。',[],[],true);
    return safe(answer(`I’ll draw a ${size.width} × ${size.height} mm rectangle.`,`将绘制 ${size.width} × ${size.height} 毫米的长方形。`,[{op:'add',shape:createShape('rect',{name:say('Rectangle','长方形'),x,y,width:size.width,height:size.height,provenance:'specified'})}]));
  }
  if(/circle|ellipse|圆/.test(context)) {
    const radius=context.match(new RegExp('(?:radius|半径)\\s*(?:of|is|为|[:：])?\\s*'+number,'i'))||context.match(new RegExp(number+'\\s*(?:mm|cm|毫米|厘米|in(?:ch(?:es)?)?)?\\s*(?:radius|半径)','i'));
    const first=context.match(/\d+(?:\.\d+)?/),width=size.width||(radius?Number(radius[1])*size.unit*2:first?Number(first[0])*size.unit:0),height=size.height||width;
    if(!width)return answer('What diameter should the circle have, in mm?','圆的直径是多少毫米？',[],[],true);
    return safe(answer(`I’ll draw a ${width} × ${height} mm ellipse.`,`将绘制 ${width} × ${height} 毫米的圆形。`,[{op:'add',shape:createShape('ellipse',{name:say(width===height?'Circle':'Ellipse',width===height?'圆':'椭圆'),x,y,width,height,provenance:'specified'})}]));
  }
  return null;
}
