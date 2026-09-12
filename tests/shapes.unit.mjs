import assert from 'node:assert/strict';
import {correctShape,shapePoints} from '../src/shapes.ts';
const ellipse=(rx,ry,turns=1)=>Array.from({length:101},(_,i)=>{
  const angle=i/100*Math.PI*2*turns,noise=Math.sin(i*2.7)*1.2;
  return [200+(rx+noise)*Math.cos(angle),180+(ry+noise)*Math.sin(angle)];
}).flat();
assert.equal(correctShape(ellipse(60,61))?.kind,'circle');
assert.equal(correctShape(ellipse(100,45))?.kind,'oval');
assert.equal(correctShape(ellipse(60,60,2)),null,'Do not convert repeated scribbles');
assert.equal(correctShape(ellipse(60,60,.7)),null,'Do not close open curves');
const rectangle=[20,20,60,21,100,19,150,20,151,50,149,85,150,110,110,109,60,111,20,110,21,80,19,50,20,20];
assert.equal(correctShape(rectangle)?.kind,'rounded-rectangle');
assert.equal(correctShape([10,10,30,10.5,50,11,70,10,90,11,110,10])?.kind,'line');
assert.equal(correctShape([10,10,20,50,30,10,40,50,50,10,60,50,70,10]),null);
assert.equal(correctShape([1,1,1,1,1,1,1,1,1,1,1,1]),null);
for(const kind of ['rounded-rectangle','circle','oval']){
  const points=shapePoints(kind,160,140,20,30);
  assert.deepEqual(points.slice(0,2),points.slice(-2));
  assert(points.every(Number.isFinite));
  const xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1);
  assert(Math.min(...xs)>=20-1e-8&&Math.max(...xs)<=160+1e-8);
  assert(Math.min(...ys)>=30-1e-8&&Math.max(...ys)<=140+1e-8);
  if(kind==='circle')assert(Math.abs(Math.max(...xs)-Math.min(...xs)-(Math.max(...ys)-Math.min(...ys)))<1e-8);
}
console.log('Shape recognition and geometry checks passed (11 cases).');
const roughPolygon=(vertices)=>vertices.slice(0,-1).flatMap((a,index)=>{
  const b=vertices[index+1];return Array.from({length:12},(_,step)=>{
    const t=step/12;return [a[0]+(b[0]-a[0])*t+Math.sin(step*1.7)*.6,a[1]+(b[1]-a[1])*t+Math.cos(step*1.3)*.6];
  }).flat();
}).concat(vertices[0]);
assert.equal(correctShape(roughPolygon([[100,20],[175,145],[25,145],[100,20]]))?.kind,'triangle');
assert.equal(correctShape(roughPolygon([[100,20],[175,100],[100,180],[25,100],[100,20]]))?.kind,'diamond');
assert.equal(correctShape(roughPolygon([[25,20],[175,22],[173,140],[24,138],[25,20]]))?.kind,'rounded-rectangle');
console.log('Noisy freehand triangle, diamond and rectangle checks passed.');
const rotate=(points,angle)=>points.map((value,i)=>i%2===0?value*Math.cos(angle)-points[i+1]*Math.sin(angle):points[i-1]*Math.sin(angle)+value*Math.cos(angle));
assert.equal(correctShape(rotate(rectangle,.52))?.kind,'rounded-rectangle');
assert.equal(correctShape(rotate(ellipse(100,40),.65))?.kind,'oval');
assert.equal(correctShape(roughPolygon([[100,20],[175,145],[25,145],[100,20]]).slice(0,-8))?.kind,'triangle');
console.log('Tilted rectangle, tilted oval and small closure gap checks passed.');
