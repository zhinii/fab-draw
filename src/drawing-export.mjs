import {exportSVG as geometrySVG,exportDXF as geometryDXF,validateDocument} from './geometry.mjs';
import {drawingDimensions,dimensionSVG} from './dimensions.mjs';

export function exportSVG(input,{includeDimensions=false,...options}={}) {
  const doc=validateDocument(input),svg=geometrySVG(doc,options);
  if(!includeDimensions)return svg;
  const dimensions=drawingDimensions(doc),points=dimensions.flatMap(d=>[...d.lines.flat(),[d.at[0]-d.label.length*d.fontSize,d.at[1]-d.label.length*d.fontSize],[d.at[0]+d.label.length*d.fontSize,d.at[1]+d.label.length*d.fontSize]]);
  const x=Math.min(0,...points.map(p=>p[0]-4)),y=Math.min(0,...points.map(p=>p[1]-4)),w=Math.max(doc.sheet.width,...points.map(p=>p[0]+4))-x,h=Math.max(doc.sheet.height,...points.map(p=>p[1]+4))-y;
  return svg.replace(/width="[^"]+mm" height="[^"]+mm" viewBox="[^"]+"/,`width="${w}mm" height="${h}mm" viewBox="${x} ${y} ${w} ${h}"`)
    .replace('xmlns="http://www.w3.org/2000/svg"','xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"')
    .replace('</desc>', '</desc>\n  <g id="GEOMETRY" data-layer="geometry" inkscape:groupmode="layer" inkscape:label="Geometry">')
    .replace('</svg>',`</g>\n${dimensionSVG(dimensions,{color:'#665020'}).replace('id="DIMENSIONS"','id="DIMENSIONS" inkscape:groupmode="layer" inkscape:label="Dimensions"')}\n</svg>`);
}

// Portable LINE/TEXT annotations on a separate layer. The saved Fab Draw project
// retains live references; other CAD programs receive a dimensioned snapshot.
export function exportDXF(input,{includeDimensions=false,...options}={}) {
  const doc=validateDocument(input),base=geometryDXF(doc,options);
  if(!includeDimensions)return base;
  const lines=[],pair=(a,b)=>lines.push(String(a),String(b)),layer='DIMENSIONS';
  for(const d of drawingDimensions(doc)){
    for(const [a,b]of d.lines){pair(0,'LINE');pair(100,'AcDbEntity');pair(8,layer);pair(100,'AcDbLine');pair(10,a[0]);pair(20,doc.sheet.height-a[1]);pair(30,0);pair(11,b[0]);pair(21,doc.sheet.height-b[1]);pair(31,0);}
    if(d.label){pair(0,'TEXT');pair(100,'AcDbEntity');pair(8,layer);pair(100,'AcDbText');pair(10,d.at[0]);pair(20,doc.sheet.height-d.at[1]);pair(30,0);pair(40,d.fontSize);pair(1,d.label.replaceAll('Ø','%%c').replaceAll('×','x'));pair(50,-d.angle);pair(72,1);pair(11,d.at[0]);pair(21,doc.sheet.height-d.at[1]);pair(31,0);pair(100,'AcDbText');pair(73,0);}
  }
  return base.replace(/(2\r\nLAYER\r\n70\r\n)(\d+)/,(_,prefix,n)=>prefix+(Number(n)+1))
    .replace('0\r\nENDTAB','0\r\nLAYER\r\n100\r\nAcDbSymbolTableRecord\r\n100\r\nAcDbLayerTableRecord\r\n2\r\nDIMENSIONS\r\n70\r\n0\r\n62\r\n2\r\n6\r\nCONTINUOUS\r\n0\r\nENDTAB')
    .replace('0\r\nENDSEC\r\n0\r\nEOF',lines.join('\r\n')+'\r\n0\r\nENDSEC\r\n0\r\nEOF');
}
