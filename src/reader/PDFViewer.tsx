import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PDFPage from './PDFPage';
import { clamp } from './geometry';
import { loadPdf, parsePageRange } from './pdf';
import { getPdfFile } from './storage';
import { exportPdf, downloadPdf } from './export';
import ColorPalette, { highlightColors } from './ColorPalette';
import { Icon, IconButton } from '../icons';
import { useStore } from '../store';
import type { PdfMark, ReaderTool } from './types';
import { Sheet } from '../App';
const EMPTY_MARKS: PdfMark[] = [];
interface Props { docId: string; onBack: () => void; onInsertIntoNote?: (id:string,page:number) => void }
export default function PDFViewer({docId,onBack,onInsertIntoNote}:Props) {
  const doc=useStore(state=>state.readDocuments.find(item=>item.id===docId));
  const update=useStore(state=>state.updateReadDocument);
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState('');
  const [base,setBase]=useState({w:595,h:842});
  const [sizes,setSizes]=useState<Record<number,{w:number;h:number}>>({});
  const onSize=useCallback((page:number,w:number,h:number)=>setSizes(prev=>prev[page]?.w===w&&prev[page]?.h===h?prev:{...prev,[page]:{w,h}}),[]);
  const [zoomValue,setZoomValue]=useState<number|null>(doc?.zoom?doc.zoom:null),[available,setAvailable]=useState(600);
  const scale=zoomValue??clamp((available-40)/base.w,.25,4);
  const scaleRef=useRef(scale);scaleRef.current=scale;
  const scroller=useRef<HTMLDivElement>(null),pageRefs=useRef<(HTMLDivElement|null)[]>([]);
  const [active,setActive]=useState(new Set([1,2]));
  const [current,setCurrent]=useState(doc?.lastPage||1);
  const initialPage=useRef(doc?.lastPage||1),restored=useRef(false);
  const [tool,setTool]=useState<ReaderTool>('select'),[color,setColor]=useState(highlightColors[3]);
  const [penWidth,setPenWidth]=useState(3),[markerWidth,setMarkerWidth]=useState(18);
  const [palette,setPalette]=useState(false),[actions,setActions]=useState(false),[extract,setExtract]=useState(false);
  const [range,setRange]=useState(''),[exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false);
  const [marks,setMarks]=useState<PdfMark[]>(doc?.marks||[]);
  const marksRef=useRef(marks);marksRef.current=marks;
  const [past,setPast]=useState<PdfMark[][]>([]),[future,setFuture]=useState<PdfMark[][]>([]);
  const grouped=useMemo(()=>{const map=new Map<number,PdfMark[]>();for(const mark of marks)map.set(mark.page,[...(map.get(mark.page)||[]),mark]);return map},[marks]);
  const view=useRef({zoom:doc?.zoom||0,lastPage:initialPage.current});view.current={zoom:zoomValue??0,lastPage:current};
  const flush=useCallback(()=>update(docId,{marks:marksRef.current,...view.current}),[docId,update]);
  useEffect(()=>{const timer=setTimeout(flush,250);return()=>clearTimeout(timer)},[marks,zoomValue,current,flush]);
  useEffect(()=>{window.addEventListener('beforeunload',flush);return()=>{flush();window.removeEventListener('beforeunload',flush)}},[flush]);
  useEffect(()=>{
    let cancelled=false,task:ReturnType<typeof loadPdf>|undefined;
    update(docId,{lastOpenedAt:new Date().toISOString()});
    (async()=>{try{
      const bytes=await getPdfFile(docId);if(cancelled)return;
      task=loadPdf(bytes);const loaded=await task.promise;if(cancelled)return;
      const viewport=(await loaded.getPage(1)).getViewport({scale:1});if(cancelled)return;
      setBase({w:viewport.width,h:viewport.height});setPdf(loaded);
    }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Unable to open PDF.')}})();
    return()=>{cancelled=true;void task?.destroy()};
  },[docId,update]);
  useEffect(()=>{const root=scroller.current;if(!root)return;const observer=new ResizeObserver(()=>setAvailable(root.clientWidth));observer.observe(root);return()=>observer.disconnect()},[]);
  const anchor=useRef<{index:number;x:number;y:number;cx:number;cy:number}|null>(null);
  const zoom=useCallback((factor:number,cx?:number,cy?:number)=>{
    const root=scroller.current;if(!root)return;const bounds=root.getBoundingClientRect();
    const x=cx??bounds.left+bounds.width/2,y=cy??bounds.top+bounds.height/2;
    let best=0,distance=Infinity;
    pageRefs.current.forEach((element,index)=>{if(!element)return;const rect=element.getBoundingClientRect(),d=Math.max(rect.top-y,y-rect.bottom,0);if(d<distance){best=index;distance=d}});
    const rect=pageRefs.current[best]?.getBoundingClientRect();
    if(rect)anchor.current={index:best,x:(x-rect.left)/rect.width,y:(y-rect.top)/rect.height,cx:x,cy:y};
    const next=clamp(scaleRef.current*factor,.25,4);scaleRef.current=next;setZoomValue(next);
  },[]);
  useLayoutEffect(()=>{const point=anchor.current,root=scroller.current;if(!point||!root)return;const rect=pageRefs.current[point.index]?.getBoundingClientRect();if(rect){root.scrollLeft+=rect.left+rect.width*point.x-point.cx;root.scrollTop+=rect.top+rect.height*point.y-point.cy}anchor.current=null},[scale]);
  useLayoutEffect(()=>{if(!pdf||restored.current)return;restored.current=true;const target=pageRefs.current[Math.min(initialPage.current,pdf.numPages)-1];if(target&&scroller.current)scroller.current.scrollTop=target.offsetTop-20},[pdf]);
  useEffect(()=>{
    const root=scroller.current;if(!root||!pdf)return;let frame=0;
    const measure=()=>{frame=0;const bounds=root.getBoundingClientRect(),near=new Set<number>();let page=1;
      pageRefs.current.forEach((element,index)=>{if(!element)return;const rect=element.getBoundingClientRect();if(rect.bottom>=bounds.top-350&&rect.top<=bounds.bottom+350)near.add(index+1);if(rect.top<=bounds.top+Math.min(120,bounds.height*.25))page=index+1});
      setActive(prev=>prev.size===near.size&&[...near].every(p=>prev.has(p))?prev:near);setCurrent(page);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure)};measure();root.addEventListener('scroll',schedule,{passive:true});
    return()=>{cancelAnimationFrame(frame);root.removeEventListener('scroll',schedule)};
  },[pdf,scale,sizes,available]);
  const go=useCallback((page:number)=>{const target=pageRefs.current[page-1];if(target&&scroller.current){scroller.current.scrollTo({top:target.offsetTop-20,behavior:'auto'});setCurrent(page)}},[]);
  useEffect(()=>{
    const root=scroller.current;if(!root)return;let frame=0,factor=1,x=0,y=0;
    const wheel=(event:WheelEvent)=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();factor*=Math.exp(-event.deltaY*(event.deltaMode===1?16:1)*.002);x=event.clientX;y=event.clientY;if(!frame)frame=requestAnimationFrame(()=>{frame=0;zoom(factor,x,y);factor=1})};
    root.addEventListener('wheel',wheel,{passive:false});return()=>{cancelAnimationFrame(frame);root.removeEventListener('wheel',wheel)};
  },[zoom]);
  const commit=useCallback((next:PdfMark[])=>{const previous=marksRef.current;marksRef.current=next;setPast(stack=>[...stack.slice(-99),previous]);setFuture([]);setMarks(next)},[]);
  const add=useCallback((mark:PdfMark)=>commit([...marksRef.current,mark]),[commit]);
  const erase=useCallback((ids:string[])=>{const next=marksRef.current.filter(mark=>!ids.includes(mark.id));if(next.length!==marksRef.current.length)commit(next)},[commit]);
  const undo=useCallback(()=>{if(!past.length)return;setFuture(stack=>[...stack,marksRef.current]);const next=past[past.length-1];marksRef.current=next;setMarks(next);setPast(stack=>stack.slice(0,-1))},[past]);
  const redo=useCallback(()=>{if(!future.length)return;setPast(stack=>[...stack,marksRef.current]);const next=future[future.length-1];marksRef.current=next;setMarks(next);setFuture(stack=>stack.slice(0,-1))},[future]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.target instanceof HTMLElement&&(event.target.matches('input,textarea')||event.target.isContentEditable)||extract)return;
      if(event.ctrlKey||event.metaKey){
        if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.15)}
        if(event.key==='-'){event.preventDefault();zoom(1/1.15)}
        if(event.key==='0'){event.preventDefault();setZoomValue(null)}
        if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo()}
      }else{
        if(event.key==='PageDown'){event.preventDefault();go(Math.min(current+1,pdf?.numPages||1))}
        if(event.key==='PageUp'){event.preventDefault();go(Math.max(current-1,1))}
        if(event.key==='Escape'){setPalette(false);setActions(false);setTool('select')}
        const shortcuts:Record<string,ReaderTool>={v:'select',h:'highlight',m:'marker',p:'ink',e:'erase'};
        if(shortcuts[event.key.toLowerCase()])setTool(shortcuts[event.key.toLowerCase()]);
      }
    };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[zoom,go,current,pdf,undo,redo,extract]);
  const exportPages=async(all=false)=>{
    if(!pdf||!doc)return;setExporting(true);setExportError('');
    try{flush();const pages=all?Array.from({length:pdf.numPages},(_,i)=>i+1):parsePageRange(range,pdf.numPages);const output=await exportPdf(await getPdfFile(docId),pdf,pages,marksRef.current);downloadPdf(output,`${doc.name}${all?'_annotated':'_extract'}.pdf`);setExtract(false);setActions(false)}catch(e){setExportError(e instanceof Error?e.message:'Unable to export PDF.')}finally{setExporting(false)}
  };
  const back=()=>{flush();onBack()};
  if(!doc)return <div><IconButton icon="back" label="Back to library" onClick={onBack}/><p>Document not found.</p></div>;
  const count=pdf?.numPages||doc.pages;
  return <div className="pdf-viewer">
    <header className="reader-topbar">
      <div className="reader-topbar-left"><IconButton icon="back" label="Back to library" onClick={back}/><span className="reader-doc-name" title={doc.name}>{doc.name}</span></div>
      <div className="reader-page-nav">
        <button className="reader-page-nav-btn" title="Previous page" aria-label="Previous page" disabled={current<=1} onClick={()=>go(current-1)}>&lsaquo;</button>
        <span className="reader-page-indicator">{current} / {count}</span>
        <button className="reader-page-nav-btn" title="Next page" aria-label="Next page" disabled={current>=count} onClick={()=>go(current+1)}>&rsaquo;</button>
      </div>
      <div className="reader-topbar-actions">
        <button className="reader-zoom-btn" aria-label="Zoom out" disabled={scale<=.25} onClick={()=>zoom(1/1.15)}>&minus;</button>
        <button className="reader-zoom-btn reader-zoom-label" aria-label="Reset zoom to fit width" title="Fit to width" onClick={()=>setZoomValue(null)}>{Math.round(scale*100)}%</button>
        <button className="reader-zoom-btn" aria-label="Zoom in" disabled={scale>=4} onClick={()=>zoom(1.15)}>+</button>
        <IconButton icon="more" label="PDF actions" onClick={()=>setActions(value=>!value)}/>
      </div>
    </header>
    {actions&&<div className="reader-actions-menu">
      <button disabled={exporting||!pdf} onClick={()=>exportPages(true)}>Download annotated PDF</button>
      <button disabled={!pdf} onClick={()=>{setRange(String(current));setExtract(true);setActions(false)}}>Extract pages</button>
      {onInsertIntoNote&&<button disabled={!pdf} onClick={()=>{flush();onInsertIntoNote(docId,current)}}>Insert page into note</button>}
    </div>}
    {error&&<p className="reader-error" role="alert">{error}</p>}
    {exportError&&!extract&&<p className="reader-error" role="alert">{exportError}</p>}
    <div className="pdf-scroller" ref={scroller} onPointerDown={()=>{setPalette(false);setActions(false)}}>
      {!pdf&&!error&&<div className="pdf-loading" role="status">Opening PDF...</div>}
      {pdf&&Array.from({length:count},(_,index)=>{
        const page=index+1,size=sizes[page]||base;
        return <div key={page} className="pdf-page-slot" style={{width:size.w*scale,height:size.h*scale}} ref={element=>{pageRefs.current[index]=element}}>
          <PDFPage pdf={pdf} pageNum={page} scale={scale} width={size.w} height={size.h} active={active.has(page)} marks={grouped.get(page)||EMPTY_MARKS} tool={tool} color={color} inkWidth={tool==='marker'?markerWidth:penWidth} onMark={add} onErase={erase} onSize={onSize}/>
        </div>;
      })}
    </div>
    <div className="reader-toolbar" role="toolbar" aria-label="Reader tools">
      <div className="reader-tools">{(['select','highlight','marker','ink','erase'] as ReaderTool[]).map(value=>{
        const label={select:'Select',highlight:'Highlight',marker:'Marker',ink:'Pen',erase:'Eraser'}[value];
        return <button key={value} className={`reader-tool-btn ${tool===value?'active':''}`} aria-label={label} aria-pressed={tool===value} onClick={()=>{setTool(value);setPalette(false)}}>
          <Icon name={value==='select'?'select':value==='highlight'?'format':value==='erase'?'eraser':'draw'} size={22}/><span>{label}</span>
        </button>;
      })}</div>
      <div className="reader-toolbar-right">
        {['highlight','marker','ink'].includes(tool)&&<button className="reader-color-swatch" aria-label="Pick color" style={{background:color}} onClick={()=>setPalette(value=>!value)}/>}
        {(tool==='ink'||tool==='marker')&&<input type="range" className="reader-width-slider" aria-label="Stroke width" min={1} max={30} value={tool==='marker'?markerWidth:penWidth} onChange={event=>(tool==='marker'?setMarkerWidth:setPenWidth)(Number(event.target.value))}/>}
        <IconButton icon="undo" label="Undo" disabled={!past.length} onClick={undo}/><IconButton icon="redo" label="Redo" disabled={!future.length} onClick={redo}/>
      </div>
    </div>
    {palette&&<div className="reader-palette-popup"><ColorPalette color={color} onChange={setColor}/></div>}
    {extract&&<Sheet title="Extract pages" onClose={()=>setExtract(false)}><input aria-label="Page range" placeholder="1, 3-5" value={range} onChange={event=>setRange(event.target.value)}/>{exportError&&<p role="alert">{exportError}</p>}<div className="form-actions"><button className="accent-button" disabled={exporting} onClick={()=>exportPages()}>{exporting?'Exporting...':'Download PDF'}</button></div></Sheet>}
  </div>;
}
