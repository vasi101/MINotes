import {useRef,type PointerEvent,type KeyboardEvent} from 'react';
import {highlightColors} from './ColorPalette';
export default function RingSettings({color,onColor,width,onWidth,marker,isText}:{color:string;onColor:(color:string)=>void;width:number;onWidth:(width:number)=>void;marker:boolean;isText?:boolean}){
  const svg=useRef<SVGSVGElement>(null);
  const min=isText?10:1,max=isText?72:30;
  const clampedWidth=Math.max(min,Math.min(max,width));
  const center=392,radius=360,angle=(clampedWidth-min)/(max-min)*Math.PI/2;
  const x=center-radius*Math.cos(angle),y=center-radius*Math.sin(angle);
  const update=(event:PointerEvent<SVGGElement>)=>{
    const box=svg.current!.getBoundingClientRect();
    const px=(event.clientX-box.left)*420/box.width,py=(event.clientY-box.top)*420/box.height;
    const a=Math.max(0,Math.min(Math.PI/2,Math.atan2(center-py,center-px)));
    onWidth(Math.round(min+a/(Math.PI/2)*(max-min)));
  };
  const keyboard=(event:KeyboardEvent<SVGGElement>)=>{
    const step=event.shiftKey?5:1;
    const next=event.key==='Home'?min:event.key==='End'?max:['ArrowRight','ArrowUp'].includes(event.key)?Math.min(max,clampedWidth+step):['ArrowLeft','ArrowDown'].includes(event.key)?Math.max(min,clampedWidth-step):null;
    if(next!==null){event.preventDefault();onWidth(next)}
  };
  return <>
    <div role="group" aria-label="Ring colors">{highlightColors.map((value,index)=>{
      const a=index/(highlightColors.length-1)*Math.PI/2;
      return <button key={value} className="reader-outer-color" aria-label={`Ink color ${value}`} title={value} aria-pressed={color===value} style={{right:14+Math.cos(a)*310,bottom:14+Math.sin(a)*310,background:value}} onClick={()=>onColor(value)}/>;
    })}</div>
    <div className="reader-ring-caption"><span>{isText ? "Font size" : marker ? "Marker width" : "Stroke width"}</span><strong>{clampedWidth}<small> px</small></strong><input className="reader-width-range" aria-label="Adjust stroke size" type="range" min={min} max={max} value={clampedWidth} onChange={event=>onWidth(Number(event.target.value))} style={{background:`linear-gradient(to right, #ffcc32 ${(clampedWidth-min)/(max-min)*100}%, #cbd1dd ${(clampedWidth-min)/(max-min)*100}%)`}}/></div>
    <svg ref={svg} className="reader-thickness-ring" viewBox="0 0 420 420">
      <g role="slider" tabIndex={0} aria-label={isText?'Font size':marker?'Marker thickness':'Pen thickness'} aria-valuemin={min} aria-valuemax={max} aria-valuenow={clampedWidth} aria-valuetext={`${clampedWidth} pixels`} className="reader-thickness-slider"
        onKeyDown={keyboard} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);update(event)}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))update(event)}} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){update(event);event.currentTarget.releasePointerCapture(event.pointerId)}}}>
        <path d="M32 392 A360 360 0 0 1 392 32" fill="none" stroke="#dce2e9" strokeWidth="8" strokeLinecap="round"/>
        <path d="M32 392 A360 360 0 0 1 392 32" fill="none" stroke="#ffffff55" strokeWidth="2" strokeLinecap="round"/>
        <path d="M32 392 A360 360 0 0 1 392 32" pathLength="100" fill="none" stroke={color} strokeWidth="4" strokeDasharray={`${(clampedWidth-min)/(max-min)*100} 100`} strokeLinecap="round"/>
        <path d="M32 392 A360 360 0 0 1 392 32" fill="none" stroke="transparent" strokeWidth="28"/>
        <circle cx={x} cy={y} r={16+clampedWidth/6} fill="white" stroke="#262626" strokeWidth="2"/>
        <circle cx={x} cy={y} r={Math.max(1.5,Math.min(15,clampedWidth/2))} fill={color}/>

      </g>
    </svg>
  </>;
}
