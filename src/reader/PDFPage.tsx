import {memo,useEffect,useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {TextLayer,type PDFDocumentProxy,type PDFPageProxy} from 'pdfjs-dist';
import type {PdfMark,ReaderTool} from './types';
import {clamp,getSelectionRects,hitsMark} from './geometry';

type Props={pdf:PDFDocumentProxy;pageNum:number;scale:number;width:number;height:number;active:boolean;marks:PdfMark[];tool:ReaderTool;color:string;inkWidth:number;onMark:(mark:PdfMark)=>void;onErase:(ids:string[])=>void;onSize:(page:number,width:number,height:number)=>void};
function MarkShape({mark,width,height}:{mark:PdfMark;width:number;height:number}){
  const points=mark.points.map((n,i)=>n*(i%2?height:width));
  return <g data-mark-id={mark.id} data-kind={mark.kind} opacity={mark.kind==='ink'?1:.32} style={{mixBlendMode:mark.kind==='ink'?'normal':'multiply'}}>
    {mark.rects.map((r,i)=><rect key={i} x={r.x*width} y={r.y*height} width={r.width*width} height={r.height*height} fill={mark.color}/>)}
    {points.length>=4&&<path d={points.reduce((path,n,i)=>path+(i%2===0?(i===0?'M':'L'):' ')+n+' ','')} fill="none" stroke={mark.color} strokeWidth={mark.width*width} strokeLinecap="round" strokeLinejoin="round"/>}
  </g>;
}

export default memo(function PDFPage({pdf,pageNum,scale,width,height,active,marks,tool,color,inkWidth,onMark,onErase,onSize}:Props){
  const canvasRef=useRef<HTMLCanvasElement>(null),textRef=useRef<HTMLDivElement>(null),pageRef=useRef<PDFPageProxy|null>(null);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[rasterScale,setRasterScale]=useState(scale);
  const [draft,setDraft]=useState<PdfMark|null>(null);
  const draftRef=useRef<PdfMark|null>(null),frame=useRef(0),erased=useRef(new Set<string>());
  const [hiddenMarks,setHiddenMarks]=useState<Set<string>>(new Set());
  const latest=useRef({tool,color,marks,inkWidth});latest.current={tool,color,marks,inkWidth};

  useEffect(()=>{const timer=setTimeout(()=>setRasterScale(scale),160);return()=>clearTimeout(timer)},[scale]);
  // The text layer is built once in page coordinates. Zoom transforms it with the page.
  useEffect(()=>{
    if(!active)return;
    let cancelled=false,textLayer:TextLayer|undefined;
    (async()=>{
      try{
        const page=await pdf.getPage(pageNum);if(cancelled)return;pageRef.current=page;
        const viewport=page.getViewport({scale:1});onSize(pageNum,viewport.width,viewport.height);
        const content=await page.getTextContent();if(cancelled||!textRef.current)return;
        const layer=textRef.current;layer.replaceChildren();
        layer.style.setProperty('--total-scale-factor',String(viewport.scale*viewport.userUnit));
        layer.style.setProperty('--scale-factor','1');
        textLayer=new TextLayer({textContentSource:content,container:layer,viewport});
        await textLayer.render();
        if(!cancelled)layer.dataset.ready='true';
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Unable to read this page.')}
    })();
    return()=>{cancelled=true;textLayer?.cancel();cancelAnimationFrame(frame.current)};
  },[pdf,pageNum,active,onSize]);

  // Render into a detached canvas so the existing page never flashes blank during zoom.
  useEffect(()=>{
    if(!active)return;
    let cancelled=false,task:ReturnType<PDFPageProxy['render']>|undefined;
    (async()=>{
      try{
        const page=await pdf.getPage(pageNum);if(cancelled)return;
        const base=page.getViewport({scale:1});
        const pixelScale=Math.min(rasterScale*Math.min(window.devicePixelRatio||1,2),Math.sqrt(8_000_000/(base.width*base.height)));
        const viewport=page.getViewport({scale:pixelScale});
        const bitmap=document.createElement('canvas');bitmap.width=Math.ceil(viewport.width);bitmap.height=Math.ceil(viewport.height);
        task=page.render({canvas:bitmap,viewport});await task.promise;
        const target=canvasRef.current;if(cancelled||!target)return;
        target.width=bitmap.width;target.height=bitmap.height;target.getContext('2d')!.drawImage(bitmap,0,0);
        target.dataset.renderScale=String(rasterScale);setReady(true);setError('');bitmap.width=bitmap.height=1;
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Unable to render this page.')}
    })();
    return()=>{cancelled=true;task?.cancel()};
  },[pdf,pageNum,rasterScale,active]);

  useLayoutEffect(()=>{
    if(active)return;
    if(canvasRef.current)canvasRef.current.width=canvasRef.current.height=1;
    textRef.current?.replaceChildren();setReady(false);
  },[active]);

  useEffect(()=>{
    if(!active)return;
    let timer:ReturnType<typeof setTimeout>;
    const highlight=()=>{
      clearTimeout(timer);timer=setTimeout(()=>{
        if(latest.current.tool!=='highlight'||!textRef.current)return;
        const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.toString().trim())return;
        const rects=getSelectionRects(textRef.current,selection);if(!rects.length)return;
        onMark({id:crypto.randomUUID(),page:pageNum,kind:'highlight',color:latest.current.color,rects,points:[],width:0,text:selection.toString()});
        // Clear after every page involved in a cross-page selection has collected its rectangles.
        requestAnimationFrame(()=>selection.removeAllRanges());
      },0);
    };
    document.addEventListener('pointerup',highlight);document.addEventListener('keyup',highlight);
    return()=>{clearTimeout(timer);document.removeEventListener('pointerup',highlight);document.removeEventListener('keyup',highlight)};
  },[active,pageNum,onMark]);

  const position=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect();
    return [clamp((event.clientX-rect.left)/rect.width,0,1),clamp((event.clientY-rect.top)/rect.height,0,1)] as const;
  };
  const erase=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const [x,y]=position(event);
    for(const mark of marks)if(hitsMark(mark,x*width,y*height,width,height,8/scale))erased.current.add(mark.id);
    setHiddenMarks(new Set(erased.current));
  };
  const finish=()=>{
    cancelAnimationFrame(frame.current);frame.current=0;
    if(draftRef.current){onMark(draftRef.current);draftRef.current=null;setDraft(null)}
    if(erased.current.size){onErase([...erased.current]);erased.current.clear();setHiddenMarks(new Set())}
  };
  const drawing=tool==='ink'||tool==='marker'||tool==='erase';
  return <div className="pdf-page-container" data-page-number={pageNum} data-active={active} data-rendered={ready} style={{width:width*scale,height:height*scale,minHeight:height*scale}}>
    <div className="pdf-page-surface" style={{width,height,transform:`scale(${scale})`}}>
      <canvas ref={canvasRef} className="pdf-canvas" style={{width,height,visibility:ready?'visible':'hidden'}}/>
      {!ready&&<div className="pdf-page-placeholder">{error?<span role="alert">{error}</span>:pageNum}</div>}
      <div ref={textRef} className="pdf-text-layer textLayer" style={{pointerEvents:drawing?'none':'auto',userSelect:drawing?'none':'text'}}/>
      <svg className="pdf-annotation-layer" viewBox={`0 0 ${width} ${height}`} style={{pointerEvents:drawing?'auto':'none',touchAction:drawing?'none':'auto'}} aria-label={`Annotations on page ${pageNum}`}
        onPointerDown={event=>{
          if(event.button!==0||!drawing)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
          if(tool==='erase'){erase(event);return}
          const [x,y]=position(event);
          draftRef.current={id:crypto.randomUUID(),page:pageNum,kind:tool as 'ink'|'marker',color,rects:[],points:[x,y,x+.00001,y],width:inkWidth/width};setDraft({...draftRef.current});
        }}
        onPointerMove={event=>{
          if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
          if(tool==='erase'){erase(event);return}
          if(!draftRef.current)return;const [x,y]=position(event);draftRef.current.points.push(x,y);
          if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;if(draftRef.current)setDraft({...draftRef.current,points:[...draftRef.current.points]})});
        }}
        onPointerUp={finish} onPointerCancel={()=>{draftRef.current=null;setDraft(null);erased.current.clear();setHiddenMarks(new Set());cancelAnimationFrame(frame.current);frame.current=0}}
      >
        {marks.filter(m=>!hiddenMarks.has(m.id)).map(mark=><MarkShape key={mark.id} mark={mark} width={width} height={height}/>)}
        {draft&&<MarkShape mark={draft} width={width} height={height}/>}
      </svg>
    </div>
  </div>;
});
