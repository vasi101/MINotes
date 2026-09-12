export type ShapeKind = 'rounded-rectangle' | 'circle' | 'oval' | 'line' | 'triangle' | 'diamond';
export const shapeNames:Record<ShapeKind,string>={'rounded-rectangle':'Rounded rectangle',circle:'Circle',oval:'Oval',line:'Line',triangle:'Triangle',diamond:'Diamond'};
export const isShape=(value:string):value is ShapeKind=>Object.hasOwn(shapeNames,value);
export function shapePoints(kind:ShapeKind,x1:number,y1:number,x2:number,y2:number):number[]{
  if(kind==='line')return [x1,y1,x2,y2];
  let left=Math.min(x1,x2),top=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1);
  if(kind==='circle'){const size=Math.min(w,h);left=x2<x1?x1-size:x1;top=y2<y1?y1-size:y1;w=h=size}
  if(kind==='triangle')return [left+w/2,top,left+w,top+h,left,top+h,left+w/2,top];
  if(kind==='diamond')return [left+w/2,top,left+w,top+h/2,left+w/2,top+h,left,top+h/2,left+w/2,top];
  const points:number[]=[];
  if(kind==='rounded-rectangle'){
    const r=Math.min(w,h)*.1;
    for(const [cx,cy,start] of [[left+w-r,top+r,-Math.PI/2],[left+w-r,top+h-r,0],[left+r,top+h-r,Math.PI/2],[left+r,top+r,Math.PI]]){
      for(let i=0;i<=12;i++){const angle=start+i*Math.PI/24;points.push(cx+r*Math.cos(angle),cy+r*Math.sin(angle))}
    }
  }else for(let i=0;i<96;i++){const angle=i*Math.PI/48;points.push(left+w/2+Math.cos(angle)*w/2,top+h/2+Math.sin(angle)*h/2)}
  return [...points,points[0],points[1]];
}
// Sample evenly along the path so pointer speed cannot bias recognition.
function resample(points:number[],count=64){
  const distance=[0];for(let i=2;i<points.length;i+=2)distance.push(distance[distance.length-1]+Math.hypot(points[i]-points[i-2],points[i+1]-points[i-1]));
  const total=distance[distance.length-1],sample:number[]=[];let segment=1;
  for(let i=0;i<count;i++){const target=total*i/(count-1);while(segment<distance.length-1&&distance[segment]<target)segment++;const t=(target-distance[segment-1])/(distance[segment]-distance[segment-1]||1);sample.push(points[(segment-1)*2]+(points[segment*2]-points[(segment-1)*2])*t,points[(segment-1)*2+1]+(points[segment*2+1]-points[(segment-1)*2+1])*t)}
  return {sample,total};
}
function simplifyPath(points:number[][],tolerance:number):number[][]{
  if(points.length<=2)return points;
  const first=points[0],last=points[points.length-1],dx=last[0]-first[0],dy=last[1]-first[1],length=dx*dx+dy*dy;
  let farthest=0,index=0;
  for(let i=1;i<points.length-1;i++){
    const t=length?Math.max(0,Math.min(1,((points[i][0]-first[0])*dx+(points[i][1]-first[1])*dy)/length)):0;
    const distance=Math.hypot(points[i][0]-first[0]-dx*t,points[i][1]-first[1]-dy*t);
    if(distance>farthest){farthest=distance;index=i}
  }
  if(farthest<=tolerance)return [first,last];
  return [...simplifyPath(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyPath(points.slice(index),tolerance)];
}
function recognizeShape(points:number[]):{kind:ShapeKind;points:number[]}|null{
  if(points.length<12||points.some(n=>!Number.isFinite(n)))return null;
  const {sample,total}=resample(points);if(total<40)return null;
  const first=[points[0],points[1]],last=points.slice(-2),dx=last[0]-first[0],dy=last[1]-first[1],chord=Math.hypot(dx,dy);
  if(chord>30&&total/chord<1.08){let deviation=0;for(let i=0;i<sample.length;i+=2)deviation=Math.max(deviation,Math.abs(dy*(sample[i]-first[0])-dx*(sample[i+1]-first[1]))/chord);if(deviation<chord*.035)return {kind:'line',points:[...first,...last]}}
  const xs=sample.filter((_,i)=>i%2===0),ys=sample.filter((_,i)=>i%2===1),left=Math.min(...xs),top=Math.min(...ys),w=Math.max(...xs)-left,h=Math.max(...ys)-top;
  if(Math.min(w,h)<18||chord>Math.min(w,h)*.4)return null;
  let ellipseError=0,edgeError=0,turn=0,backtracking=0,previous:number|undefined;
  const corners=[Infinity,Infinity,Infinity,Infinity];
  for(let i=0;i<sample.length;i+=2){
    const x=(sample[i]-left)/w,y=(sample[i+1]-top)/h;
    ellipseError+=(Math.hypot(2*x-1,2*y-1)-1)**2;
    edgeError+=Math.min(x,1-x,y,1-y)**2;
    [[0,0],[1,0],[1,1],[0,1]].forEach(([cx,cy],j)=>corners[j]=Math.min(corners[j],Math.hypot(x-cx,y-cy)));
    const angle=Math.atan2(2*y-1,2*x-1);if(previous!==undefined){const delta=Math.atan2(Math.sin(angle-previous),Math.cos(angle-previous));turn+=delta;backtracking+=Math.abs(delta)}previous=angle;
  }
  // Require one complete circuit; reject scribbles, spirals and repeated loops.
  if(Math.abs(turn)<5.25||Math.abs(turn)>6.8||backtracking>7.5)return null;
  const n=sample.length/2,perimeter=2*(w+h);
  if(Math.sqrt(edgeError/n)<.045&&corners.every(d=>d<.16)&&total>perimeter*.8&&total<perimeter*1.18)
    return {kind:'rounded-rectangle',points:shapePoints('rounded-rectangle',left,top,left+w,top+h)};
  const circumference=Math.PI*(3*(w+h)/2-Math.sqrt((3*w+h)*(w+3*h))/2);
  if(Math.sqrt(ellipseError/n)<.1&&total>circumference*.85&&total<circumference*1.2){
    const kind=w/h>.9&&w/h<1.1?'circle':'oval';const size=(w+h)/2;
    return {kind,points:kind==='circle'?shapePoints(kind,left+(w-size)/2,top+(h-size)/2,left+(w+size)/2,top+(h+size)/2):shapePoints(kind,left,top,left+w,top+h)};
  }
  // A diamond has four straight sides crossing the midpoints of its bounds.
  let diamondError=0;
  for(let i=0;i<sample.length;i+=2)diamondError+=(Math.abs((sample[i]-left)/w*2-1)+Math.abs((sample[i+1]-top)/h*2-1)-1)**2;
  if(Math.sqrt(diamondError/n)<.09)return {kind:'diamond',points:shapePoints('diamond',left,top,left+w,top+h)};
  const vertices=Array.from({length:n},(_,i)=>[sample[i*2],sample[i*2+1]]);
  let start=0;vertices.forEach((point,i)=>{if(Math.hypot(point[0]-left-w/2,point[1]-top-h/2)>Math.hypot(vertices[start][0]-left-w/2,vertices[start][1]-top-h/2))start=i});
  const rotated=[...vertices.slice(start),...vertices.slice(0,start)];rotated.push(rotated[0]);
  const polygon=simplifyPath(rotated,Math.min(w,h)*.075);
  if(polygon.length===5){
    const corners=polygon.slice(0,4),edges=corners.map((point,i)=>{const next=corners[(i+1)%4];return [next[0]-point[0],next[1]-point[1]]});
    const lengths=edges.map(edge=>Math.hypot(...edge));
    const perpendicular=edges.every((edge,i)=>Math.abs((edge[0]*edges[(i+1)%4][0]+edge[1]*edges[(i+1)%4][1])/(lengths[i]*lengths[(i+1)%4]))<.38);
    if(perpendicular&&Math.max(lengths[0],lengths[2])/Math.min(lengths[0],lengths[2])<1.4&&Math.max(lengths[1],lengths[3])/Math.min(lengths[1],lengths[3])<1.4){
      const cx=corners.reduce((sum,p)=>sum+p[0],0)/4,cy=corners.reduce((sum,p)=>sum+p[1],0)/4;
      const ux=edges[0][0]-edges[2][0],uy=edges[0][1]-edges[2][1],length=Math.hypot(ux,uy),cos=ux/length,sin=uy/length;
      const halfW=(lengths[0]+lengths[2])/4,halfH=(lengths[1]+lengths[3])/4;
      const local=shapePoints('rounded-rectangle',-halfW,-halfH,halfW,halfH),fitted:number[]=[];
      for(let i=0;i<local.length;i+=2)fitted.push(cx+local[i]*cos-local[i+1]*sin,cy+local[i]*sin+local[i+1]*cos);
      return {kind:'rounded-rectangle',points:fitted};
    }
  }
  if(polygon.length===4){
    const [a,b,c]=polygon,area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
    const perimeter=Math.hypot(a[0]-b[0],a[1]-b[1])+Math.hypot(b[0]-c[0],b[1]-c[1])+Math.hypot(c[0]-a[0],c[1]-a[1]);
    if(area>w*h*.25&&total/perimeter<1.15)return {kind:'triangle',points:polygon.flat()};
  }
  return null;
}

export function correctShape(points:number[]):{kind:ShapeKind;points:number[]}|null{
  const direct=recognizeShape(points);if(direct)return direct;
  if(points.length<12||points.some(n=>!Number.isFinite(n)))return null;
  const {sample}=resample(points),n=sample.length/2;
  let cx=0,cy=0;for(let i=0;i<sample.length;i+=2){cx+=sample[i]/n;cy+=sample[i+1]/n}
  let xx=0,yy=0,xy=0;for(let i=0;i<sample.length;i+=2){const x=sample[i]-cx,y=sample[i+1]-cy;xx+=x*x;yy+=y*y;xy+=x*y}
  const angle=Math.atan2(2*xy,xx-yy)/2,cos=Math.cos(angle),sin=Math.sin(angle),local:number[]=[];
  for(let i=0;i<points.length;i+=2){const x=points[i]-cx,y=points[i+1]-cy;local.push(x*cos+y*sin,-x*sin+y*cos)}
  const rotated=recognizeShape(local);
  if(!rotated||!['circle','oval','rounded-rectangle'].includes(rotated.kind))return null;
  const restored:number[]=[];for(let i=0;i<rotated.points.length;i+=2){const x=rotated.points[i],y=rotated.points[i+1];restored.push(cx+x*cos-y*sin,cy+x*sin+y*cos)}
  return {kind:rotated.kind,points:restored};
}
