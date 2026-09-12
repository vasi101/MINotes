import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import PDFPage from './PDFPage';
import { clamp, translateMark } from './geometry';
import { loadPdf, parsePageRange } from './pdf';
import { getPdfFile } from './storage';
import { exportPdf, downloadPdf } from './export';
import ColorPalette, { highlightColors } from './ColorPalette';
import { Icon, IconButton } from '../icons';
import { useStore } from '../store';
import type { PdfMark, ReaderTool } from './types';
import { Sheet } from '../App';
import Pen from '../Pen';
import RingSettings from './RingSettings';
import ShapePicker,{ShapeIcon} from '../ShapePicker';
import {isShape} from '../shapes';
import {useReaderFullscreen} from './useReaderFullscreen';
const EMPTY_MARKS: PdfMark[] = [];
const TOOL_KEYS: Record<ReaderTool,string> = {text:'',highlight:'H',marker:'M',ink:'P',erase:'E',move:'G','rounded-rectangle':'R',circle:'C',oval:'O',line:'L',triangle:'',diamond:''};
interface Props { docId: string; onBack: () => void; onInsertIntoNote?: (id:string,page:number,marks:PdfMark[]) => void }
export default function PDFViewer({docId,onBack,onInsertIntoNote}:Props) {
  const {element,fullscreen,fullscreenError,enter,exit}=useReaderFullscreen();
  const [showControls,setShowControls]=useState(false),[ringLocked,setRingLocked]=useState(false);
  const [showShapes,setShowShapes]=useState(false),[autoShapes,setAutoShapes]=useState(true);
  const doc=useStore(state=>state.readDocuments.find(item=>item.id===docId));
  const update=useStore(state=>state.updateReadDocument);
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState('');
  const [base,setBase]=useState({w:595,h:842});
  const [sizes,setSizes]=useState<Record<number,{w:number;h:number}>>({});
  const onSize=useCallback((page:number,w:number,h:number)=>setSizes(prev=>prev[page]?.w===w&&prev[page]?.h===h?prev:{...prev,[page]:{w,h}}),[]);
  const [zoomValue,setZoomValue]=useState<number|null>(doc?.zoom?doc.zoom:null),[available,setAvailable]=useState(600);
  const scale=zoomValue??clamp(available/base.w,.25,4);
  const scaleRef=useRef(scale);scaleRef.current=scale;
  const scroller=useRef<HTMLDivElement>(null),pageRefs=useRef<(HTMLDivElement|null)[]>([]);
  const [active,setActive]=useState(new Set([1,2]));
  const [current,setCurrent]=useState(doc?.lastPage||1);
  const initialPage=useRef(doc?.lastPage||1),restored=useRef(false);
  const [selectedMarks,setSelectedMarks]=useState<string[]>([]);
  const copiedMarks=useRef<PdfMark[]>([]);
  const [hasCopiedMarks,setHasCopiedMarks]=useState(false);
  const selectMarks=useCallback((ids:string[],mode:'replace'|'add'|'toggle'='replace')=>{
    setSelectedMarks(previous=>mode==='replace'?ids:mode==='add'?[...new Set([...previous,...ids])]:[...previous.filter(id=>!ids.includes(id)),...ids.filter(id=>!previous.includes(id))]);
  },[]);
  const [tool,setTool]=useState<ReaderTool>('text'),[color,setColor]=useState(highlightColors[3]);
  const [penWidth,setPenWidth]=useState(3),[markerWidth,setMarkerWidth]=useState(18);
  const [palette,setPalette]=useState(false),[actions,setActions]=useState(false),[extract,setExtract]=useState(false);
  const [range,setRange]=useState(''),[exportError,setExportError]=useState(''),[exporting,setExporting]=useState(false);
  const [marks,setMarks]=useState<PdfMark[]>(doc?.marks||[]);
  const ringWidth = useMemo(() => {
    if (tool !== 'move' || !selectedMarks.length) return tool === 'marker' ? markerWidth : penWidth;
    const widths = marks.filter(mark => selectedMarks.includes(mark.id) && mark.kind !== 'highlight').map(mark => Math.round(mark.width * (sizes[mark.page] || base).w));
    if (!widths.length) return penWidth;
    return Math.max(1, Math.min(30, Math.round(widths.reduce((sum, value) => sum + value, 0) / widths.length)));
  }, [base, marks, markerWidth, penWidth, selectedMarks, sizes, tool]);
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
  useLayoutEffect(()=>{if(!pdf||restored.current)return;restored.current=true;const target=pageRefs.current[Math.min(initialPage.current,pdf.numPages)-1];if(target&&scroller.current)scroller.current.scrollTop=target.offsetTop},[pdf]);
  useEffect(()=>{
    const root=scroller.current;if(!root||!pdf)return;let frame=0;
    const measure=()=>{frame=0;const bounds=root.getBoundingClientRect(),near=new Set<number>();let page=1;
      pageRefs.current.forEach((element,index)=>{if(!element)return;const rect=element.getBoundingClientRect();if(rect.bottom>=bounds.top-350&&rect.top<=bounds.bottom+350)near.add(index+1);if(rect.top<=bounds.top+Math.min(120,bounds.height*.25))page=index+1});
      setActive(prev=>prev.size===near.size&&[...near].every(p=>prev.has(p))?prev:near);setCurrent(page);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure)};measure();root.addEventListener('scroll',schedule,{passive:true});
    return()=>{cancelAnimationFrame(frame);root.removeEventListener('scroll',schedule)};
  },[pdf,scale,sizes,available]);
  const go=useCallback((page:number)=>{const target=pageRefs.current[page-1];if(target&&scroller.current){scroller.current.scrollTo({top:target.offsetTop,behavior:'auto'});setCurrent(page)}},[]);
  useEffect(()=>{
    const root=scroller.current;if(!root)return;let frame=0,factor=1,x=0,y=0;
    const wheel=(event:WheelEvent)=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();factor*=Math.exp(-event.deltaY*(event.deltaMode===1?16:1)*.002);x=event.clientX;y=event.clientY;if(!frame)frame=requestAnimationFrame(()=>{frame=0;zoom(factor,x,y);factor=1})};
    root.addEventListener('wheel',wheel,{passive:false});return()=>{cancelAnimationFrame(frame);root.removeEventListener('wheel',wheel)};
  },[zoom]);
  const commit=useCallback((next:PdfMark[])=>{const previous=marksRef.current;marksRef.current=next;setPast(stack=>[...stack.slice(-99),previous]);setFuture([]);setMarks(next)},[]);
  const copySelected=useCallback(()=>{
    const selected=new Set(selectedMarks);
    copiedMarks.current=marksRef.current.filter(mark=>selected.has(mark.id)).map(mark=>({...mark,points:[...mark.points],rects:mark.rects.map(rect=>({...rect}))}));
    setHasCopiedMarks(copiedMarks.current.length>0);
  },[selectedMarks]);
  const pasteSelected=useCallback(()=>{
    if(!copiedMarks.current.length)return;
    const pasted=copiedMarks.current.map(mark=>translateMark({...mark,id:crypto.randomUUID()},.025,.025));
    commit([...marksRef.current,...pasted]);
    setSelectedMarks(pasted.map(mark=>mark.id));
  },[commit]);
  const add=useCallback((mark:PdfMark)=>commit([...marksRef.current,mark]),[commit]);
  const moveMarks=useCallback((changes:PdfMark[])=>{
    const updates=new Map(changes.map(mark=>[mark.id,mark]));
    commit(marksRef.current.map(mark=>updates.get(mark.id)||mark));
  },[commit]);
  const changeColor=useCallback((value:string)=>{
    setColor(value);
    if(tool!=='move'||!selectedMarks.length)return;
    const selected=new Set(selectedMarks);
    const next=marksRef.current.map(mark=>selected.has(mark.id)&&mark.kind!=='highlight'&&mark.color!==value?{...mark,color:value}:mark);
    if(next.some((mark,i)=>mark!==marksRef.current[i]))commit(next);
  },[tool,selectedMarks,commit]);
  const changeWidth=useCallback((value:number)=>{
    const nextValue=Math.max(1,Math.min(30,Math.round(value)));
    if(tool!=='move'||!selectedMarks.length){
      if(tool==='marker')setMarkerWidth(nextValue);else setPenWidth(nextValue);
      return;
    }
    const selected=new Set(selectedMarks);
    const next=marksRef.current.map(mark=>{
      if(!selected.has(mark.id)||mark.kind==='highlight')return mark;
      const pageSize=sizes[mark.page]||base;
      return {...mark,width:nextValue / Math.max(1, pageSize.w)};
    });
    if(next.some((mark,i)=>mark!==marksRef.current[i]))commit(next);
    setMarkerWidth(nextValue);
    setPenWidth(nextValue);
  },[base,commit,selectedMarks,tool,sizes]);
  const erase=useCallback((ids:string[])=>{const next=marksRef.current.filter(mark=>!ids.includes(mark.id));if(next.length!==marksRef.current.length)commit(next)},[commit]);
  const undo=useCallback(()=>{if(!past.length)return;setFuture(stack=>[...stack,marksRef.current]);const next=past[past.length-1];marksRef.current=next;setMarks(next);setPast(stack=>stack.slice(0,-1))},[past]);
  const redo=useCallback(()=>{if(!future.length)return;setPast(stack=>[...stack,marksRef.current]);const next=future[future.length-1];marksRef.current=next;setMarks(next);setFuture(stack=>stack.slice(0,-1))},[future]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.isComposing||event.altKey||event.target instanceof HTMLElement&&(event.target.matches('input,textarea,select')||event.target.isContentEditable)||extract)return;
      if(event.ctrlKey||event.metaKey){
        if(event.key.toLowerCase()==='c'&&tool==='move'&&selectedMarks.length){event.preventDefault();copySelected();return}
        if(event.key.toLowerCase()==='v'&&tool==='move'&&hasCopiedMarks){event.preventDefault();pasteSelected();return}
        if(event.key==='+'||event.key==='='){event.preventDefault();zoom(1.15)}
        if(event.key==='-'){event.preventDefault();zoom(1/1.15)}
        if(event.key==='0'){event.preventDefault();setZoomValue(null)}
        if(event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo()}
      }else{
        if(event.key.toLowerCase()==='f'){event.preventDefault();if(!event.repeat){if(!ringLocked)setShowControls(false);setActions(false);setPalette(false);setShowShapes(false);if(fullscreen)void exit();else void enter()}return;}
        if(event.key.toLowerCase()==='t'){
          event.preventDefault();
          if(!event.repeat){setShowControls(value=>ringLocked?true:!value);setPalette(false);setActions(false)}
          return;
        }
        if(event.key==='PageDown'){event.preventDefault();go(Math.min(current+1,pdf?.numPages||1))}
        if(event.key==='PageUp'){event.preventDefault();go(Math.max(current-1,1))}
        if(event.key==='Escape'){setPalette(false);setActions(false);setShowShapes(false);if(!ringLocked)setShowControls(false);setTool('text');setSelectedMarks([])}
        const shortcuts:Record<string,ReaderTool>={h:'highlight',m:'marker',p:'ink',e:'erase',g:'move',r:'rounded-rectangle',c:'circle',o:'oval',l:'line'};
        if(shortcuts[event.key.toLowerCase()]){event.preventDefault();setTool(shortcuts[event.key.toLowerCase()]);setShowShapes(false);if(!ringLocked)setShowControls(false);setPalette(false);setActions(false)}
      }
    };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[zoom,go,current,pdf,undo,redo,extract,fullscreen,enter,exit,ringLocked,tool,selectedMarks,hasCopiedMarks,copySelected,pasteSelected]);
  const exportPages=async(all=false)=>{
    if(!pdf||!doc)return;setExporting(true);setExportError('');
    try{flush();const pages=all?Array.from({length:pdf.numPages},(_,i)=>i+1):parsePageRange(range,pdf.numPages);const output=await exportPdf(await getPdfFile(docId),pdf,pages,marksRef.current);downloadPdf(output,`${doc.name}${all?'_annotated':'_extract'}.pdf`);setExtract(false);setActions(false)}catch(e){setExportError(e instanceof Error?e.message:'Unable to export PDF.')}finally{setExporting(false)}
  };
  const back=()=>{flush();onBack()};
  if(!doc)return <div><IconButton icon="back" label="Back to library" onClick={onBack}/><p>Document not found.</p></div>;
  const count=pdf?.numPages||doc.pages;
  return <div ref={element} className={`pdf-viewer reader-corner-layout ${fullscreen?'reader-fullscreen':''}`}>
    <div className="reader-back-corner"><IconButton icon="back" label="Back to library" onClick={back}/></div>
    {fullscreenError&&<p className="reader-error" role="alert">{fullscreenError}</p>}
    {actions&&<div className="reader-actions-menu" role="dialog" aria-label="Reading controls">
      <div className="reader-ring-navigation">
        <button className="reader-page-nav-btn" title="Previous page" aria-label="Previous page" disabled={current<=1} onClick={()=>go(current-1)}>&lsaquo;</button>
        <span className="reader-page-indicator">{current} / {count}</span>
        <button className="reader-page-nav-btn" title="Next page" aria-label="Next page" disabled={current>=count} onClick={()=>go(current+1)}>&rsaquo;</button>
      </div>
      <div className="reader-ring-navigation">
        <button aria-label="Zoom out" onClick={()=>zoom(1/1.15)}>&minus;</button>
        <button aria-label="Reset zoom to fit width" title="Fit to width" onClick={()=>setZoomValue(null)}>{Math.round(scale*100)}%</button>
        <button aria-label="Zoom in" onClick={()=>zoom(1.15)}>+</button>
      </div>
      <button aria-keyshortcuts="F" title="Toggle fullscreen (F)" onClick={()=>{if(!ringLocked)setShowControls(false);setActions(false);if(fullscreen)void exit();else void enter()}}>{fullscreen?'Exit fullscreen':'Read fullscreen'}</button>
      <button disabled={exporting||!pdf} onClick={()=>exportPages(true)}>Download annotated PDF</button>
      <button disabled={!pdf} onClick={()=>{setRange(String(current));setExtract(true);setActions(false)}}>Extract pages</button>
      {onInsertIntoNote&&<button disabled={!pdf} onClick={()=>{flush();onInsertIntoNote(docId,current,marksRef.current.filter(mark=>mark.page===current))}}>Insert page into note</button>}
    </div>}
    {error&&<p className="reader-error" role="alert">{error}</p>}
    {exportError&&!extract&&<p className="reader-error" role="alert">{exportError}</p>}
    <div className="pdf-scroller" ref={scroller} onPointerDown={()=>{setPalette(false);setActions(false);setShowShapes(false);if(!ringLocked)setShowControls(false)}}>
      {!pdf&&!error&&<div className="pdf-loading" role="status">Opening PDF...</div>}
      {pdf&&Array.from({length:count},(_,index)=>{
        const page=index+1,size=sizes[page]||base;
        return <div key={page} className="pdf-page-slot" style={{width:size.w*scale,height:size.h*scale}} ref={element=>{pageRefs.current[index]=element}}>
          <PDFPage pdf={pdf} pageNum={page} scale={scale} width={size.w} height={size.h} active={active.has(page)} marks={grouped.get(page)||EMPTY_MARKS} tool={tool} color={color} inkWidth={tool==='marker'?markerWidth:penWidth} selectedIds={selectedMarks} onSelect={selectMarks} onMove={moveMarks} autoShapes={autoShapes} onMark={add} onErase={erase} onSize={onSize}/>
        </div>;
      })}
    </div>
    {tool==='move'&&marks.some(mark=>selectedMarks.includes(mark.id))&&<div className="reader-selection-status" role="status"><span>{marks.filter(mark=>selectedMarks.includes(mark.id)).length} selected</span><button onClick={copySelected} title="Copy selected annotations">Copy</button><button onClick={pasteSelected} disabled={!hasCopiedMarks} title="Paste copied annotations">Paste</button><button onClick={()=>setSelectedMarks([])}>Clear selection</button></div>}
    <div className={`reader-tool-ring ${showControls?'is-open':''}`}>
      {showControls&&<div className="reader-ring-items" role="toolbar" aria-label="Reader tools" style={{transform:`scale(${Math.min(1,Math.max(.55,(available-32)/420),Math.max(.55,(window.innerHeight-32)/420))})`}}>
        <RingSettings color={color} onColor={changeColor} width={ringWidth} onWidth={tool==='move'?changeWidth:(tool==='marker'?setMarkerWidth:setPenWidth)} marker={tool==='marker'}/>
        {(['text','highlight','ink','erase','move','shapes'] as const).map((value,index)=>{
          const label={text:'Text',highlight:'Highlight',ink:'Pen',erase:'Eraser',move:'Move',shapes:'Shapes'}[value];
          const angle=index*Math.PI/12;
          return <button key={value} className={`reader-ring-tool ${(tool===value||value==='shapes'&&isShape(tool))?'active':''}`} style={{right:Math.cos(angle)*238,bottom:Math.sin(angle)*238}} aria-label={label} title={value==='shapes'||!TOOL_KEYS[value]?label:`${label} (${TOOL_KEYS[value]})`} aria-keyshortcuts={value==='shapes'||!TOOL_KEYS[value]?undefined:TOOL_KEYS[value]} aria-pressed={tool===value||value==='shapes'&&isShape(tool)} onClick={()=>{if(value==='shapes')setShowShapes(true);else{setTool(value);setShowShapes(false)}if(!ringLocked)setShowControls(false);setPalette(false)}}>
            <span className="reader-ring-art">{value==='move'?<Icon name="move" size={24}/>:value==='shapes'?<ShapeIcon kind={isShape(tool)?tool:'rounded-rectangle'}/>:value==='text'?<Icon name="select" size={23}/>:<Pen kind={value==='highlight'?'Marker':value==='ink'?'Fountain pen':'Eraser'} color={color}/>}</span>
            <span>{label}</span>
          </button>;
        })}
        <div className="reader-ring-history"><button className={`reader-ring-lock ${ringLocked?'is-locked':''}`} aria-label={ringLocked?'Unlock tools wheel':'Lock tools wheel'} aria-pressed={ringLocked} title={ringLocked?'Unlock tools wheel':'Keep tools wheel open'} onClick={()=>setRingLocked(value=>!value)}><Icon name={ringLocked?'lock':'unlock'} size={17}/></button><IconButton icon="undo" label="Undo" disabled={!past.length} onClick={undo}/><IconButton icon="redo" label="Redo" disabled={!future.length} onClick={redo}/></div>
        <button className="reader-ring-color" aria-label="Pick color" title="More color shades" style={{background:color}} onClick={()=>{if(!ringLocked)setShowControls(false);setPalette(true)}}/>
        <button className="reader-ring-options" aria-label="Reading controls" title="Pages, zoom and fullscreen" onClick={()=>{if(!ringLocked)setShowControls(false);setActions(true)}}><Icon name="more" size={24}/></button>
      </div>}
      <button className="reader-ring-toggle" aria-label={showControls?'Close tools':'Open tools'} aria-expanded={showControls} aria-keyshortcuts="T" title={showControls?'Close tools (T)':'Open tools (T)'} onClick={()=>{setShowControls(value=>ringLocked?true:!value);setActions(false);setPalette(false);setShowShapes(false)}}>
        {showControls?<span aria-hidden="true">&times;</span>:isShape(tool)?<ShapeIcon kind={tool}/>:<Icon name={tool==='move'?'move':tool==='text'?'select':tool==='erase'?'eraser':tool==='highlight'?'format':'draw'} size={25}/>} 
      </button>
    </div>
    {showShapes&&<div className="reader-shape-popup"><ShapePicker tool={tool} automatic={autoShapes} onAutomatic={setAutoShapes} onSelect={kind=>{setTool(kind);setShowShapes(false)}}/></div>}
    {palette&&<div className="reader-palette-popup">
      <ColorPalette color={color} onChange={changeColor}/></div>}
    {extract&&<Sheet title="Extract pages" onClose={()=>setExtract(false)}><input aria-label="Page range" placeholder="1, 3-5" value={range} onChange={event=>setRange(event.target.value)}/>{exportError&&<p role="alert">{exportError}</p>}<div className="form-actions"><button className="accent-button" disabled={exporting} onClick={()=>exportPages()}>{exporting?'Exporting...':'Download PDF'}</button></div></Sheet>}
  </div>;
}
