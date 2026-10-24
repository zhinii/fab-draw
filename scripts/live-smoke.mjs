// Explicit live checks use the deployed relay's server-held key; no key is read locally.
// Health (default) is free. Each other named case sends one Qwen request.
import {readFile} from 'node:fs/promises';
import {newDocument,applyOperations,shapeBounds} from '../src/geometry.mjs';
import {DEFAULT_CONNECTION} from '../src/assistant.mjs';

const choice=process.argv[2]||'health';
const cases={
  butterfly:{question:'Make a butterfly silhouette 100 mm wide. Use a single closed editable path. Choose its height.',language:'en'},
  plate:{question:'Make a rectangular mounting plate 80 x 40 mm, with two 5 mm diameter holes on its horizontal centreline, each hole centre 15 mm from its nearest end. Square corners.',language:'en'},
  zh:{question:'请画一个宽80毫米、高40毫米的长方形，不要圆角。',language:'zh'},
  photo:{question:'Read this dimensioned sketch. List the dimensions and ask me to confirm them before reconstructing it.',language:'en'},
};
if(choice!=='health'&&!cases[choice])throw new Error('Choose health, butterfly, plate, zh, or photo.');
const started=Date.now();
const request=choice==='health'?{method:'GET'}:{method:'POST',headers:{Origin:'https://zhinii.github.io','Content-Type':'application/json'},body:JSON.stringify({...cases[choice],document:newDocument(),selectedIds:[],history:[],...(choice==='photo'?{image:{data:'data:image/png;base64,'+(await readFile(new URL('../outputs/dimensioned-sketch.png',import.meta.url))).toString('base64'),width:900,height:600,confirmed:false}}:{})})};
try {
  const response=await fetch(DEFAULT_CONNECTION.url,{...request,redirect:'error',signal:AbortSignal.timeout(75000)});
  const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data={unparsed:raw.slice(0,1000)};}
  const summary={case:choice,status:response.status,elapsedMs:Date.now()-started,response:data};
  if(response.ok&&Array.isArray(data.operations)) {
    try{summary.geometry=applyOperations(newDocument(),data.operations).shapes.map(s=>({type:s.type,name:s.name,width:s.width,height:s.height,params:s.params,bounds:shapeBounds(s)}));}
    catch(error){summary.geometryError=error.message;process.exitCode=1;}
  }
  console.log(JSON.stringify(summary,null,2));if(!response.ok)process.exitCode=1;
}catch(error){console.log(JSON.stringify({case:choice,elapsedMs:Date.now()-started,error:error.name,message:error.message,cause:error.cause?.code}));process.exitCode=1;}
