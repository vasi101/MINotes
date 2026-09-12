// Quadratic midpoint smoothing stays inside the input path's local bounds.
// Keep raw points for recognition; use the same curves for display and export.
export function strokePath(points:number[],smooth=true):string {
  if(points.length<4)return '';
  let path=`M ${points[0]} ${points[1]}`;
  if(!smooth||points.length<6){for(let i=2;i<points.length;i+=2)path+=` L ${points[i]} ${points[i+1]}`;return path}
  for(let i=2;i<points.length-2;i+=2)path+=` Q ${points[i]} ${points[i+1]} ${(points[i]+points[i+2])/2} ${(points[i+1]+points[i+3])/2}`;
  return path+` L ${points[points.length-2]} ${points[points.length-1]}`;
}
export function flattenedStroke(points:number[]):number[]{
  if(points.length<6)return points;
  const result=points.slice(0,2);let x=points[0],y=points[1];
  for(let i=2;i<points.length-2;i+=2){
    const cx=points[i],cy=points[i+1],endX=(cx+points[i+2])/2,endY=(cy+points[i+3])/2;
    for(let step=1;step<=8;step++){const t=step/8,u=1-t;result.push(u*u*x+2*u*t*cx+t*t*endX,u*u*y+2*u*t*cy+t*t*endY)}
    x=endX;y=endY;
  }
  return [...result,...points.slice(-2)];
}
