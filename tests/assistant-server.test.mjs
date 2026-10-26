import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCadServer,loadConfiguration} from '../server/serve.mjs';
import {newDocument} from '../src/geometry.mjs';

test('local server health, controlled provider forwarding, CORS and static isolation',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'fab-draw-server-'));
  await writeFile(join(folder,'index.html'),'<h1>Fab Draw</h1>');await writeFile(join(folder,'.env'),'DO_NOT_SERVE=test');
  let requestCount=0;
  const config={key:'test-only-key',base:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.8-flash',visionModel:'qwen3.7-plus'};
  const server=createCadServer({config,staticRoot:folder,fetcher:async(url,options)=>{
    requestCount++;assert.equal(url,config.base+'/chat/completions');assert.equal(options.headers.Authorization,requestCount===1?'Bearer test-only-key':'Bearer temporary-session-key');
    assert.equal(JSON.parse(options.body).model,requestCount===1?'qwen3.8-flash':'qwen-custom');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({reply:'Hello.',needsInput:false,operations:[]})},finish_reason:'stop'}]}));
  }});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{server.closeAllConnections();server.close();await rm(folder,{recursive:true,force:true});});
  const health=await(await fetch(base+'/api/cad')).json();assert.equal(health.configured,true);assert.ok(!JSON.stringify(health).includes(config.key));
  assert.equal((await fetch(base+'/.env')).status,404);assert.match(await(await fetch(base+'/')).text(),/Fab Draw/);
  const body=JSON.stringify({question:'hello',language:'en',document:newDocument(),selectedIds:[],history:[]});
  const blocked=await fetch(base+'/api/cad',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body});assert.equal(blocked.status,403);assert.equal(requestCount,0);
  const allowed=await fetch(base+'/api/cad',{method:'POST',headers:{Origin:'http://127.0.0.1:4248','Content-Type':'application/json'},body});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:4248');assert.equal((await allowed.json()).source,'qwen');assert.equal(requestCount,1);
  const session=await fetch(base+'/api/cad',{method:'POST',headers:{Origin:'http://127.0.0.1:4248','Content-Type':'application/json',Authorization:'Bearer temporary-session-key','X-Alibaba-Base':config.base,'X-Alibaba-Model':'qwen-custom'},body});assert.equal(session.status,200);assert.equal(requestCount,2);
  const maliciousBase=await fetch(base+'/api/cad',{method:'POST',headers:{Origin:'http://127.0.0.1:4248','Content-Type':'application/json',Authorization:'Bearer temporary-session-key','X-Alibaba-Base':'https://attacker.example/compatible-mode/v1'},body});assert.equal(maliciousBase.status,503);assert.equal(requestCount,2);
});
test('configuration reuse is read-only and never leaks keys',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'fab-draw-config-')),path=join(folder,'server.json');
  try {
    const data=JSON.stringify({key:'test-only-key',base:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.8-flash'});await writeFile(path,data);
    const config=await loadConfiguration({FAB_DRAW_CONFIG:path});assert.equal(config.key,'test-only-key');assert.equal(config.visionModel,'qwen3.8-max');
    const override=await loadConfiguration({FAB_DRAW_CONFIG:path,ALIBABA_API_KEY:'env-only-key'});assert.equal(override.key,'env-only-key');
    const missing=await loadConfiguration({FAB_DRAW_CONFIG:join(folder,'missing.json')});assert.equal(missing,null);
  } finally { await rm(folder,{recursive:true,force:true}); }
});
