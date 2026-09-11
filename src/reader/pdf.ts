import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;
export function loadPdf(bytes:Uint8Array) {
  return getDocument({data:bytes.slice(), cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/',useWasm:false});
}
export function parsePageRange(value:string,count:number):number[]{
  const pages=new Set<number>();
  for(const part of value.split(',')){
    const match=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if(!match)throw new Error('Enter page numbers or ranges, such as 1, 3-5.');
    const start=Number(match[1]),end=Number(match[2]||match[1]);
    if(start<1||end>count||start>end)throw new Error(`Page numbers must be between 1 and ${count}.`);
    for(let page=start;page<=end;page++)pages.add(page);
  }
  return [...pages].sort((a,b)=>a-b);
}
