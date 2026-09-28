import { useKittySettings } from '../kitty/settings';
import KittyControls from '../kitty/KittyControls';

export default function ReaderKittyControls({ selecting, onSelectText, onClose }: { selecting: boolean; onSelectText: () => void; onClose: () => void }) {
  const askOnSelection = useKittySettings(s => s.askOnSelection);
  return <section className="reader-kitty-panel" aria-label="Kitty reading controls">
      <header><strong>Read with Kitty</strong><button type="button" aria-label="Close Kitty reading controls" onClick={onClose}>×</button></header>
      <p>Select a word or passage, then click the cat to define, translate, explain, or summarize.</p>
      <button type="button" aria-pressed={selecting} onClick={()=>{onSelectText();onClose()}}>Select text <span aria-hidden="true">V</span></button>
      <label><span>Ask on Selection</span><input type="checkbox" checked={askOnSelection} onChange={e=>{useKittySettings.getState().update({askOnSelection:e.target.checked});onSelectText()}}/></label>
      <p className="reader-kitty-hint">Selecting text only opens actions. Choose an action to get an answer.</p>
      <KittyControls/>
    </section>;
}
