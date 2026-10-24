import {createShape,applyOperations,validateDocument,shapeBounds,preflight} from './geometry.mjs';
import {validateReply,validateTask,PROVIDER_BASES,DEFAULT_BASE,profileShape,PROFILE_RECIPES} from '../server/cad-system.mjs';

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
  geometry:['The proposed geometry did not pass validation. Nothing changed. Please clarify the dimensions.','建议的几何图形未通过校验，未做任何更改。请明确尺寸。'],
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
export async function checkConnection(connection=DEFAULT_CONNECTION,signal,fetcher=globalThis.fetch) {
  if(connection.mode==='offline'||connection.offline)return {configured:false,verified:false,service:'Built-in examples',source:'offline'};
  const config=endpoint(connection);
  const response=await fetcher(config.url,{method:'GET',cache:'no-store',signal:combinedSignal(signal,12000)});
  let data;try{data=await response.json();}catch{throw new Error('response');}
  if(!response.ok||typeof data?.configured!=='boolean'||typeof data?.service!=='string'||!data.service.includes('Fab Draw'))throw new Error('connection');
  // Health is deliberately free: the provider checks account/key access on the first prompt.
  return {configured:data.configured||Boolean(connection.key),verified:false,service:data.service,model:connection.key&&connection.model?connection.model:typeof data.model==='string'?data.model:undefined,visionModel:typeof data.visionModel==='string'?data.visionModel:undefined,sessionKey:Boolean(connection.key),source:'qwen'};
}
export async function askAssistant(args, {fetcher=globalThis.fetch}={}) {
  const {question,language='en',document,selectedIds=[],history=[],image,connection=DEFAULT_CONNECTION,signal}=args;
  if(signal?.aborted)throw assistantError('cancelled',language);
  if(connection.mode==='offline'||connection.offline) {
    const result=localAssistant(args);
    if(!result)throw assistantError('offline_unknown',language);
    return result;
  }
  let config,task;
  try {
    config=endpoint(connection);
    const doc=validateDocument(document);
    task=validateTask({question,language,document:doc,selectedIds,history:history.slice(-10).filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:String(m.content??m.reply??'').slice(0,4000)})),...(image?{image}:{})});
  } catch(error) { throw assistantError(errors[error.message]?error.message:'geometry',language); }
  const requestSignal=combinedSignal(signal,70000);
  for(let attempt=0;attempt<2;attempt++) {
    let data;
    try {
      const response=await fetcher(config.url,{method:'POST',redirect:'error',headers:config.headers,body:JSON.stringify(task),signal:requestSignal});
      try{data=await response.json();}catch{throw assistantError('response',language);}
      if(!response.ok)throw assistantError(typeof data?.error==='string'?data.error:'connection',language);
    } catch(error) {
      if(signal?.aborted)throw assistantError('cancelled',language);
      if(error.code)throw error;
      throw assistantError('connection',language);
    }
    try {
      const result=validateReply(data,{imageConfirmed:!image||image.confirmed===true,document,language});
      // Atomic validation uses the same model as mouse editing and fabrication export.
      const preview=applyOperations(document,result.operations),beforeIds=new Set(document.shapes.map(s=>s.id)),updatedIds=new Set(result.operations.filter(o=>o.op==='update').map(o=>o.id));
      for(const shape of preview.shapes)if(shape.type==='path'&&(!beforeIds.has(shape.id)||updatedIds.has(shape.id))) {
        const bounds=shapeBounds({...shape,x:0,y:0,rotation:0});
        if(Math.max(Math.abs(bounds.x),Math.abs(bounds.y),Math.abs(bounds.width-shape.width),Math.abs(bounds.height-shape.height))>1e-5)throw new Error('Path points do not match the declared outside dimensions. Set points to start at local 0,0 and span exactly width and height.');
      }
      const introducedError=preflight(preview).find(issue=>issue.severity==='error'&&issue.shapeId&&(!beforeIds.has(issue.shapeId)||updatedIds.has(issue.shapeId)));
      if(introducedError)throw new Error(introducedError.message);
      if(requestSignal.aborted)throw assistantError(signal?.aborted?'cancelled':'connection',language);
      return {...result,source:'qwen',...(data.perception?{perception:data.perception}:{})};
    } catch(error) {
      if(error.code)throw error;
      if(attempt===0){
        task.history=[...task.history.slice(-9),{role:'assistant',content:JSON.stringify(data).slice(0,4000)}];
        task.feedback=`Previous proposal rejected atomically: ${String(error.message).slice(0,500)}. No changes applied. Correct it using the CURRENT document. For crossing outlines, walk once around a single simple boundary; never repeat or touch an internal vertex. Use an available profile recipe for a standard butterfly, heart, tree or fish. Return a question with no operations if dimensions remain unresolved.`;continue;
      }
      const failure=assistantError('geometry',language);failure.detail=String(error.message).slice(0,800);throw failure;
    }
  }
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
