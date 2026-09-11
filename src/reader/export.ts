import {PDFDocument,rgb,BlendMode} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfMark} from './types';
export async function exportPdf(bytes:Uint8Array,source:PDFDocumentProxy,pages:number[],marks:PdfMark[]){
  const input=await PDFDocument.load(bytes);
  const output=await PDFDocument.create();
  const copies=await output.copyPages(input,pages.map(p=>p-1));
  for(let index=0;index<copies.length;index++){
    const page=copies[index];output.addPage(page);
    const viewport=(await source.getPage(pages[index])).getViewport({scale:1});
    const point=(x:number,y:number)=>viewport.convertToPdfPoint(x*viewport.width,y*viewport.height);
    for(const mark of marks.filter(m=>m.page===pages[index])){
      const color=rgb(...([1,3,5].map(offset=>parseInt(mark.color.slice(offset,offset+2),16)/255) as [number,number,number]));
      for(const rect of mark.rects){
        const [x1,y1]=point(rect.x,rect.y),[x2,y2]=point(rect.x+rect.width,rect.y+rect.height);
        page.drawRectangle({x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1),color,opacity:.3,blendMode:BlendMode.Multiply});
      }
      for(let p=2;p<mark.points.length;p+=2){
        const [x1,y1]=point(mark.points[p-2],mark.points[p-1]),[x2,y2]=point(mark.points[p],mark.points[p+1]);
        page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},thickness:mark.width*viewport.width/viewport.userUnit,color,opacity:mark.kind==='marker'?.32:1,blendMode:mark.kind==='marker'?BlendMode.Multiply:BlendMode.Normal});
      }
    }
  }
  return output.save();
}
export function downloadPdf(bytes:Uint8Array,name:string){
  const url=URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer],{type:'application/pdf'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
