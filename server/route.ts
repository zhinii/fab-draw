// Deploy with cad-system.mjs in app/api/cad/. Uses the existing relay's Alibaba secrets.
import { MAX_BODY_BYTES, validateTask, providerConfiguration, callQwen, CadError } from './cad-system.mjs';

const allowedOrigins = new Set(['https://zhinii.github.io', 'http://127.0.0.1:4227', 'http://localhost:4227', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4248', 'http://localhost:4248']);
const clients = new Map<string,{minute:number,count:number}>();
let windowMinute=0,windowCount=0,inFlight=0;
function cors(origin:string) { return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Alibaba-Base, X-Alibaba-Model','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}; }
export async function GET(request:Request) {
  const origin=request.headers.get('origin')||'';
  const config=providerConfiguration(process.env);
  return Response.json({service:'Fab Draw Qwen connection',configured:!!config,...(config?{model:config.model,visionModel:config.visionModel}:{})},{headers:allowedOrigins.has(origin)?cors(origin):{'Cache-Control':'no-store'}});
}
export async function OPTIONS(request:Request) {
  const origin=request.headers.get('origin')||'';
  return new Response(null,{status:allowedOrigins.has(origin)?204:403,headers:allowedOrigins.has(origin)?cors(origin):{}});
}
export async function POST(request:Request) {
  const origin=request.headers.get('origin')||'';
  if(!allowedOrigins.has(origin))return Response.json({error:'origin'},{status:403});
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:cors(origin)});
  // A session key is sent only to this trusted bridge, and is never persisted/logged.
  const auth=request.headers.get('authorization')||'';
  const key=auth.startsWith('Bearer ')?auth.slice(7):'';
  if(auth&&!key)return reply({error:'auth'},401);
  const config=providerConfiguration(process.env,key?{key,base:request.headers.get('x-alibaba-base')||undefined,model:request.headers.get('x-alibaba-model')||undefined}:{});
  if(!config)return reply({error:'server_configuration'},503);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return reply({error:'content_type'},400);
  let admitted=false,stage='body';
  try {
    const reader=request.body?.getReader();if(!reader)return reply({error:'body'},400);
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();return reply({error:'size'},413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let task;try{task=validateTask(JSON.parse(new TextDecoder().decode(bytes)));}catch{return reply({error:'request'},400);}
    const minute=Math.floor(Date.now()/60000);
    if(windowMinute!==minute){windowMinute=minute;windowCount=0;for(const [ip,value]of clients)if(value.minute!==minute)clients.delete(ip);}
    const ip=request.headers.get('cf-connecting-ip')||'unknown',entry=clients.get(ip)||{minute,count:0};
    if(inFlight>=3||windowCount>=60||entry.count>=12)return reply({error:'rate_limit'},429);
    entry.count++;clients.set(ip,entry);windowCount++;inFlight++;admitted=true;
    stage='signal';
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(55000)]);
    stage='provider';
    return reply(await callQwen(task,config,{signal}));
  } catch(error) {
    if(error instanceof CadError)return reply({error:error.code},error.status);
    return reply({error:request.signal.aborted?'cancelled':'connection',stage,kind:error instanceof TypeError?'type':error instanceof SyntaxError?'json':'transport'},502);
  } finally { if(admitted)inFlight--; }
}
