import {validateDocument,documentBounds,exportSVG} from './geometry.mjs';

// Both panels use the fabrication export's actual paths and transforms. Only
// presentation changes: crop, remove labels, and use monochrome fill/outline.
export function buildReviewSVG(document,shapes) {
  const candidate=validateDocument({...document,shapes});
  if(!candidate.shapes.length)throw new Error('empty_visual_candidate');
  const bounds=documentBounds(candidate,true);
  if(!bounds||bounds.width<0||bounds.height<0||bounds.width+bounds.height<=0)throw new Error('empty_visual_candidate');
  const margin=Math.max(bounds.width,bounds.height)*.055;
  const box=`${bounds.x-margin} ${bounds.y-margin} ${bounds.width+margin*2} ${bounds.height+margin*2}`;
  const exported=exportSVG(candidate,{includeReference:true});
  const content=exported.slice(exported.indexOf('<g '),exported.lastIndexOf('</svg>'))
    .replace(/stroke="#[a-fA-F0-9]+"/g,'stroke="#000000"')
    .replace(/stroke-width="[^"]*"/g,`stroke-width="${Math.max(bounds.width,bounds.height)/550}"`);
  // Filled cut contours show recognition; the second panel reveals small gaps,
  // internal contours and individual lines without changing their geometry.
  const filled=content.replace(/<path\b[^>]*\/>/g,tag=>{
    const id=tag.match(/\bid="([^"]*)"/)?.[1],shape=candidate.shapes.find(s=>s.id.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')===id);
    const closed=shape?.role==='cut'&&!['line','text'].includes(shape.type)&&(shape.type!=='path'||shape.closed);
    return tag.replace('/>',` fill="${closed?'#000000':'none'}"/>`);
  });
  const stripLabels=s=>s.replace(/\s(?:id|data-name|data-provenance|data-operation)="[^"]*"/g,'');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 1024 512"><rect width="1024" height="512" fill="#ffffff"/><svg x="0" width="496" height="512" viewBox="${box}">${stripLabels(filled)}</svg><svg x="528" width="496" height="512" viewBox="${box}">${stripLabels(content)}</svg></svg>`;
}

export async function renderReviewImage({document,shapes,signal}) {
  signal?.throwIfAborted();
  if(!globalThis.document?.createElement||typeof globalThis.Image!=='function')throw new Error('visual_renderer_unavailable');
  const svg=buildReviewSVG(document,shapes),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  const image=new Image();
  try {
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{image.onload=null;image.onerror=null;signal?.removeEventListener('abort',abort);};
      const abort=()=>{cleanup();image.src='';reject(signal.reason||new DOMException('Aborted','AbortError'));};
      image.onload=()=>{cleanup();resolve();};
      image.onerror=()=>{cleanup();reject(new Error('visual_renderer_unavailable'));};
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      image.src=url;
    });
    signal?.throwIfAborted();
    const canvas=globalThis.document.createElement('canvas');canvas.width=1024;canvas.height=512;
    const context=canvas.getContext('2d');if(!context)throw new Error('visual_renderer_unavailable');
    context.fillStyle='#ffffff';context.fillRect(0,0,1024,512);context.drawImage(image,0,0,1024,512);
    const data=canvas.toDataURL('image/png');
    if(data.length>200000)throw new Error('visual_render_too_large');
    return {data,width:1024,height:512};
  } finally {URL.revokeObjectURL(url);}
}
