import { useEffect, useState } from "react";
import { useKittySetup } from "./setupStore";
const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
export default function KittySetup() {
  const setup = useKittySetup();
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    void setup.refresh();
  }, []);
  const model = setup.analysis?.models.find((m) => m.id === setup.selected);
  const progress = setup.progress;
  const percent = progress?.total
    ? Math.min(
        100,
        Math.floor(((progress.completed ?? 0) / progress.total) * 100),
      )
    : 0;
  const installed = setup.status?.installed;
  const hardware = setup.analysis?.hardware;
  const busy = setup.installing || setup.checking;
  const phases: Record<string, string> = {
    downloading: "Downloading AI model",
    verifying: "Verifying download",
    loading: "Starting local AI",
    testing: "Checking your computer can run Kitty",
    validated: "Finishing setup",
    ready: "Kitty is ready",
    paused: "Download paused",
  };
  return (
    <section className="kitty-setup" aria-label="Kitty AI setup">
      <h3>{installed ? "Kitty AI" : "Meet Kitty AI"}</h3>
      {!installed && !hardware && (
        <p>
          Private AI for Mi Notes. Set up once, then use it offline on this
          computer. Dictionary meanings work without setup.
        </p>
      )}
      {installed && (
        <>
          <p className="kitty-setup-ready">
            {installed.external ? "Using existing file" : "Installed"} ✓ ·{" "}
            {installed.displayName}
          </p>
          <p>
            {installed.backend === "automatic"
              ? "Ready to load from Documents"
              : installed.backend === "cpu"
                ? "Runs on your CPU"
                : `${installed.backend.toUpperCase()} acceleration verified`}{" "}
            · {gb(installed.sizeBytes)}
          </p>
        </>
      )}
      {!setup.analysis && !setup.installing && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void setup.analyze()}
        >
          {setup.checking
            ? "Checking your computer…"
            : installed
              ? "Change model"
              : "Set up Kitty"}
        </button>
      )}
      {hardware && (
        <>
          <p>
            <strong>Your computer</strong>
            <br />
            {Math.round(hardware.ramGB)} GB memory · {hardware.cores} CPU cores
            <br />
            {hardware.gpus
              .map(
                (g) =>
                  g.name +
                  (g.vramGB
                    ? ` · ${g.vramGB.toFixed(1)} GB graphics memory`
                    : ""),
              )
              .join(", ") || "CPU processing"}
            <br />
            {gb(hardware.diskFreeBytes)} free space
          </p>
          <label>
            Model
            <select
              aria-label="Kitty model"
              disabled={busy}
              value={setup.selected}
              onChange={(e) => setup.choose(e.target.value)}
            >
              {setup.analysis!.models.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  disabled={!setup.analysis!.compatibleIds.includes(m.id)}
                >
                  {m.displayName}
                  {m.id === setup.analysis!.recommendedId
                    ? " — Recommended"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {model && (
            <p>
              {model.description}
              <br />
              Approximately {gb(model.sizeBytes)} download. Acceleration is
              selected and tested automatically.
            </p>
          )}
          {setup.analysis?.reason && <p>{setup.analysis.reason}</p>}
          {!setup.installing && (
            <button
              type="button"
              disabled={
                busy || !setup.analysis!.compatibleIds.includes(setup.selected)
              }
              onClick={() => void setup.install()}
            >
              {setup.status?.partials.some((p) => p.modelId === setup.selected)
                ? "Resume setup"
                : installed
                  ? "Install selected model"
                  : "Install Kitty"}
            </button>
          )}
        </>
      )}
      {progress && (
        <div aria-live="polite">
          <p>
            {phases[progress.phase] || progress.error || "Setting up Kitty…"}
          </p>
          {progress.total ? (
            <>
              <progress max={100} value={percent} />
              <p>
                {percent}% · {gb(progress.completed ?? 0)} /{" "}
                {gb(progress.total)}
              </p>
            </>
          ) : null}
          {setup.installing && (
            <>
              <p>You can continue using Mi Notes.</p>
              <button type="button" onClick={setup.pause}>
                Pause setup
              </button>
            </>
          )}
        </div>
      )}
      {setup.error && <p role="alert">{setup.error}</p>}
      {(model || installed) && (
        <details>
          <summary>Advanced</summary>
          <p>
            {model?.model ?? installed?.model} ·{" "}
            {model?.quantization ?? installed?.quantization}
            <br />
            Context: {model?.contextSize ?? installed?.contextSize}
            <br />
            Backend: {installed?.backend ?? "Automatic, validated during setup"}
          </p>
          {hardware && (
            <p>
              {hardware.cpu}
              <br />
              {hardware.os} · {hardware.architecture}
            </p>
          )}
          {installed?.path && (
            <p className="kitty-setup-path">{installed.path}</p>
          )}
          {model && (
            <a href={model.licenseUrl} target="_blank" rel="noreferrer">
              Model details and license
            </a>
          )}
        </details>
      )}
      {installed &&
        !installed.external &&
        !busy &&
        (!removing ? (
          <button
            type="button"
            className="kitty-text-button"
            onClick={() => setRemoving(true)}
          >
            Remove Local AI
          </button>
        ) : (
          <div>
            <p>
              Remove downloaded AI models? Your notes and dictionary cache stay
              saved.
            </p>
            <button
              type="button"
              onClick={() => {
                setRemoving(false);
                void setup.remove();
              }}
            >
              Remove models
            </button>
            <button type="button" onClick={() => setRemoving(false)}>
              Keep models
            </button>
          </div>
        ))}
    </section>
  );
}
