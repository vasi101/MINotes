import {flattenedStroke} from '../ink';
import type { PdfMark, PdfRect } from './types';
export const clamp = (value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

// Merge adjacent PDF text runs into line bands without joining separate columns.
export function mergeTextRects(rects:PdfRect[]):PdfRect[]{
  const lines:PdfRect[]=[];
  for(const rect of rects.filter(r=>r.width>0&&r.height>0).sort((a,b)=>a.y-b.y||a.x-b.x)){
    const line=lines.find(r=>Math.abs((r.y+r.height/2)-(rect.y+rect.height/2))<Math.min(r.height,rect.height)*.35&&rect.x<=r.x+r.width+Math.max(r.height,rect.height)*1.5&&rect.x+rect.width>=r.x-Math.max(r.height,rect.height)*1.5);
    if(line){const right=Math.max(line.x+line.width,rect.x+rect.width),bottom=Math.max(line.y+line.height,rect.y+rect.height);line.x=Math.min(line.x,rect.x);line.y=Math.min(line.y,rect.y);line.width=right-line.x;line.height=bottom-line.y;}
    else lines.push({...rect});
  }
  return lines;
}

export function getSelectionRects(layer:HTMLElement,selection:Selection){
  const box=layer.getBoundingClientRect();
  if(!box.width||!box.height)return [];
  const rects:PdfRect[]=[];
  for(let index=0;index<selection.rangeCount;index++){
    const range=selection.getRangeAt(index);
    const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode;
      if(!node.textContent?.trim()||!range.intersectsNode(node))continue;
      const part=document.createRange();part.selectNodeContents(node);
      if(node===range.startContainer)part.setStart(node,range.startOffset);
      if(node===range.endContainer)part.setEnd(node,range.endOffset);
      for(const rect of part.getClientRects()){
        const left=clamp(rect.left-box.left,0,box.width),top=clamp(rect.top-box.top,0,box.height);
        const right=clamp(rect.right-box.left,0,box.width),bottom=clamp(rect.bottom-box.top,0,box.height);
        if(right>left+.2&&bottom>top+.2)rects.push({x:left,y:top,width:right-left,height:bottom-top});
      }
    }
  }
  return mergeTextRects(rects).map(r=>({x:r.x/box.width,y:r.y/box.height,width:r.width/box.width,height:r.height/box.height}));
}

export function hitsMark(mark:PdfMark,x:number,y:number,width:number,height:number,radius=7){
  if(mark.rects.some(r=>x>=r.x*width-radius&&x<=(r.x+r.width)*width+radius&&y>=r.y*height-radius&&y<=(r.y+r.height)*height+radius))return true;
  const raw=mark.points.map((n,i)=>n*(i%2?height:width));
  const points=mark.shape?raw:flattenedStroke(raw);
  for(let i=2;i<points.length;i+=2){
    const ax=points[i-2],ay=points[i-1],bx=points[i],by=points[i+1];
    const dx=bx-ax,dy=by-ay,t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1),0,1);
    if(Math.hypot(x-ax-t*dx,y-ay-t*dy)<=radius+mark.width*width/2)return true;
  }
  return false;
}

export function markBounds(mark:PdfMark):PdfRect|null{
  const xs=mark.points.filter((_,i)=>i%2===0),ys=mark.points.filter((_,i)=>i%2===1);
  for(const rect of mark.rects){xs.push(rect.x,rect.x+rect.width);ys.push(rect.y,rect.y+rect.height)}
  if(!xs.length)return null;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const x of xs){left=Math.min(left,x);right=Math.max(right,x)}
  for(const y of ys){top=Math.min(top,y);bottom=Math.max(bottom,y)}
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function translateMark(mark:PdfMark,dx:number,dy:number):PdfMark{
  const bounds=markBounds(mark);if(!bounds)return mark;
  const x=clamp(dx,-bounds.x,1-bounds.x-bounds.width),y=clamp(dy,-bounds.y,1-bounds.y-bounds.height);
  return {...mark,points:mark.points.map((n,i)=>n+(i%2?y:x)),rects:mark.rects.map(rect=>({...rect,x:rect.x+x,y:rect.y+y}))};
}

export function translateMarks(marks:PdfMark[],dx:number,dy:number):PdfMark[]{
  const bounds=marks.map(markBounds).filter((box):box is PdfRect=>!!box);
  if(!bounds.length)return marks;
  const left=Math.min(...bounds.map(b=>b.x)),right=Math.max(...bounds.map(b=>b.x+b.width));
  const top=Math.min(...bounds.map(b=>b.y)),bottom=Math.max(...bounds.map(b=>b.y+b.height));
  const x=clamp(dx,-left,1-right),y=clamp(dy,-top,1-bottom);
  return marks.map(mark=>({...mark,points:mark.points.map((n,i)=>n+(i%2?y:x)),rects:mark.rects.map(rect=>({...rect,x:rect.x+x,y:rect.y+y}))}));
}
