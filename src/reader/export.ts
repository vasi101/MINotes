import {strokePath} from '../ink';
import {PDFDocument,rgb,BlendMode,LineCapStyle,StandardFonts} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import type {PdfMark} from './types';
export async function exportPdf(bytes:Uint8Array,source:PDFDocumentProxy,pages:number[],marks:PdfMark[]){
  const input=await PDFDocument.load(bytes);
  const output=await PDFDocument.create();
  const font=await output.embedFont(StandardFonts.Helvetica);
  const copies=await output.copyPages(input,pages.map(p=>p-1));
  for(let index=0;index<copies.length;index++){
    const page=copies[index];output.addPage(page);
    const viewport=(await source.getPage(pages[index])).getViewport({scale:1});
    const point=(x:number,y:number)=>viewport.convertToPdfPoint(x*viewport.width,y*viewport.height);
    for(const mark of marks.filter(m=>m.page===pages[index])){
      const color=rgb(...([1,3,5].map(offset=>parseInt(mark.color.slice(offset,offset+2),16)/255) as [number,number,number]));
      if(mark.kind==='text'&&mark.text&&mark.points.length>=2){
        const [x,y]=point(mark.points[0],mark.points[1]);
        const size=Math.max(6,mark.width*viewport.width);
        page.drawText(mark.text,{x,y:page.getHeight()-y-size,font,color,size});
        continue;
      }
      for(const rect of mark.rects){
        const [x1,y1]=point(rect.x,rect.y),[x2,y2]=point(rect.x+rect.width,rect.y+rect.height);
        page.drawRectangle({x:Math.min(x1,x2),y:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1),color,opacity:.3,blendMode:BlendMode.Multiply});
      }
      if(mark.points.length>=4){
        const coordinates:number[]=[];
        for(let p=0;p<mark.points.length;p+=2){const [x,y]=point(mark.points[p],mark.points[p+1]);coordinates.push(x,-y)}
        page.drawSvgPath(strokePath(coordinates,!mark.shape),{x:0,y:0,borderColor:color,borderWidth:mark.width*viewport.width/viewport.userUnit,borderOpacity:mark.kind==='marker'?.32:1,borderLineCap:LineCapStyle.Round,blendMode:mark.kind==='marker'?BlendMode.Multiply:BlendMode.Normal});
      }
    }
  }
  return output.save();
}
export function downloadPdf(bytes:Uint8Array,name:string){
  const url=URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer],{type:'application/pdf'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
