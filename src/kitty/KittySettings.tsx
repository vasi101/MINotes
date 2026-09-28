import { useKittySettings } from "./settings";
import KittyControls from "./KittyControls";
export default function KittySettings() {
  const settings = useKittySettings();
  return (
    <fieldset className="kitty-settings">
      <legend>✧ Kitty</legend>
      <label className="setting-row">
        Ask on Selection
        <input
          type="checkbox"
          checked={settings.askOnSelection}
          onChange={(e) =>
            settings.update({ askOnSelection: e.target.checked })
          }
        />
      </label>
      <p>
        Select text to see actions. Kitty only looks it up when you choose an
        action.
      </p>
      <KittyControls initiallyExpanded />
      <label>
        Keep model warm
        <select
          value={settings.keepWarmMinutes}
          onChange={(e) =>
            settings.update({ keepWarmMinutes: Number(e.target.value) })
          }
        >
          {[0, 5, 10, 30].map((n) => (
            <option value={n} key={n}>
              {n ? `${n} minutes` : "Unload after each answer"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Translate into
        <select
          value={settings.targetLanguage}
          onChange={(e) =>
            settings.update({ targetLanguage: e.target.value as "en" | "ne" })
          }
        >
          <option value="ne">Nepali</option>
          <option value="en">English</option>
        </select>
      </label>
      <p>
        Definitions use an online dictionary and a local cache. Only the lookup
        term is sent. Choose local models for offline AI and translation, or
        connect Cloud AI.
      </p>
    </fieldset>
  );
}
