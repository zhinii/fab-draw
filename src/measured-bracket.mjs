// A bounded measured-feature builder, not a general drawing constraint solver.
// All coordinates are local millimetres, with Y down from the top edge.
export const BRACKET_EXAMPLE={family:'rounded-bracket',upperLeftToCentre:35,upperCentreToRight:45,lowerLeftToCentre:40,lowerColumnSpacing:75,leftInset:20,leftVerticalSpacing:90,upperToCentre:75,centreToLowerRight:75,lowerRightToArcCentre:60,smallDiameter:15,centreDiameter:30,topRadius:15,bottomRadius:15,leftRadius:20,diagonalAngle:45,widthReference:110,heightReference:240,topHolesAtArcCentre:true,lowerOffsetToArcCentre:true,basis:'lower'};
const fields=Object.keys(BRACKET_EXAMPLE).filter(k=>typeof BRACKET_EXAMPLE[k]==='number');
export const BRACKET_LABELS={upperLeftToCentre:'Upper: left column → centre',upperCentreToRight:'Upper: centre → right column',lowerLeftToCentre:'Lower: left column → centre',lowerColumnSpacing:'Lower: hole-column spacing',leftInset:'Left edge → left hole centres',leftVerticalSpacing:'Left holes: vertical spacing',upperToCentre:'Top holes → large hole: vertical',centreToLowerRight:'Large hole → lower-right hole: vertical',lowerRightToArcCentre:'Lower-right hole → bottom arc centre',smallDiameter:'Four small holes: diameter',centreDiameter:'Large hole: diameter',topRadius:'Top corner radii',bottomRadius:'Bottom-right radius',leftRadius:'Left transition radius',diagonalAngle:'Diagonal angle · degrees',widthReference:'Overall width REF',heightReference:'Overall height REF'};
export function emptyBracketPlan(){return Object.fromEntries(Object.entries(BRACKET_EXAMPLE).map(([k,v])=>[k,k==='family'?v:k==='basis'?'unresolved':null]));}
const near=(a,b)=>Math.abs(a-b)<1e-6;
const fmt=n=>String(Number(n.toFixed(6)));

export const BRACKET_READ_INSTRUCTION=`For a rounded bracket with a sloping lower edge, four small holes and one large hole, READ FEATURES BEFORE DRAWING. Return operations:[], needsInput:true. Include exactly one <bracket>JSON</bracket> block in reply. JSON keys: family:"rounded-bracket", upperLeftToCentre, upperCentreToRight, lowerLeftToCentre, lowerColumnSpacing, leftInset, leftVerticalSpacing, upperToCentre, centreToLowerRight, lowerRightToArcCentre, smallDiameter, centreDiameter, topRadius, bottomRadius, leftRadius, diagonalAngle, widthReference, heightReference, topHolesAtArcCentre, lowerOffsetToArcCentre. Numeric values are millimetres except diagonalAngle. Preserve conflicting printed values separately. Use null for unreadable or unspecified values. Read arrows/extension-line endpoints, not proximity of text. The top pair are HORIZONTAL distances between hole/large-hole centre lines. LowerRightToArcCentre is vertical from lower-right small-hole centre to the bottom fillet centre level, not the lowest outline point. The two boolean flags indicate whether the drawing establishes those centre-line relationships; use null if uncertain. Do not supply basis or resolve conflicting values. For other part families, reply normally and ask specifically about any conflicting measurements; never silently discard them.`;

export function readBracketPacket(reply){
  const match=String(reply).match(/<bracket>\s*([\s\S]*?)\s*<\/bracket>/i);
  if(!match)return null;
  let p;try{p=JSON.parse(match[1]);}catch{throw Error('The measurement reading was malformed. No drawing was changed.');}
  if(p.family!=='rounded-bracket')throw Error('Unsupported measured part family.');
  const plan={family:p.family,basis:'unresolved'};
  for(const key of fields){const v=p[key];if(v!=null&&(typeof v!=='number'||!Number.isFinite(v)||v<=0||v>10000))throw Error(`Invalid measurement: ${key}`);plan[key]=v??null;}
  for(const key of ['topHolesAtArcCentre','lowerOffsetToArcCentre'])plan[key]=p[key]===true?true:null;
  return plan;
}

