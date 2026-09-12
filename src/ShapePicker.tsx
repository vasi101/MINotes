import {shapeNames,type ShapeKind} from './shapes';
export function ShapeIcon({kind}:{kind:ShapeKind}){
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    {kind==='triangle'?<path d="M12 3 22 21H2Z"/>:kind==='diamond'?<path d="m12 2 10 10-10 10L2 12Z"/>:kind==='rounded-rectangle'?<rect x="3" y="5" width="18" height="14" rx="3"/>:kind==='line'?<path d="M4 20 20 4"/>:kind==='circle'?<circle cx="12" cy="12" r="9"/>:<ellipse cx="12" cy="12" rx="10" ry="7"/>}
  </svg>;
}
export default function ShapePicker({tool,onSelect,automatic,onAutomatic}:{tool:string;onSelect:(kind:ShapeKind)=>void;automatic:boolean;onAutomatic:(enabled:boolean)=>void}){
  return <div className="shape-picker" role="group" aria-label="Shapes">
    <div className="shape-picker-tools">{(Object.keys(shapeNames) as ShapeKind[]).map(kind=><button key={kind} title={shapeNames[kind]} aria-label={shapeNames[kind]} aria-pressed={tool===kind} onClick={()=>onSelect(kind)}><ShapeIcon kind={kind}/><span>{shapeNames[kind]}</span></button>)}</div>
    <label className="shape-auto"><input type="checkbox" checked={automatic} onChange={event=>onAutomatic(event.target.checked)}/>Auto-correct shapes</label>
  </div>;
}
