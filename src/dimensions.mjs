import {applyOperations, validateDocument} from './geometry.mjs';

const fmt=n=>String(Number(n.toFixed(3)));
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

// Dimension references are shape IDs + properties. Values and vector marks are
// regenerated from geometry, so moving, resizing and undo cannot leave stale labels.
export function drawingDimensions(input,{fontSize=2.5}={}) {
  const doc=validateDocument(input),result=[],gap=Math.max(8,fontSize*3),arrow=fontSize*.55;
  for(const s of doc.shapes) {
    if(s.role==='reference'||s.type==='text')continue;
    const {width:w,height:h}=s;
    const world=([x,y])=>{const a=s.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),dx=x-w/2,dy=y-h/2;return[s.x+w/2+dx*c-dy*sn,s.y+h/2+dx*sn+dy*c];};
    const add=(key,value,label,segments,at,property=null,angle=0)=>{
      const rotation=((s.rotation+angle+90)%180+180)%180-90;
      result.push({id:`${s.id}:${key}`,shapeId:s.id,property,value,label,lines:segments.map(line=>line.map(world)),at:world(at),angle:rotation,fontSize,editable:!!property&&!s.locked});
    };
    const linear=(key,a,b,offset,property,vertical=false,label)=>{
      const start=vertical?[offset,a[1]]:[a[0],offset],end=vertical?[offset,b[1]]:[b[0],offset];
      const axis=vertical?[0,1]:[1,0],normal=vertical?[1,0]:[0,1];
      const lines=[[a,[start[0]+normal[0]*2,start[1]+normal[1]*2]],[b,[end[0]+normal[0]*2,end[1]+normal[1]*2]],[start,end]];
      for(const [tip,sign]of [[start,1],[end,-1]])for(const side of [-1,1])lines.push([tip,[tip[0]+axis[0]*arrow*sign+normal[0]*arrow*.45*side,tip[1]+axis[1]*arrow*sign+normal[1]*arrow*.45*side]]);
      const value=Math.abs(vertical?b[1]-a[1]:b[0]-a[0]);
      add(key,value,label||fmt(value),lines,vertical?[offset-fontSize*.6,(a[1]+b[1])/2]:[(a[0]+b[0])/2,offset-fontSize*.6],property,vertical?-90:0);
    };
    if(s.type==='ellipse'&&Math.abs(w-h)<1e-6){
      linear('diameter',[0,h/2],[w,h/2],-gap,'diameter',false,`Ø${fmt(w)}`);
    }else{
      if(w>0)linear('width',[0,0],[w,0],-gap,s.type==='gear'?null:'width');
      if(h>0)linear('height',[w,0],[w,h],w+gap,s.type==='gear'?null:'height',true);
    }
    if(s.type==='plate'){
      const inset=s.params.edgeInset,d=s.params.holeDiameter;
      if(d>0){
        linear('left-inset',[0,h],[inset,h/2],h+gap,'params.edgeInset');
        linear('right-inset',[w-inset,h/2],[w,h],h+gap,'params.edgeInset');
        linear('centre-height',[0,0],[inset,h/2],-gap,null,true);
        const at=[w/2,h*.3],tip=[inset+d/2,h/2],elbow=[w*.38,h*.3+fontSize];
        add('holes',d,`2 × Ø${fmt(d)}`,[[tip,elbow],[elbow,[w*.62,elbow[1]]]],at,'params.holeDiameter');
        for(const cx of [inset,w-inset]){
          const r=d/2+1.5;
          add(`centre-${cx}`,0,'',[[[cx-r,h/2],[cx+r,h/2]],[[cx,h/2-r],[cx,h/2+r]]],[cx,h/2]);
        }
      }
      if(s.params.cornerRadius>0)add('radius',s.params.cornerRadius,`R${fmt(s.params.cornerRadius)}`,[[[0,s.params.cornerRadius],[gap,h*.75]]],[gap+fontSize,h*.75],'params.cornerRadius');
    }
  }
  return result;
}

export function dimensionSVG(dimensions,{interactive=false,color='#d6b878',background='none'}={}) {
  return `<g id="DIMENSIONS" data-layer="dimensions" fill="none" stroke="${color}" stroke-width="0.18" pointer-events="none">${dimensions.map(d=>`<g data-reference="${xml(d.id)}"><path d="${d.lines.map(([a,b])=>`M${a.map(fmt).join(' ')}L${b.map(fmt).join(' ')}`).join(' ')}"/>${d.label?`<text ${interactive&&d.editable?`data-dimension="${xml(d.id)}" tabindex="0" role="button" aria-label="${xml(d.label)} mm, edit dimension" pointer-events="all" style="cursor:pointer"`:''} x="${fmt(d.at[0])}" y="${fmt(d.at[1])}" transform="rotate(${fmt(d.angle)} ${d.at.map(fmt).join(' ')})" font-family="Arial,sans-serif" font-size="${fmt(d.fontSize)}" text-anchor="middle" fill="${color}" stroke="${background}" stroke-width="${fmt(d.fontSize*.25)}" paint-order="stroke">${xml(d.label)}</text>`:''}</g>`).join('')}</g>`;
}

export function editDimension(document,id,value) {
  const d=drawingDimensions(document).find(d=>d.id===id);
  if(!d?.editable)throw Error('This dimension is a measured reference. Edit the shape or its defining dimensions.');
  if(!Number.isFinite(value)||value<=0)throw Error('Enter a positive measurement in millimetres.');
  const changes=d.property==='diameter'?{width:value,height:value}:d.property.startsWith('params.')?{params:{[d.property.slice(7)]:value}}:{[d.property]:value};
  return applyOperations(document,[{op:'update',id:d.shapeId,changes}]);
}
