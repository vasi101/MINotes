import {useRef,type PointerEvent,type KeyboardEvent} from 'react';
import {highlightColors} from './ColorPalette';
export default function RingSettings({color,onColor,width,onWidth,marker}:{color:string;onColor:(color:string)=>void;width:number;onWidth:(width:number)=>void;marker:boolean}){
  const svg=useRef<SVGSVGElement>(null);
  const center=392,radius=360,angle=(width-1)/29*Math.PI/2;
  const x=center-radius*Math.cos(angle),y=center-radius*Math.sin(angle);
  const update=(event:PointerEvent<SVGGElement>)=>{
    const box=svg.current!.getBoundingClientRect();
    const px=(event.clientX-box.left)*420/box.width,py=(event.clientY-box.top)*420/box.height;
    const angle=Math.max(0,Math.min(Math.PI/2,Math.atan2(center-py,center-px)));
    onWidth(Math.round(1+angle/(Math.PI/2)*29));
  };
  const keyboard=(event:KeyboardEvent<SVGGElement>)=>{
    const step=event.shiftKey?5:1;
    const next=event.key==='Home'?1:event.key==='End'?30:['ArrowRight','ArrowUp'].includes(event.key)?Math.min(30,width+step):['ArrowLeft','ArrowDown'].includes(event.key)?Math.max(1,width-step):null;
    if(next!==null){event.preventDefault();onWidth(next)}
  };
  return <>
    <div role="group" aria-label="Ring colors">{highlightColors.map((value,index)=>{
      const angle=index/(highlightColors.length-1)*Math.PI/2;
      return <button key={value} className="reader-outer-color" aria-label={`Ink color ${value}`} title={value} aria-pressed={color===value} style={{right:14+Math.cos(angle)*310,bottom:14+Math.sin(angle)*310,background:value}} onClick={()=>onColor(value)}/>;
    })}</div>
    <svg ref={svg} className="reader-thickness-ring" viewBox="0 0 420 420">
      <g role="slider" tabIndex={0} aria-label={marker?'Marker thickness':'Pen thickness'} aria-valuemin={1} aria-valuemax={30} aria-valuenow={width} aria-valuetext={`${width} pixels`} className="reader-thickness-slider"
        onKeyDown={keyboard} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);update(event)}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))update(event)}} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId)){update(event);event.currentTarget.releasePointerCapture(event.pointerId)}}}>
        <path d="M32 392 A360 360 0 0 1 392 32" fill="none" stroke="white" strokeWidth="12" strokeLinecap="round"/>
        <path d="M32 392 A360 360 0 0 1 392 32" fill="none" stroke="#545454" strokeWidth="3" strokeLinecap="round"/>
        <path d="M32 392 A360 360 0 0 1 392 32" fill="none" stroke="transparent" strokeWidth="28"/>
        <circle cx={x} cy={y} r="16" fill="white" stroke="#262626" strokeWidth="2"/>
        <circle cx={x} cy={y} r={Math.max(1.5,width*.4)} fill={color}/>
        <text x={x+24} y={y+5} fill="#222" stroke="white" strokeWidth="4" paintOrder="stroke" fontSize="13" fontWeight="600" pointerEvents="none">{width}</text>
      </g>
    </svg>
  </>;
}