export function bracketIssues(p){
  const issues=[];
  for(const k of fields)if(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<=0||p[k]>10000)issues.push(`Please supply ${BRACKET_LABELS[k]} (${k}).`);
  if(p.topHolesAtArcCentre!==true)issues.push('Confirm that the top hole centres lie at the top R15 arc-centre level.');
  if(p.lowerOffsetToArcCentre!==true)issues.push('Confirm that the lower vertical offset ends at the bottom arc-centre level.');
  if(issues.length)return issues;
  if(!near(p.diagonalAngle,45))issues.push('This measured bracket builder currently supports a 45° lower edge only.');
  if(!['lower','upper'].includes(p.basis)){
    if(!near(p.upperLeftToCentre,p.lowerLeftToCentre))issues.push(`Left column → large-hole centre: upper ${p.upperLeftToCentre} mm conflicts with lower ${p.lowerLeftToCentre} mm.`);
    if(!near(p.upperLeftToCentre+p.upperCentreToRight,p.lowerColumnSpacing))issues.push(`Hole-column spacing: upper ${p.upperLeftToCentre} + ${p.upperCentreToRight} = ${p.upperLeftToCentre+p.upperCentreToRight} mm conflicts with lower ${p.lowerColumnSpacing} mm.`);
  }
  const spacing=p.basis==='upper'?p.upperLeftToCentre+p.upperCentreToRight:p.lowerColumnSpacing;
  const width=p.leftInset+spacing+p.topRadius,height=p.topRadius+p.upperToCentre+p.centreToLowerRight+p.lowerRightToArcCentre+p.bottomRadius;
  if(!near(width,p.widthReference))issues.push(`The chosen features imply width ${width} mm, conflicting with ${p.widthReference} REF. Resolve this before drawing.`);
  if(!near(height,p.heightReference))issues.push(`The chosen features imply height ${height} mm, conflicting with ${p.heightReference} REF. Resolve this before drawing.`);
  return issues;
}

export function bracketReport(plan,language='en'){
  const issues=bracketIssues(plan),zh=language==='zh';
  if(!issues.length)try{bracketGeometry(plan);}catch(error){issues.push(error.message);}
  return {reply:issues.length?(zh?'尺寸存在冲突或缺失，尚未生成图形：\n':'Measurements need resolution; no geometry has been created:\n')+issues.join('\n')+(zh?'\n使用下方尺寸，还是上方尺寸？':'\nUse the lower measurements or the upper measurements?'):
    (zh?'已核对五个孔和圆角。采用下方尺寸：':'Five holes and rounded outline checked. Using ')+(plan.basis==='upper'?'upper':'lower')+` dimensions: left column → centre ${plan.basis==='upper'?plan.upperLeftToCentre:plan.lowerLeftToCentre} mm; column spacing ${plan.basis==='upper'?plan.upperLeftToCentre+plan.upperCentreToRight:plan.lowerColumnSpacing} mm. Four Ø${plan.smallDiameter} holes and one Ø${plan.centreDiameter} hole; top R${plan.topRadius}, bottom R${plan.bottomRadius}, left R${plan.leftRadius}; diagonal 45°. Confirm readings to build.`,needsInput:true,operations:[],source:'qwen',measurementPlan:plan,canConfirm:issues.length===0,perception:{imageStatus:'seen'},suggestions:issues.length?['Use the lower dimensions','Use the upper dimensions']:[]};
}

