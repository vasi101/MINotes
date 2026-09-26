export type Matrix = [number,number,number,number,number,number];
export const identity:Matrix=[1,0,0,1,0,0];
export function multiply(a:Matrix,b:Matrix):Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
export function inverse(m:Matrix):Matrix {
  const d=m[0]*m[3]-m[1]*m[2];
  return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];
}
export const transformPoint=(m:Matrix,x:number,y:number)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]] as const;
export const svgMatrix=(m:Matrix,w:number,h:number)=>`matrix(${m[0]} ${m[1]*h/w} ${m[2]*w/h} ${m[3]} ${m[4]*w} ${m[5]*h})`;
