// Geometry-free schema shared by the relay and browser. Coordinates within a
// construction are normalized profile units; only shape's outer box is in mm.
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function keys(value,allowed,label){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error(`construction_${label}_fields`);}
function number(value,min,max,label){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`construction_${label}_number`);return value;}
function name(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`construction_${label}_name`);return value.trim();}

export function validateConstructOperation(operation,{document}={}) {
  keys(operation,['op','shape','parts','targetId'],'operation');
  if(operation.op!=='construct')throw Error('construction_operation');
  const s=operation.shape;keys(s,['name','x','y','width','height','rotation','role','locked','provenance'],'shape');
  if(s.role!==undefined&&s.role!=='cut'||s.locked!==undefined&&s.locked!==false||s.provenance!==undefined&&s.provenance!=='estimated')throw Error('construction_estimated_cut_only');
  const shape={name:name(s.name,300,'shape'),x:number(s.x,-10000,10000,'x'),y:number(s.y,-10000,10000,'y'),width:number(s.width,.01,5000,'width'),height:number(s.height,.01,5000,'height'),rotation:number(s.rotation??0,-36000,36000,'rotation'),role:'cut',locked:false,provenance:'estimated'};
  if(!Array.isArray(operation.parts)||operation.parts.length<1||operation.parts.length>20)throw Error('construction_parts_limit');
  const parts=operation.parts.map((p,index)=>{
    keys(p,['name','type','x','y','width','height','rotation','params','points','closed','smooth','operation'],'part');
    if(!['rect','ellipse','path'].includes(p.type)||!['union','subtract'].includes(p.operation)||index===0&&p.operation!=='union')throw Error('construction_part_type_or_operation');
    const part={name:name(p.name,100,'part'),type:p.type,x:number(p.x,0,100,'part_x'),y:number(p.y,0,100,'part_y'),width:number(p.width,.01,100,'part_width'),height:number(p.height,.01,100,'part_height'),rotation:number(p.rotation??0,-360,360,'part_rotation'),operation:p.operation,params:{}};
    const params=p.params??{};keys(params,p.type==='rect'?['cornerRadius']:[],'params');
    if(p.type==='rect'&&params.cornerRadius!==undefined)part.params.cornerRadius=number(params.cornerRadius,0,Math.min(part.width,part.height)/2,'corner_radius');
    if(p.type==='path') {
      if(p.closed!==true||p.smooth!==undefined&&typeof p.smooth!=='boolean'||!Array.isArray(p.points)||p.points.length<3||p.points.length>16)throw Error('construction_short_closed_path');
      part.points=p.points.map(point=>{if(!Array.isArray(point)||point.length!==2)throw Error('construction_point_pair');return [number(point[0],0,part.width,'point_x'),number(point[1],0,part.height,'point_y')];});
      part.closed=true;part.smooth=p.smooth??false;
    }else if(['points','closed','smooth'].some(k=>p[k]!==undefined))throw Error('construction_part_geometry_fields');
    return part;
  });
  let targetId;
  if(operation.targetId!==undefined) {
    targetId=name(operation.targetId,120,'target');
    if(document){const target=document.shapes?.find(s=>s.id===targetId);if(!target||target.type!=='path'||target.locked)throw Error('construction_target_must_be_unlocked_path');}
  }
  return {op:'construct',shape,parts,...(targetId?{targetId}:{})};
}
