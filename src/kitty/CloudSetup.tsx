import { useEffect, useState } from "react";
import { useCloudAI } from "./cloudStore";

export default function CloudSetup() {
  const cloud = useCloudAI();
  const [key, setKey] = useState("");
  useEffect(() => {
    void cloud.refresh();
  }, []);
  return (
    <section className="kitty-setup" aria-label="Cloud AI setup">
      <h3>Cloud AI · OpenAI</h3>
      <p>
        Cloud actions send your selection, question, and nearby context to
        OpenAI. API usage is billed to your account. Web search also uses online
        sources.
      </p>
      {cloud.configured ? (
        <>
          <p className="kitty-setup-ready">Connected for this session</p>
          <button disabled={cloud.busy} onClick={() => void cloud.connect()}>
            Refresh models
          </button>
          <button disabled={cloud.busy} onClick={() => void cloud.disconnect()}>
            Disconnect
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = key;
            void cloud.connect(value).then((connected) => {
              if (connected) setKey("");
            });
          }}
        >
          <label>
            OpenAI API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…"
              maxLength={512}
            />
          </label>
          <button disabled={cloud.busy || !key.trim()} type="submit">
            {cloud.busy ? "Connecting…" : "Connect Cloud AI"}
          </button>
        </form>
      )}
      <p>
        Your key stays in memory for this app session. It is not saved with
        notes or browser settings.
      </p>
      {cloud.error && <p role="alert">{cloud.error}</p>}
    </section>
  );
}
