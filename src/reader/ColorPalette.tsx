import {useState} from 'react';
export const highlightColors=['#ff4c55','#ff8045','#ffad40','#ffcd39','#fff045','#b9e632','#72cd37','#32c8c5','#3da6f7','#5c7cf4','#9454d9','#ed51ad','#000000'];
const softColors=['#fff59d','#ffe082','#ffcc80','#ffab91','#ffcdd2','#f8bbd0','#e1bee7','#d1c4e9','#c5cae9','#bbdefb','#b3e5fc','#b2ebf2','#b2dfdb','#c8e6c9'];
export default function ColorPalette({color,onChange}:{color:string;onChange:(color:string)=>void}){
  const [family,setFamily]=useState(Math.max(0,highlightColors.indexOf(color)));
  const shades=family===6?['#0a2900','#1a5100','#359f08','#72cd37','#b8eb8b','#dcf5bf','#f5fced']:[.2,.4,.7,1,1.35,1.65,1.9].map(factor=>{
    const channels=[1,3,5].map(offset=>parseInt(highlightColors[family].slice(offset,offset+2),16));
    return '#'+channels.map(c=>Math.round(factor<=1?c*factor:c+(255-c)*(factor-1)).toString(16).padStart(2,'0')).join('');
  });
  return <div className="reader-palette" aria-label="Highlight colors" onMouseDown={e=>{if((e.target as HTMLElement).closest('button'))e.preventDefault()}}>
    <strong className="reader-palette-title">Highlight colors</strong>
    <span className="reader-palette-label">Shades</span>
    <div className="reader-shades">{shades.map((shade,index)=><button type="button" key={`${shade}-${index}`} aria-label={`Highlight shade ${shade}`} aria-pressed={color===shade} style={{background:shade}} onClick={()=>onChange(shade)}/>)}</div>
    <span className="reader-palette-label">Vivid colors</span>
    <div className="reader-spectrum">{highlightColors.map((c,index)=><button type="button" key={c} aria-label={`Highlight color ${c}`} aria-pressed={color===c} style={{background:c}} onClick={()=>{setFamily(index);onChange(c)}}/>)}</div>
    <span className="reader-palette-label">Soft highlight colors</span>
    <div className="reader-soft-colors" role="group" aria-label="Soft highlight colors">{softColors.map(c=><button type="button" key={c} aria-label={`Soft highlight ${c}`} aria-pressed={color===c} style={{background:c}} onClick={()=>onChange(c)}/>)}</div>
    <label className="reader-custom-color"><span><strong>Custom color</strong><small>Choose any color</small></span><code>{color.toUpperCase()}</code><input type="color" value={color} aria-label="Custom highlight color" onChange={e=>onChange(e.target.value)}/></label>
  </div>;
}
