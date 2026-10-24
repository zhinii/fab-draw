import http from 'node:http';
import {readFile,stat,realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MAX_BODY_BYTES,providerConfiguration,validateTask,callQwen,CadError} from './cad-system.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
const sharedOrigins=['https://zhinii.github.io','http://127.0.0.1:4248','http://localhost:4248','http://127.0.0.1:5173','http://localhost:5173'];

export async function loadConfiguration(env=process.env) {
  // Existing Robot Lab configuration is consulted read-only. Never copy its key to the project.
  if(env.ALIBABA_API_KEY)return providerConfiguration(env);
  const path=env.FAB_DRAW_CONFIG||join(homedir(),'.config','bnta-robot-lab','server.json');
  try {
    const info=await stat(path);if(info.size>16000)return null;
    const old=JSON.parse(await readFile(path,'utf8'));
    return providerConfiguration(env,{key:old.key,base:old.base,model:old.model,visionModel:old.visionModel||old.vision_model});
  } catch { return null; }
}
export function createCadServer({config=null,staticRoot=join(root,'dist'),port=4227,fetcher=globalThis.fetch,env=process.env}={}) {
  const trustedOrigins=new Set([...sharedOrigins,`http://127.0.0.1:${port}`,`http://localhost:${port}`]);
  if(env.FAB_DRAW_ORIGIN) {
    try{const u=new URL(env.FAB_DRAW_ORIGIN);if(['http:','https:'].includes(u.protocol)&&u.origin===env.FAB_DRAW_ORIGIN)trustedOrigins.add(u.origin);}catch{}
  }
  let minute=0,total=0,inFlight=0;const clients=new Map();
  const server=http.createServer(async(req,res)=>{
    const origin=req.headers.origin||'';
    const cors=trustedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Alibaba-Base, X-Alibaba-Model'}:{};
    const send=(status,data)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...cors});res.end(JSON.stringify(data));};
    let url;try{url=new URL(req.url,'http://127.0.0.1');}catch{return send(400,{error:'request'});}
    if(url.pathname==='/api/cad') {
      if(req.method==='OPTIONS'){res.writeHead(trustedOrigins.has(origin)?204:403,cors);res.end();return;}
      if(origin&&!trustedOrigins.has(origin))return send(403,{error:'origin'});
      if(req.method==='GET')return send(200,{service:'Fab Draw Qwen connection',configured:!!config,...(config?{model:config.model,visionModel:config.visionModel}:{})});
      if(req.method!=='POST')return send(405,{error:'method'});
      if(req.headers['content-type']?.split(';')[0]!=='application/json')return send(400,{error:'content_type'});
      const authorization=String(req.headers.authorization||''),key=authorization.startsWith('Bearer ')?authorization.slice(7):'';
      if(authorization&&!key)return send(401,{error:'auth'});
      const requestConfig=key?providerConfiguration({}, {key,base:req.headers['x-alibaba-base']||undefined,model:req.headers['x-alibaba-model']||undefined}):config;
      if(!requestConfig)return send(503,{error:'server_configuration'});
      const controller=new AbortController();
      req.on('aborted',()=>controller.abort());res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      let admitted=false;
      try {
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY_BYTES)return send(413,{error:'size'});chunks.push(chunk);}
        let task;try{task=validateTask(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{return send(400,{error:'request'});}
        const now=Math.floor(Date.now()/60000);if(now!==minute){minute=now;total=0;clients.clear();}
        const ip=req.socket.remoteAddress||'unknown',count=clients.get(ip)||0;
        if(inFlight>=3||total>=60||count>=12)return send(429,{error:'rate_limit'});
        clients.set(ip,count+1);total++;inFlight++;admitted=true;
        const result=await callQwen(task,requestConfig,{fetcher,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(55000)])});
        return send(200,result);
      } catch(error) { return send(error instanceof CadError?error.status:502,{error:error instanceof CadError?error.code:controller.signal.aborted?'cancelled':'connection'}); }
      finally { if(admitted)inFlight--; }
    }
    if(!['GET','HEAD'].includes(req.method))return send(405,{error:'method'});
    try {
      const path=decodeURIComponent(url.pathname);
      if(path.includes('\0')||path.split(/[\\/]/).some(part=>part.startsWith('.')))return send(404,{error:'not_found'});
      const base=await realpath(staticRoot),requested=resolve(base,'.'+(path==='/'?'/index.html':path));
      if(requested!==base&&!requested.startsWith(base+sep))return send(404,{error:'not_found'});
      const actual=await realpath(requested);if(actual!==base&&!actual.startsWith(base+sep))return send(404,{error:'not_found'});
      const type=mime[extname(actual).toLowerCase()];if(!type)return send(404,{error:'not_found'});
      const data=await readFile(actual);
      res.writeHead(200,{'Content-Type':type,'Content-Length':data.length,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(req.method==='HEAD'?undefined:data);
    } catch { send(404,{error:'not_found',message:'Build the app with npm run build, then open the root URL.'}); }
  });
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.FAB_DRAW_PORT||4227),bind=process.env.FAB_DRAW_BIND||'127.0.0.1';
  if(!Number.isInteger(port)||port<1024||port>65535||!['127.0.0.1','0.0.0.0'].includes(bind))throw new Error('Use a valid FAB_DRAW_PORT and FAB_DRAW_BIND.');
  const config=await loadConfiguration();
  const server=createCadServer({config,port});
  server.on('error',()=>{console.error('Fab Draw could not start. Check the port and file permissions.');process.exitCode=1;});
  server.listen(port,bind,()=>{console.log(`Fab Draw: http://${bind==='0.0.0.0'?'127.0.0.1':bind}:${port}`);console.log(config?'Qwen connection configured.':'Qwen not configured. Manual tools and built-in examples are available.');});
}
