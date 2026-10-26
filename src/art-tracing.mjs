import {createShape} from './geometry.mjs';

export function traceShapes(trace,{width=100,x=20,y=20,language='en'}={}){
  if(!Number.isFinite(width)||width<1||width>5000)throw Error('Artwork width must be between 1 and 5000 mm.');
  const all=trace.paths.flatMap(p=>p.points),xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),minX=Math.min(...xs),minY=Math.min(...ys),spanX=Math.max(...xs)-minX,spanY=Math.max(...ys)-minY;
  if(spanX<.01)throw Error('This is a vertical stroke. Rotate the photo before tracing to set its size.');
  const scale=width/spanX,groupId='art-'+crypto.randomUUID(),groupName=language==='zh'?'描摹作品':'Traced artwork';
  const shapes=trace.paths.map((path,index)=>{
    const px=path.points.map(p=>p[0]),py=path.points.map(p=>p[1]),left=Math.min(...px),top=Math.min(...py),w=(Math.max(...px)-left)*scale,h=(Math.max(...py)-top)*scale;
    return createShape('path',{name:`${language==='zh'?'线条':'Stroke'} ${index+1}`,groupId,groupName,x:x+(left-minX)*scale,y:y+(top-minY)*scale,width:Math.max(.01,w),height:Math.max(.01,h),points:path.points.map(([a,b])=>[(a-left)*scale,(b-top)*scale]),closed:path.closed,smooth:false,role:trace.mode==='single'?'score':'cut',provenance:'estimated',trace:{mode:trace.mode,version:1}});
  });
  return {shapes,height:spanY*scale,imageTransform:{x:x-minX*scale,y:y-minY*scale,width:trace.width*scale}};
}

export function runTrace(image,options){
  const worker=new Worker(new URL('./trace-worker.mjs',import.meta.url),{type:'module'});
  let timer;
  const result=new Promise((resolve,reject)=>{
    const finish=(error,value)=>{clearTimeout(timer);worker.terminate();error?reject(Error(error)):resolve(value);};
    worker.onmessage=({data})=>finish(data.error,data.result);worker.onerror=()=>finish('Tracing failed. Try a smaller or clearer drawing.');
    timer=setTimeout(()=>finish('Tracing took too long. Try a smaller drawing.'),15000);
    worker.postMessage({image:{data:image.data,width:image.width,height:image.height},options});
  });
  return result;
}
