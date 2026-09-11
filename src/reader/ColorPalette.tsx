import {useState} from 'react';
export const highlightColors=['#ff4c55','#ff8045','#ffad40','#ffcd39','#fff045','#b9e632','#72cd37','#32c8c5','#3da6f7','#5c7cf4','#9454d9','#ed51ad','#000000'];
export default function ColorPalette({color,onChange}:{color:string;onChange:(color:string)=>void}){
  const [family,setFamily]=useState(Math.max(0,highlightColors.indexOf(color)));
  const shades=family===6?['#0a2900','#1a5100','#359f08','#72cd37','#b8eb8b','#dcf5bf','#f5fced']:[.2,.4,.7,1,1.35,1.65,1.9].map(factor=>{
    const channels=[1,3,5].map(offset=>parseInt(highlightColors[family].slice(offset,offset+2),16));
    return '#'+channels.map(c=>Math.round(factor<=1?c*factor:c+(255-c)*(factor-1)).toString(16).padStart(2,'0')).join('');
  });
  return <div className="reader-palette" aria-label="Highlight colors" onMouseDown={e=>e.preventDefault()}>
    <div className="reader-shades">{shades.map(shade=><button type="button" key={shade} aria-label={`Highlight shade ${shade}`} aria-pressed={color===shade} style={{background:shade}} onClick={()=>onChange(shade)}/>)}</div>
    <div className="reader-spectrum">{highlightColors.map((c,index)=><button type="button" key={c} aria-label={`Highlight color ${c}`} aria-pressed={family===index} style={{background:c}} onClick={()=>{setFamily(index);onChange(c)}}/>)}</div>
    <label>Custom color<input type="color" value={color} aria-label="Custom highlight color" onChange={e=>onChange(e.target.value)}/></label>
  </div>;
}