export function resolveBracket(plan,question){
  if(/\b(use|choose|prefer)\b.*\b(lower|bottom)\b|(?:采用|使用).*下方/i.test(question)&&!/\b(not|don't)\b|不要/i.test(question)){
    const values=question.match(/(?:lower|bottom|下方)\s*(\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:and|&|,|和|及)\s*(\d+(?:\.\d+)?)/i);
    return {...plan,basis:'lower',...(values?{lowerLeftToCentre:Number(values[1]),lowerColumnSpacing:Number(values[2])}:{})};
  }
  if(/\b(use|choose|prefer)\b.*\bupper\b|(?:采用|使用).*上方/i.test(question)&&!/\b(not|don't)\b|不要/i.test(question))return {...plan,basis:'upper'};
  return plan;
}

function arc(cx,cy,r,start,end){
  const step=2*Math.acos(1-.01/r)*180/Math.PI,n=Math.max(1,Math.ceil((end-start)/step));
  const angles=Array.from({length:n+1},(_,i)=>start+(end-start)*i/n);
  for(let a=Math.ceil(start/90)*90;a<end;a+=90)angles.push(a);
  return [...new Set(angles)].sort((a,b)=>a-b).map(a=>[cx+r*Math.cos(a*Math.PI/180),cy+r*Math.sin(a*Math.PI/180)]);
}
function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}

export function bracketGeometry(p){
  const issues=bracketIssues(p);if(issues.length)throw Error(issues.join('\n'));
  const span=p.basis==='upper'?p.upperLeftToCentre+p.upperCentreToRight:p.lowerColumnSpacing,offset=p.basis==='upper'?p.upperLeftToCentre:p.lowerLeftToCentre;
  const w=p.leftInset+span+p.topRadius,r=p.topRadius,rb=p.bottomRadius,rl=p.leftRadius;
  const cy=r+p.upperToCentre+p.centreToLowerRight+p.lowerRightToArcCentre,h=cy+rb,bx=w-rb;
  const diagonalIntercept=cy-bx+rb*Math.SQRT2,leftCy=diagonalIntercept-rl*(Math.SQRT2-1);
  if(leftCy<=r||rb>=w/2||rl>=w/2)throw Error('The radii overlap or cannot fit this outline.');
  const bottomTangent=[bx-rb/Math.SQRT2,cy+rb/Math.SQRT2],leftTangent=[rl-rl/Math.SQRT2,leftCy+rl/Math.SQRT2];
  if(bottomTangent[0]<=leftTangent[0])throw Error('The diagonal is too short for the requested radii.');
  let outer=[[r,0],[w-r,0],...arc(w-r,r,r,-90,0).slice(1),[w,cy],...arc(bx,cy,rb,0,135).slice(1),leftTangent,...arc(rl,leftCy,rl,135,180).slice(1),[0,r],...arc(r,r,r,180,270).slice(1)];
  outer=outer.filter((v,i)=>!i||Math.hypot(v[0]-outer[i-1][0],v[1]-outer[i-1][1])>1e-8);outer.pop();
  const holes=[{name:'TL',x:p.leftInset,y:r,d:p.smallDiameter},{name:'TR',x:p.leftInset+span,y:r,d:p.smallDiameter},{name:'BL',x:p.leftInset,y:r+p.leftVerticalSpacing,d:p.smallDiameter},{name:'BR',x:p.leftInset+span,y:r+p.upperToCentre+p.centreToLowerRight,d:p.smallDiameter},{name:'Centre',x:p.leftInset+offset,y:r+p.upperToCentre,d:p.centreDiameter}];
  for(const hole of holes){const c=[hole.x,hole.y];if(!inside(c,outer)||outer.some((a,i)=>distance(c,a,outer[(i+1)%outer.length])<=hole.d/2+.01))throw Error(`${hole.name} hole intersects the rounded outline. Change its position or diameter.`);}
  for(let i=0;i<holes.length;i++)for(let j=i+1;j<holes.length;j++)if(Math.hypot(holes[i].x-holes[j].x,holes[i].y-holes[j].y)<=(holes[i].d+holes[j].d)/2)throw Error('Hole boundaries overlap.');
  const circle=hole=>{const {x,y,d}=hole,r=d/2;return `M ${fmt(x-r)} ${fmt(y)} A ${r} ${r} 0 1 0 ${fmt(x+r)} ${fmt(y)} A ${r} ${r} 0 1 0 ${fmt(x-r)} ${fmt(y)} Z`;};
  const svg=`M ${r} 0 H ${w-r} A ${r} ${r} 0 0 1 ${w} ${r} V ${cy} A ${rb} ${rb} 0 0 1 ${bottomTangent.map(fmt).join(' ')} L ${leftTangent.map(fmt).join(' ')} A ${rl} ${rl} 0 0 1 0 ${fmt(leftCy)} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z ${holes.map(circle).join(' ')}`;
  return {width:w,height:h,holes,outer,svg,contours:[outer,...holes.map(hole=>arc(hole.x,hole.y,hole.d/2,0,360).slice(0,-1))],radii:[{x:r,y:r,r},{x:w-r,y:r,r},{x:bx,y:cy,r:rb},{x:rl,y:leftCy,r:rl}]};
}

const key=s=>JSON.stringify([s.width,s.height,s.points,s.contours,s.closed,s.smooth]);
export function measuredBracketShape(plan,props={}){
  const g=bracketGeometry(plan),s={type:'path',name:'Measured bracket · 5 holes',x:30,y:30,width:g.width,height:g.height,rotation:0,role:'cut',locked:false,provenance:'calculated',points:g.outer,contours:g.contours,closed:true,smooth:false,...props,params:{measuredBracket:structuredClone(plan)}};
  s.params.geometryKey=key(s);return s;
}
export function retainedBracket(shape){
  if(shape.type!=='path'||!shape.params?.measuredBracket||shape.params.geometryKey!==key(shape))return null;
  const g=bracketGeometry(shape.params.measuredBracket);
  return key({...shape,width:g.width,height:g.height,points:g.outer,contours:g.contours,closed:true,smooth:false})===shape.params.geometryKey?g:null;
}
