import { useEffect, useState } from "react";
import { useKittySettings } from "./settings";
import { useCloudAI } from "./cloudStore";
import { useKittySetup } from "./setupStore";
import KittySetup from "./KittySetup";
import CloudSetup from "./CloudSetup";

export function WebSearchToggle({ disabled = false }: { disabled?: boolean }) {
  const { webSearch, update } = useKittySettings();
  return (
    <button
      type="button"
      className="kitty-web-toggle"
      disabled={disabled}
      aria-pressed={webSearch}
      onClick={() => update({ webSearch: !webSearch })}
      title="Search online sources for questions and explanations"
    >
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.5" />
        <ellipse cx="10" cy="10" rx="3.5" ry="7.5" />
        <path d="M3 7h14M3 13h14" />
      </svg>
      Web search
    </button>
  );
}

export default function KittyControls({
  disabled = false,
  initiallyExpanded = false,
  needsSetup = false,
}: {
  disabled?: boolean;
  initiallyExpanded?: boolean;
  needsSetup?: boolean;
}) {
  const settings = useKittySettings();
  const cloud = useCloudAI();
  const setup = useKittySetup();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  useEffect(() => {
    if (needsSetup) setExpanded(true);
  }, [needsSetup]);
  useEffect(() => {
    if (settings.aiMode === "cloud") void cloud.refresh();
    else void setup.refresh();
  }, [settings.aiMode]);
  const models = [
    ...new Set(cloud.models.length ? cloud.models : [settings.cloudModel]),
  ];
  const label =
    settings.aiMode === "cloud"
      ? settings.cloudModel
      : (setup.status?.installed?.displayName ?? "Local AI");
  return (
    <div
      className={`kitty-model-control ${expanded ? "is-open" : ""} ${initiallyExpanded ? "is-standalone" : ""}`}
    >
      <button
        type="button"
        className="kitty-model-trigger"
        aria-label="Model settings"
        aria-expanded={expanded}
        disabled={disabled}
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className={`kitty-mode-dot ${settings.aiMode}`}
          aria-hidden="true"
        />
        <span>{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {expanded && (
        <section
          className="kitty-model-panel"
          aria-label="Model and connection settings"
        >
          <header>
            <strong>Model &amp; connection</strong>
            <button
              type="button"
              className="kitty-close"
              aria-label="Close model settings"
              onClick={() => setExpanded(false)}
            >
              ×
            </button>
          </header>
          <div className="kitty-model-fields">
            <label>
              Run AI
              <select
                aria-label="AI provider"
                disabled={disabled}
                value={settings.aiMode}
                onChange={(e) =>
                  settings.update({
                    aiMode: e.target.value as "local" | "cloud",
                  })
                }
              >
                <option value="local">On this device</option>
                <option value="cloud">Cloud · OpenAI</option>
              </select>
            </label>
            {settings.aiMode === "cloud" && (
              <label>
                Model
                <select
                  aria-label="Cloud model"
                  disabled={disabled || !cloud.configured}
                  value={settings.cloudModel}
                  onChange={(e) =>
                    settings.update({ cloudModel: e.target.value })
                  }
                >
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {settings.aiMode === "cloud" ? <CloudSetup /> : <KittySetup />}
        </section>
      )}
    </div>
  );
}
