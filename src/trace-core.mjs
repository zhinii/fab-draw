import Skeleton from './vendor/skeleton-tracing.mjs';

// Pixel-space geometry only. No provider calls, DOM, or generated SVG input.
export function simplify(points, tolerance = .8) {
  if(points.length<3)return points.map(p=>[...p]);
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const stack=[[0,points.length-1]],sq=tolerance*tolerance;
  while(stack.length){const [a,b]=stack.pop(),[x,y]=points[a],dx=points[b][0]-x,dy=points[b][1]-y,d=dx*dx+dy*dy;let max=sq,index=-1;
    for(let i=a+1;i<b;i++){const p=points[i],t=d?Math.max(0,Math.min(1,((p[0]-x)*dx+(p[1]-y)*dy)/d)):0,dist=(p[0]-x-t*dx)**2+(p[1]-y-t*dy)**2;if(dist>max){max=dist;index=i;}}
    if(index>=0){keep[index]=1;stack.push([a,index],[index,b]);}
  }
  return points.filter((_,i)=>keep[i]).map(p=>[...p]);
}
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const length=p=>p.slice(1).reduce((n,v,i)=>n+distance(v,p[i]),0);

// Walk the actual thinned pixels. Upstream's recursive chunk tracer places
// some endpoints at chunk centres, which bends the ends of straight strokes.
function centrelines(mask,w,h){
  Skeleton.thinningZS(mask,w,h);
  const graph=new Map(),xy=id=>[id%w,Math.floor(id/w)];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)if(mask[y*w+x]){
    const id=y*w+x,edges=[];
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&mask[id+dy*w+dx]){
      // An orthogonal connection already supplies this corner's route.
      if(dx&&dy&&(mask[id+dx]||mask[id+dy*w]))continue;
      edges.push(id+dy*w+dx);
    }
    graph.set(id,edges);
  }
  const representatives=new Map(),coords=new Map();
  for(const [id,edges] of graph)if(edges.length>2&&!representatives.has(id)){
    const cluster=[id];representatives.set(id,id);
    for(let i=0;i<cluster.length;i++)for(const n of graph.get(cluster[i]))if(graph.get(n).length>2&&!representatives.has(n)){representatives.set(n,id);cluster.push(n);}
    coords.set(id,cluster.reduce((sum,n)=>{const p=xy(n);return [sum[0]+p[0]/cluster.length,sum[1]+p[1]/cluster.length];},[0,0]));
  }
  const nodes=new Map();for(const [id,edges]of graph){const root=representatives.get(id)??id;const set=nodes.get(root)||new Set();for(const n of edges){const other=representatives.get(n)??n;if(other!==root)set.add(other);}nodes.set(root,set);}
  const seen=new Set(),paths=[],edgeKey=(a,b)=>a<b?a+':'+b:b+':'+a;
  const walk=(start,next)=>{const ids=[start];let prev=start,cur=next;seen.add(edgeKey(prev,cur));
    for(;;){ids.push(cur);if(cur===start||nodes.get(cur).size!==2)break;const n=[...nodes.get(cur)].find(n=>n!==prev);if(seen.has(edgeKey(cur,n)))break;seen.add(edgeKey(cur,n));prev=cur;cur=n;}
    paths.push({points:ids.map(n=>coords.get(n)||xy(n)),closed:ids.at(-1)===start});
  };
  for(const [id,edges]of nodes)if(edges.size!==2)for(const n of edges)if(!seen.has(edgeKey(id,n)))walk(id,n);
  for(const [id,edges]of nodes)for(const n of edges)if(!seen.has(edgeKey(id,n)))walk(id,n);
  return paths;
}

// Follow oriented pixel boundaries, retaining inner loops (holes) as well.
function outlines(mask,w,h){
  const next=new Map(),stride=w+1,key=(x,y)=>y*stride+x;
  const edge=(x,y,xx,yy)=>{const a=key(x,y),list=next.get(a)||[];list.push(key(xx,yy));next.set(a,list);};
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){
    if(!y||!mask[(y-1)*w+x])edge(x,y,x+1,y);
    if(x===w-1||!mask[y*w+x+1])edge(x+1,y,x+1,y+1);
    if(y===h-1||!mask[(y+1)*w+x])edge(x+1,y+1,x,y+1);
    if(!x||!mask[y*w+x-1])edge(x,y+1,x,y);
  }
  const paths=[];
  while(next.size){const start=next.keys().next().value;let cur=start,prev=null;const points=[];
    do {points.push([cur%stride,Math.floor(cur/stride)]);const choices=next.get(cur);if(!choices?.length)break;
      // At diagonal pixel contacts, turn right to keep touching loops separate.
      let i=0;if(choices.length>1&&prev!==null){const dx=cur%stride-prev%stride,dy=Math.floor(cur/stride)-Math.floor(prev/stride);i=choices.findIndex(n=>dx*(Math.floor(n/stride)-Math.floor(cur/stride))-dy*(n%stride-cur%stride)>0);if(i<0)i=0;}
      const n=choices.splice(i,1)[0];if(!choices.length)next.delete(cur);prev=cur;cur=n;
    }while(cur!==start);
    if(cur===start&&points.length>=3)paths.push({points:[...points,points[0]],closed:true});
  }
  return paths;
}

export function tracePixels({data,width,height},{mode='single',threshold=128,detail=1.2}={}){
  if(!['single','outline'].includes(mode)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1024||height>1024||data?.length!==width*height*4)throw Error('Choose a PNG or JPG drawing up to 1024 pixels per side.');
  if(!Number.isFinite(threshold)||threshold<1||threshold>254||!Number.isFinite(detail)||detail<.1||detail>4)throw Error('Invalid tracing settings.');
  // Padding prevents thinning from preserving the photograph's outer border.
  const w=width+2,h=height+2,mask=new Uint8Array(w*h);let ink=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,a=data[i+3]/255,l=(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722)*a+255*(1-a);if(l<threshold){mask[(y+1)*w+x+1]=1;ink++;}}
  if(!ink)throw Error('No dark lines found. Increase Ink or use a clearer drawing.');
  if(ink>width*height*.6)throw Error('Too much of the photo is dark. Use a light background or lower Ink.');
  let paths=mode==='outline'?outlines(mask,w,h):centrelines(mask,w,h);
  paths=paths.filter(p=>length(p.points)>=5).map(p=>{
    let points=p.points;if(p.closed)points=[...points.slice(0,-1),points[0]];
    points=simplify(points,detail);if(p.closed)points=points.slice(0,-1);
    return {closed:p.closed,points:points.map(([x,y])=>[x-1,y-1])};
  }).filter(p=>p.points.length>=(p.closed?3:2));
  if(!paths.length)throw Error('No usable strokes found. Try a clearer drawing or increase Ink.');
  if(paths.length>60||paths.some(p=>p.points.length>240))throw Error('This drawing has too much detail for an editable trace. Crop it into smaller parts or increase Simplify.',{cause:{pathCount:paths.length,maxPoints:Math.max(...paths.map(p=>p.points.length))}});
  return {mode,paths,width,height};
}
