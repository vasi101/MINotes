import { identity, multiply, svgMatrix, type Matrix } from './transform';
import {strokePath} from '../ink';
import {memo,useEffect,useLayoutEffect,useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {TextLayer,type PDFDocumentProxy,type PDFPageProxy} from 'pdfjs-dist';
import type {PdfMark,ReaderTool} from './types';
import {clamp,getSelectionRects,hitsMark,markBounds,translateMarks,measureTextRect} from './geometry';
import {isShape,shapePoints,correctShape} from '../shapes';

type Props={pdf:PDFDocumentProxy;pageNum:number;scale:number;width:number;height:number;active:boolean;marks:PdfMark[];tool:ReaderTool;color:string;inkWidth:number;autoShapes:boolean;selectedIds:string[];onSelect:(ids:string[],mode?:'replace'|'add'|'toggle')=>void;onMove:(marks:PdfMark[])=>void;onMark:(mark:PdfMark)=>void;onErase:(ids:string[])=>void;onSize:(page:number,width:number,height:number)=>void};
const MarkShape=memo(function MarkShape({mark,width,height,tool,isSelected,onTextPointerDown,onTextDoubleClick}:{mark:PdfMark;width:number;height:number;tool?:ReaderTool;isSelected?:boolean;onTextPointerDown?:(e:ReactPointerEvent<SVGElement>,m:PdfMark)=>void;onTextDoubleClick?:(e:React.MouseEvent<SVGElement>,m:PdfMark)=>void}){
  if(mark.transform)return <g transform={svgMatrix(mark.transform,width,height)}><MarkShape mark={{...mark,transform:undefined}} width={width} height={height} tool={tool} isSelected={isSelected} onTextPointerDown={onTextPointerDown} onTextDoubleClick={onTextDoubleClick}/></g>;
  const points=mark.points.map((n,i)=>n*(i%2?height:width));
  if(mark.kind==='text'&&mark.text){
    const box=mark.rects[0];
    const interactive=tool==='text'||tool==='move';
    return <g data-mark-id={mark.id} data-kind={mark.kind} data-selected={isSelected} style={{cursor:interactive?'pointer':'default'}}>
      {box&&<rect x={box.x*width} y={box.y*height} width={box.width*width} height={box.height*height} fill="transparent" style={{pointerEvents:interactive?'auto':'none'}} onPointerDown={onTextPointerDown?(e)=>onTextPointerDown(e,mark):undefined} onDoubleClick={onTextDoubleClick?(e)=>onTextDoubleClick(e,mark):undefined}/>}
      <text data-mark-id={mark.id} data-kind={mark.kind} x={points[0]} y={points[1]} fill={mark.color} fontSize={mark.width*width} dominantBaseline="hanging" style={{fontFamily:'Roboto, sans-serif',fontWeight:500,pointerEvents:interactive?'auto':'none',userSelect:'none'}} onPointerDown={onTextPointerDown?(e)=>onTextPointerDown(e,mark):undefined} onDoubleClick={onTextDoubleClick?(e)=>onTextDoubleClick(e,mark):undefined}>
        {mark.text}
      </text>
    </g>;
  }
  return <g data-mark-id={mark.id} data-kind={mark.kind} data-shape={mark.shape} opacity={mark.kind==='highlight'?.4:mark.kind==='marker'?.32:1}>
    {mark.rects.map((r,i)=><rect key={i} x={r.x*width} y={r.y*height} width={r.width*width} height={r.height*height} fill={mark.color}/>)}
    {points.length>=4&&<path d={strokePath(points,!mark.shape)} fill="none" stroke={mark.color} strokeWidth={mark.width*width} strokeLinecap="round" strokeLinejoin="round"/>}
  </g>;
});

export default memo(function PDFPage({pdf,pageNum,scale,width,height,active,marks,tool,color,inkWidth,autoShapes,selectedIds,onSelect,onMove,onMark,onErase,onSize}:Props){
  const canvasRef=useRef<HTMLCanvasElement>(null),textRef=useRef<HTMLDivElement>(null),pageRef=useRef<PDFPageProxy|null>(null);
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[rasterScale,setRasterScale]=useState(scale);
  const [draft,setDraft]=useState<PdfMark|null>(null);
  const transforming=useRef<{mark:PdfMark;box:{x:number;y:number;width:number;height:number};mode:string;startX:number;startY:number;next:PdfMark}|null>(null);
  const moving=useRef<{marks:PdfMark[];x:number;y:number;next:PdfMark[]}|null>(null);
  const marquee=useRef<{x:number;y:number;endX:number;endY:number;add:boolean}|null>(null);
  const [selectionArea,setSelectionArea]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  const [movePreview,setMovePreview]=useState<PdfMark[]>([]),[textDraft,setTextDraft]=useState<{id?:string;x:number;y:number;value:string}|null>(null);
  const lastTextTap=useRef<{x:number;y:number;time:number}|null>(null);
  const textTouchStart=useRef<{x:number;y:number}|null>(null);
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

  const position=(event:ReactPointerEvent<SVGElement>)=>{
    const svg=event.currentTarget.closest('svg')||event.currentTarget;
    const rect=svg.getBoundingClientRect();
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
  const transformSelection=(event:ReactPointerEvent<SVGSVGElement>)=>{
    const gesture=transforming.current;if(!gesture)return;
    const [x,y]=position(event),box=gesture.box;
    if(gesture.mark.kind==='text'){
      if(gesture.mode==='rotate'){
        const cx=box.x+box.width/2,cy=box.y+box.height/2;
        const angle=Math.atan2((y-cy)*height,(x-cx)*width)-Math.atan2((gesture.startY-cy)*height,(gesture.startX-cx)*width);
        const c=Math.cos(angle),s=Math.sin(angle);
        const matrix:Matrix=[c,s*width/height,-s*height/width,c,cx-c*cx+s*height/width*cy,cy-s*width/height*cx-c*cy];
        gesture.next={...gesture.mark,transform:multiply(matrix,gesture.mark.transform||identity)};
      }else{
        const left=gesture.mode.includes('w'),top=gesture.mode.includes('n');
        const anchorX=left?box.x+box.width:box.x,anchorY=top?box.y+box.height:box.y;
        const startDx=(gesture.startX-anchorX)*width,startDy=(gesture.startY-anchorY)*height;
        const curDx=(x-anchorX)*width,curDy=(y-anchorY)*height;
        const startDist=Math.hypot(startDx,startDy);
        const proj=(curDx*startDx+curDy*startDy)/(startDist||1);
        const scaleRatio=Math.max(0.2,Math.min(8,proj/(startDist||1)));
        const origFontSize=gesture.mark.width*width;
        const newFontSize=Math.max(8,Math.min(120,Math.round(origFontSize*scaleRatio)));
        const effectiveScale=newFontSize/(origFontSize||1);
        const newW=box.width*effectiveScale,newH=box.height*effectiveScale;
        const newX=left?clamp(box.x+box.width-newW,0,1-newW):clamp(box.x,0,1-newW);
        const newY=top?clamp(box.y+box.height-newH,0,1-newH):clamp(box.y,0,1-newH);
        gesture.next={
          ...gesture.mark,
          width:newFontSize/width,
          points:[newX,newY],
          rects:[{x:newX,y:newY,width:newW,height:newH}],
          transform:gesture.mark.transform
        };
      }
      setMovePreview([gesture.next]);
      return;
    }
    let matrix:Matrix;
    if(gesture.mode==='rotate'){
      const cx=box.x+box.width/2,cy=box.y+box.height/2;
      const angle=Math.atan2((y-cy)*height,(x-cx)*width)-Math.atan2((gesture.startY-cy)*height,(gesture.startX-cx)*width);
      const c=Math.cos(angle),s=Math.sin(angle);
      matrix=[c,s*width/height,-s*height/width,c,cx-c*cx+s*height/width*cy,cy-s*width/height*cx-c*cy];
    }else{
      const left=gesture.mode.includes('w'),top=gesture.mode.includes('n');
      const ax=left?box.x+box.width:box.x,ay=top?box.y+box.height:box.y;
      const sx=Math.max(.1,(x-ax)/(gesture.startX-ax||.001)),sy=Math.max(.1,(y-ay)/(gesture.startY-ay||.001));
      matrix=[sx,0,0,sy,ax*(1-sx),ay*(1-sy)];
    }
    gesture.next={...gesture.mark,transform:multiply(matrix,gesture.mark.transform||identity)};
    setMovePreview([gesture.next]);
  };
  const finish=()=>{
    cancelAnimationFrame(frame.current);frame.current=0;
    if(transforming.current){onMove([transforming.current.next]);transforming.current=null;setMovePreview([])}
    if(moving.current){
      const {marks:original,next}=moving.current;
      if(next.some((mark,j)=>JSON.stringify(mark)!==JSON.stringify(original[j])))onMove(next);
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
    if(!textDraft?.value.trim()){
      if(textDraft?.id)onErase([textDraft.id]);
      setTextDraft(null);
      return;
    }
    const value=textDraft.value.trim();
    const existing=textDraft.id?marks.find(m=>m.id===textDraft.id):null;
    const fontSizePx=existing?Math.max(8,Math.round(existing.width*width)):18;
    const rect=measureTextRect(value,fontSizePx,textDraft.x,textDraft.y,width,height);
    const updatedMark:PdfMark={
      id:textDraft.id||crypto.randomUUID(),
      page:pageNum,
      kind:'text',
      color:existing?.color||color||'#000000',
      rects:[rect],
      points:[textDraft.x,textDraft.y],
      width:fontSizePx/width,
      text:value
    };
    if(textDraft.id){
      onMove([updatedMark]);
    }else{
      onMark(updatedMark);
      onSelect([updatedMark.id]);
    }
    setTextDraft(null);
  };
  const openText=(clientX:number,clientY:number)=>{
    if(tool!=='text'&&tool!=='highlight')return;
    if(tool==='highlight'&&window.getSelection()?.toString())return;
    const rect=textRef.current?.getBoundingClientRect();if(!rect)return;
    window.getSelection()?.removeAllRanges();
    setTextDraft({x:clamp((clientX-rect.left)/rect.width,0,1),y:clamp((clientY-rect.top)/rect.height,0,1),value:''});
  };
  const selectionBoxes=(tool==='move'||tool==='text')?marks.filter(mark=>selectedIds.includes(mark.id)).map(mark=>({id:mark.id,mark,box:markBounds(movePreview.find(item=>item.id===mark.id)||mark)})):[];
  const handleTextPointerDown=(event:ReactPointerEvent<SVGElement>,mark:PdfMark)=>{
    if(event.button!==0||tool!=='move'&&tool!=='text')return;
    event.stopPropagation();event.preventDefault();
    if(event.shiftKey){onSelect([mark.id],'toggle');return}
    if(!selectedIds.includes(mark.id))onSelect([mark.id]);
    const rect=event.currentTarget.closest('svg')?.getBoundingClientRect();
    if(!rect)return;
    const x=clamp((event.clientX-rect.left)/rect.width,0,1),y=clamp((event.clientY-rect.top)/rect.height,0,1);
    const picked=selectedIds.includes(mark.id)?marks.filter(m=>selectedIds.includes(m.id)&&m.kind!=='highlight'):[mark];
    moving.current={marks:picked,x,y,next:picked};
    event.currentTarget.closest('svg')?.setPointerCapture(event.pointerId);
  };
  const handleTextDoubleClick=(event:React.MouseEvent<SVGElement>,mark:PdfMark)=>{
    if(tool!=='move'&&tool!=='text')return;
    event.stopPropagation();event.preventDefault();
    setTextDraft({id:mark.id,x:mark.points[0],y:mark.points[1],value:mark.text||''});
  };
  return <div className="pdf-page-container" data-page-number={pageNum} data-active={active} data-rendered={ready} style={{width:width*scale,height:height*scale,minHeight:height*scale}}>
    <div className="pdf-page-surface" style={{width,height,transform:`scale(${scale})`}}>
      <canvas ref={canvasRef} className="pdf-canvas" style={{width,height,visibility:ready?'visible':'hidden'}}/>
      {!ready&&<div className="pdf-page-placeholder">{error?<span role="alert">{error}</span>:pageNum}</div>}
      <div ref={textRef} className="pdf-text-layer textLayer" style={{pointerEvents:drawing?'none':'auto',userSelect:drawing?'none':'text',touchAction:'manipulation'}}
        onDoubleClick={event=>openText(event.clientX,event.clientY)}
        onPointerDown={event=>{
          if(event.button!==0)return;
          if(selectedIds.length>0&&tool==='text')onSelect([]);
          if(event.pointerType==='touch')textTouchStart.current={x:event.clientX,y:event.clientY};
        }}
        onPointerCancel={()=>{textTouchStart.current=null;lastTextTap.current=null}}
        onPointerUp={event=>{
          if(event.pointerType!=='touch')return;
          const start=textTouchStart.current;textTouchStart.current=null;
          if(!start||Math.hypot(event.clientX-start.x,event.clientY-start.y)>12){lastTextTap.current=null;return}
          const previous=lastTextTap.current,now=Date.now();
          if(previous&&now-previous.time<400&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<24){
            lastTextTap.current=null;openText(event.clientX,event.clientY);
          }else lastTextTap.current={x:event.clientX,y:event.clientY,time:now};
        }}/>
      {textDraft&&(()=>{
        const existing=textDraft.id?marks.find(m=>m.id===textDraft.id):null;
        const fontSize=existing?Math.max(8,Math.round(existing.width*width)):18;
        return <input autoFocus className="pdf-text-input" value={textDraft.value} onChange={event=>setTextDraft({...textDraft,value:event.target.value})} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commitText()}if(event.key==='Escape')setTextDraft(null)}} onBlur={commitText} style={{left:textDraft.x*width,top:textDraft.y*height,fontSize,color:existing?.color||color||'#000000'}} aria-label="Text annotation"/>;
      })()}
      <svg className="pdf-highlight-layer" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {marks.filter(mark=>(mark.kind==='highlight'||mark.kind==='marker')&&!hiddenMarks.has(mark.id)).map(mark=><MarkShape key={mark.id} mark={movePreview.find(item=>item.id===mark.id)||mark} width={width} height={height} tool={tool}/>)}
        {draft?.kind==='marker'&&<MarkShape mark={draft} width={width} height={height} tool={tool}/>}
      </svg>
      <svg className="pdf-annotation-layer" viewBox={`0 0 ${width} ${height}`} style={{pointerEvents:(drawing||selectionBoxes.length>0)?'auto':'none',touchAction:drawing?'none':'auto',cursor:tool==='move'?(movePreview.length?'grabbing':'grab'):tool==='text'?(selectionBoxes.length>0?'default':'text'):drawing?'crosshair':'auto'}} aria-label={`Annotations on page ${pageNum}`}
        onPointerDown={event=>{
          if(event.button!==0)return;
          const handle=(event.target as Element).closest('[data-transform]');
          if((tool==='move'||tool==='text')&&handle){
            event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
            const mark=marks.find(mark=>mark.id===handle.getAttribute('data-mark'));const box=mark&&markBounds(mark);
            if(mark&&box){const [startX,startY]=position(event);transforming.current={mark,box,mode:handle.getAttribute('data-transform')!,startX,startY,next:mark};return}
          }
          if(!drawing&&tool!=='text')return;
          event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
          if(tool==='erase'){erase(event);return}
          if(tool==='move'||tool==='text'){
            const [x,y]=position(event);
            const hit=[...marks].reverse().find(mark=>{
              if(mark.kind==='highlight')return false;
              if(tool==='text'&&mark.kind!=='text')return false;
              if(hitsMark(mark,x*width,y*height,width,height,8/scale))return true;
              const box=(mark.shape||mark.kind==='text')?markBounds(mark):null;
              return box&&x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height;
            });
            if(hit){
              if(event.shiftKey){onSelect([hit.id],'toggle');return;}
              const picked=selectedIds.includes(hit.id)?marks.filter(mark=>selectedIds.includes(mark.id)&&mark.kind!=='highlight'):[hit];
              if(!selectedIds.includes(hit.id))onSelect([hit.id]);
              moving.current={marks:picked,x,y,next:picked};
            }else{
              if(!event.shiftKey)onSelect([]);
              if(tool==='move')marquee.current={x,y,endX:x,endY:y,add:event.shiftKey};
            }
            return;
          }
          const [x,y]=position(event);strokeStart.current=[x*width,y*height];
          draftRef.current={id:crypto.randomUUID(),page:pageNum,kind:tool==='marker'?'marker':'ink',shape:isShape(tool)?tool:undefined,color,rects:[],points:[x,y,x+.00001,y],width:inkWidth/width};setDraft({...draftRef.current});
        }}
        onPointerMove={event=>{
          if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
          if(transforming.current){transformSelection(event);return}
          if(tool==='erase'){erase(event);return}
          if(moving.current){move(event);return}
          if(marquee.current){resizeSelection(event);return}
          collect(event);
          if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=0;if(draftRef.current)setDraft({...draftRef.current,points:[...draftRef.current.points]})});
        }}
        onPointerUp={event=>{if(transforming.current)transformSelection(event);else if(moving.current)move(event);else if(marquee.current)resizeSelection(event);else collect(event);finish()}} onPointerCancel={()=>{transforming.current=null;moving.current=null;setMovePreview([]);marquee.current=null;setSelectionArea(null);draftRef.current=null;setDraft(null);erased.current.clear();setHiddenMarks(new Set());cancelAnimationFrame(frame.current);frame.current=0}}
      >
        {marks.filter(m=>m.kind!=='highlight'&&m.kind!=='marker'&&!hiddenMarks.has(m.id)).map(mark=><MarkShape key={mark.id} mark={movePreview.find(item=>item.id===mark.id)||mark} width={width} height={height} tool={tool} isSelected={selectedIds.includes(mark.id)} onTextPointerDown={handleTextPointerDown} onTextDoubleClick={handleTextDoubleClick}/>)}
        {selectionBoxes.map(({id,mark,box})=>box&&<g key={id}>
          <rect className="pdf-selection-box" x={box.x*width-4/scale} y={box.y*height-4/scale} width={box.width*width+8/scale} height={box.height*height+8/scale} fill="rgba(53,135,245,0.06)" stroke="#3587f5" strokeWidth={1.5/scale} strokeDasharray={`${5/scale} ${3/scale}`} style={{pointerEvents:'auto',cursor:'move'}}
            onPointerDown={event=>{
              if(event.button!==0||tool!=='move'&&tool!=='text')return;
              event.stopPropagation();event.preventDefault();
              event.currentTarget.closest('svg')?.setPointerCapture(event.pointerId);
              const [x,y]=position(event);
              const picked=marks.filter(m=>selectedIds.includes(m.id));
              moving.current={marks:picked,x,y,next:picked};
            }}
          />
          {mark.kind==='text'&&<text x={box.x*width-4/scale} y={Math.max(12/scale,box.y*height-8/scale)} fill="#3587f5" fontSize={11/scale} fontWeight={600} fontFamily="sans-serif" pointerEvents="none">
            {Math.round(mark.width*width)}px
          </text>}
        </g>)}
        {selectionBoxes.length===1&&selectionBoxes.map(({id,box})=>box&&<g key={`handles-${id}`}>
          <line x1={(box.x+box.width/2)*width} y1={box.y*height} x2={(box.x+box.width/2)*width} y2={Math.max(10/scale,box.y*height-28/scale)} stroke="#3587f5" strokeWidth={1/scale}/>
          {(['nw','ne','sw','se','rotate'] as const).map(mode=>{
            const x=mode==='rotate'?box.x+box.width/2:mode.includes('w')?box.x:box.x+box.width;
            const y=mode==='rotate'?Math.max(10/scale/height,box.y-28/scale/height):mode.includes('n')?box.y:box.y+box.height;
            return <circle key={mode} data-transform={mode} data-mark={id} aria-label={mode==='rotate'?'Rotate annotation':`Resize annotation ${mode}`} cx={x*width} cy={y*height} r={7/scale} fill="white" stroke="#3587f5" strokeWidth={2/scale} style={{cursor:mode==='rotate'?'grab':`${mode}-resize`,pointerEvents:'auto'}}/>;
          })}
        </g>)}
        {selectionArea&&<rect className="pdf-selection-marquee" x={selectionArea.x*width} y={selectionArea.y*height} width={selectionArea.width*width} height={selectionArea.height*height} fill="#3587f51a" stroke="#3587f5" strokeWidth={1/scale} pointerEvents="none"/>}
        {draft&&draft.kind!=='marker'&&<MarkShape mark={draft} width={width} height={height} tool={tool}/>}
      </svg>
    </div>
  </div>;
});
