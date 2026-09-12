import {strokePath} from '../ink';
import {memo,useEffect,useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {TextLayer,type PDFDocumentProxy,type PDFPageProxy} from 'pdfjs-dist';
import type {PdfMark,ReaderTool} from './types';
import {clamp,getSelectionRects,hitsMark,markBounds,translateMarks} from './geometry';
import {isShape,shapePoints,correctShape} from '../shapes';

type Props={pdf:PDFDocumentProxy;pageNum:number;scale:number;width:number;height:number;active:boolean;marks:PdfMark[];tool:ReaderTool;color:string;inkWidth:number;autoShapes:boolean;selectedIds:string[];onSelect:(ids:string[],mode?:'replace'|'add'|'toggle')=>void;onMove:(marks:PdfMark[])=>void;onMark:(mark:PdfMark)=>void;onErase:(ids:string[])=>void;onSize:(page:number,width:number,height:number)=>void};
const MarkShape=memo(function MarkShape({mark,width,height}:{mark:PdfMark;width:number;height:number}){
  const points=mark.points.map((n,i)=>n*(i%2?height:width));
  if(mark.kind==='text'&&mark.text)return <text data-mark-id={mark.id} data-kind={mark.kind} x={points[0]} y={points[1]} fill={mark.color} fontSize={mark.width*width} dominantBaseline="hanging">{mark.text}</text>;
  return <g data-mark-id={mark.id} data-kind={mark.kind} data-shape={mark.shape} opacity={mark.kind==='ink'?1:.32} style={{mixBlendMode:mark.kind==='ink'?'normal':'multiply'}}>
    {mark.rects.map((r,i)=><rect key={i} x={r.x*width} y={r.y*height} width={r.width*width} height={r.height*height} fill={mark.color}/>)}
    {points.length>=4&&<path d={strokePath(points,!mark.shape)} fill="none" stroke={mark.color} strokeWidth={mark.width*width} strokeLinecap="round" strokeLinejoin="round"/>}
  </g>;
});

export default memo(function PDFPage({pdf,pageNum,scale,width,height,active,marks,tool,color,inkWidth,autoShapes,selectedIds,onSelect,onMove,onMark,onErase,onSize}:Props){
  const canvasRef=useRef<HTMLCanvasElement>(null),textRef=useRef<HTMLDivElement>(null),pageRef=useRef<PDFPageProxy|null>(null);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[rasterScale,setRasterScale]=useState(scale);
  const [draft,setDraft]=useState<PdfMark|null>(null);
  const moving=useRef<{marks:PdfMark[];x:number;y:number;next:PdfMark[]}|null>(null);
  const marquee=useRef<{x:number;y:number;endX:number;endY:number;add:boolean}|null>(null);
  const [selectionArea,setSelectionArea]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  const [movePreview,setMovePreview]=useState<PdfMark[]>([]),[textDraft,setTextDraft]=useState<{x:number;y:number;value:string}|null>(null);
  const strokeStart=useRef<[number,number]>([0,0]);
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
  const move=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const gesture=moving.current;if(!gesture)return;
    const [x,y]=position(event);gesture.next=translateMarks(gesture.marks,x-gesture.x,y-gesture.y);
    if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;setMovePreview(moving.current?.next||[])});
  };
  const resizeSelection=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const box=marquee.current;if(!box)return;
    [box.endX,box.endY]=position(event);
    setSelectionArea({x:Math.min(box.x,box.endX),y:Math.min(box.y,box.endY),width:Math.abs(box.endX-box.x),height:Math.abs(box.endY-box.y)});
  };
  const collect=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const mark=draftRef.current;if(!mark)return;
    const rect=event.currentTarget.getBoundingClientRect();
    const native=event.nativeEvent;
    const samples=[...(native.getCoalescedEvents?.()||[]),native];
    for(const sample of samples){
      const x=clamp((sample.clientX-rect.left)/rect.width,0,1),y=clamp((sample.clientY-rect.top)/rect.height,0,1);
      if(mark.shape)mark.points=shapePoints(mark.shape,...strokeStart.current,x*width,y*height).map((n,i)=>n/(i%2?height:width));
      else {
        const end=mark.points.length;
        if(Math.hypot((x-mark.points[end-2])*rect.width,(y-mark.points[end-1])*rect.height)>.2)mark.points.push(x,y);
      }
    }
  };
  const finish=()=>{
    cancelAnimationFrame(frame.current);frame.current=0;
    if(moving.current){
      const {marks:original,next}=moving.current;
      if(next.some((mark,j)=>mark.points.some((n,i)=>Math.abs(n-original[j].points[i])>1e-6)))onMove(next);
      moving.current=null;setMovePreview([]);
    }
    if(marquee.current){
      const box=marquee.current,left=Math.min(box.x,box.endX),top=Math.min(box.y,box.endY),right=Math.max(box.x,box.endX),bottom=Math.max(box.y,box.endY);
      const ids=marks.filter(mark=>{const bounds=markBounds(mark);return mark.kind!=='highlight'&&bounds&&bounds.x>=left&&bounds.y>=top&&bounds.x+bounds.width<=right&&bounds.y+bounds.height<=bottom}).map(mark=>mark.id);
      onSelect(ids,box.add?'add':'replace');marquee.current=null;setSelectionArea(null);
    }
    if(draftRef.current){
      let mark=draftRef.current;
      if(autoShapes&&mark.kind==='ink'&&!mark.shape){
        const corrected=correctShape(mark.points.map((n,i)=>n*(i%2?height:width)));
        if(corrected)mark={...mark,shape:corrected.kind,points:corrected.points.map((n,i)=>n/(i%2?height:width))};
      }
      if(!mark.shape||Math.max(...mark.points.filter((_,i)=>i%2===0))-Math.min(...mark.points.filter((_,i)=>i%2===0))>1/width||Math.max(...mark.points.filter((_,i)=>i%2===1))-Math.min(...mark.points.filter((_,i)=>i%2===1))>1/height)onMark(mark);
      draftRef.current=null;setDraft(null)
    }
    if(erased.current.size){onErase([...erased.current]);erased.current.clear();setHiddenMarks(new Set())}
  };
  const drawing=tool==='ink'||tool==='marker'||tool==='erase'||tool==='move'||isShape(tool);
  const commitText=()=>{
    if(!textDraft?.value.trim()){setTextDraft(null);return}
    const value=textDraft.value.trim();
    onMark({id:crypto.randomUUID(),page:pageNum,kind:'text',color:'#000000',rects:[{x:textDraft.x,y:textDraft.y,width:Math.min(1-textDraft.x,value.length*10/width),height:24/height}],points:[textDraft.x,textDraft.y],width:18/width,text:value});
    setTextDraft(null);
  };
  const selectionBoxes=tool==='move'?marks.filter(mark=>selectedIds.includes(mark.id)).map(mark=>({id:mark.id,box:markBounds(movePreview.find(item=>item.id===mark.id)||mark)})):[];
  return <div className="pdf-page-container" data-page-number={pageNum} data-active={active} data-rendered={ready} style={{width:width*scale,height:height*scale,minHeight:height*scale}}>
    <div className="pdf-page-surface" style={{width,height,transform:`scale(${scale})`}}>
      <canvas ref={canvasRef} className="pdf-canvas" style={{width,height,visibility:ready?'visible':'hidden'}}/>
      {!ready&&<div className="pdf-page-placeholder">{error?<span role="alert">{error}</span>:pageNum}</div>}
      <div ref={textRef} className="pdf-text-layer textLayer" style={{pointerEvents:drawing?'none':'auto',userSelect:drawing?'none':'text'}} onClick={event=>{
        if(tool!=='text'||window.getSelection()?.toString())return;
        const rect=event.currentTarget.getBoundingClientRect();
        setTextDraft({x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1),value:''});
      }}/>
      {textDraft&&tool==='text'&&<input autoFocus className="pdf-text-input" value={textDraft.value} onChange={event=>setTextDraft({...textDraft,value:event.target.value})} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commitText()}if(event.key==='Escape')setTextDraft(null)}} onBlur={commitText} style={{left:textDraft.x*width,top:textDraft.y*height,fontSize:18,color:'#000000'}} aria-label="Text annotation"/>}
      <svg className="pdf-annotation-layer" viewBox={`0 0 ${width} ${height}`} style={{pointerEvents:drawing?'auto':'none',touchAction:drawing?'none':'auto',cursor:tool==='move'?(movePreview.length?'grabbing':'grab'):drawing?'crosshair':'auto'}} aria-label={`Annotations on page ${pageNum}`}
        onPointerDown={event=>{
          if(event.button!==0||!drawing)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
          if(tool==='erase'){erase(event);return}
          if(tool==='move'){
            const [x,y]=position(event);
            const hit=[...marks].reverse().find(mark=>{
              if(mark.kind==='highlight')return false;
              if(hitsMark(mark,x*width,y*height,width,height,8/scale))return true;
              const box=mark.shape?markBounds(mark):null;
              return box&&x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height;
            });
            if(hit){
              if(event.shiftKey){onSelect([hit.id],'toggle');return;}
              const picked=selectedIds.includes(hit.id)?marks.filter(mark=>selectedIds.includes(mark.id)&&mark.kind!=='highlight'):[hit];
              if(!selectedIds.includes(hit.id))onSelect([hit.id]);
              moving.current={marks:picked,x,y,next:picked};
            }else{
              if(!event.shiftKey)onSelect([]);
              marquee.current={x,y,endX:x,endY:y,add:event.shiftKey};
            }
            return;
          }
          const [x,y]=position(event);strokeStart.current=[x*width,y*height];
          draftRef.current={id:crypto.randomUUID(),page:pageNum,kind:tool==='marker'?'marker':'ink',shape:isShape(tool)?tool:undefined,color,rects:[],points:[x,y,x+.00001,y],width:inkWidth/width};setDraft({...draftRef.current});
        }}
        onPointerMove={event=>{
          if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
          if(tool==='erase'){erase(event);return}
          if(moving.current){move(event);return}
          if(marquee.current){resizeSelection(event);return}
          collect(event);
          if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;if(draftRef.current)setDraft({...draftRef.current,points:[...draftRef.current.points]})});
        }}
        onPointerUp={event=>{if(moving.current)move(event);else if(marquee.current)resizeSelection(event);else collect(event);finish()}} onPointerCancel={()=>{moving.current=null;setMovePreview([]);marquee.current=null;setSelectionArea(null);draftRef.current=null;setDraft(null);erased.current.clear();setHiddenMarks(new Set());cancelAnimationFrame(frame.current);frame.current=0}}
      >
        {marks.filter(m=>!hiddenMarks.has(m.id)).map(mark=><MarkShape key={mark.id} mark={movePreview.find(item=>item.id===mark.id)||mark} width={width} height={height}/>)}
        {selectionBoxes.map(({id,box})=>box&&<rect key={id} className="pdf-selection-box" x={box.x*width-4/scale} y={box.y*height-4/scale} width={box.width*width+8/scale} height={box.height*height+8/scale} fill="none" stroke="#3587f5" strokeWidth={1.5/scale} strokeDasharray={`${5/scale} ${3/scale}`} pointerEvents="none"/>)}
        {selectionArea&&<rect className="pdf-selection-marquee" x={selectionArea.x*width} y={selectionArea.y*height} width={selectionArea.width*width} height={selectionArea.height*height} fill="#3587f51a" stroke="#3587f5" strokeWidth={1/scale} pointerEvents="none"/>}
        {draft&&<MarkShape mark={draft} width={width} height={height}/>}
      </svg>
    </div>
  </div>;
});
