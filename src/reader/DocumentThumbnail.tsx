import {useEffect,useRef,useState} from 'react';
import {loadPdf} from './pdf';
import {getPdfFile,getPdfThumbnail,savePdfThumbnail} from './storage';
import {Icon} from '../icons';

// A single rendering queue keeps large folder imports responsive.
let queue:Promise<unknown>=Promise.resolve();
const pending=new Map<string,Promise<Blob>>();
function thumbnail(id:string):Promise<Blob>{
  const existing=pending.get(id);if(existing)return existing;
  const work=queue.then(async()=>{
    const cached=await getPdfThumbnail(id);if(cached)return cached;
    const task=loadPdf(await getPdfFile(id));
    try{
      const pdf=await task.promise,page=await pdf.getPage(1),base=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(480/base.width,320/base.height)});
      const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvas,viewport,background:'#ffffff'}).promise;
      // Capture before destroying the PDF worker and its rendering resources.
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Preview generation failed.')),'image/jpeg',.85));
      canvas.width=canvas.height=1;
      try{await savePdfThumbnail(id,blob)}catch{/* Display the preview even if the cache is full. */}
      return blob;
    }finally{await task.destroy()}
  });
  pending.set(id,work);queue=work.catch(()=>{});
  void work.finally(()=>pending.delete(id)).catch(()=>{});return work;
}
export default function DocumentThumbnail({id,name,legacy}:{id:string;name:string;legacy?:string}){
  const host=useRef<HTMLSpanElement>(null);
  const [source,setSource]=useState(legacy||''),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const element=host.current;if(!element)return;
    let stopped=false,started=false,url:string|undefined;
    const start=()=>{if(started)return;started=true;void thumbnail(id).then(blob=>{
      if(stopped)return;url=URL.createObjectURL(blob);setSource(url);setFailed(false);
    }).catch(()=>{if(!stopped)setFailed(true)})};
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();start()}},{root:element.closest('.reader-home'),rootMargin:'200px'});
    observer.observe(element);
    return()=>{stopped=true;observer.disconnect();if(url)URL.revokeObjectURL(url)};
  },[id]);
  return <span ref={host} className="document-thumbnail" aria-busy={!source&&!failed}>
    {source?<img src={source} alt={`Preview of ${name}`} onError={()=>setSource('')}/>:<Icon name="read" size={44}/>}
  </span>;
}
