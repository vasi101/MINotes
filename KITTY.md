# Kitty

Select text in Notes or Read to open Meaning, Explain, Summarize, Simplify, Translate, or Ask Kitty. Right-click and Ctrl+Shift+K also open the menu. Automatic opening follows Ask on Selection in settings. Opening a menu never generates an answer.

AI responses stream into the rounded, expanding Kitty card. In Read, the card expands from the existing page-counter cat. Close, Escape, outside clicks and document changes cancel active requests. Copy, follow-up questions, Regenerate and Save as note are available. Notes also supports Insert and translation Replace with stale-selection checks and undo.

## Dictionary

Meaning remains a separate dictionary action with its compact popup and never silently sends a word to AI. Single English words are normalized without removing internal apostrophes or hyphens; multiple words show an individual-word message.

The replaceable provider uses FreeDictionaryAPI.com with Wiktionary attribution. Desktop requests use a fixed native HTTP endpoint, browser requests use CORS. Only the word is sent. Successful definitions are cached for 90 days with a 300-entry limit and in-flight deduplication; cached entries remain available offline. The old dictionaryapi.dev endpoint was replaced after an observed HTTP 522 failure. Both native and browser requests have an 8-second timeout.

## Local and Cloud AI

The selection menu contains only actions. Ask AI opens an idle composer. Open the model button in the answer card, reading controls or Settings > Kitty to choose a provider and model. Less frequent answer actions are under More; follow-up actions are under Actions.

- **On this device:** Uses the installed Kitty model. Choose the model button or Settings to install/change it. Inference runs on the device. Optional web search sends a short search query online and supplies retrieved excerpts to the local model.
- **Cloud / OpenAI:** Open Settings within the card and connect an OpenAI API key. The backend validates the key and lists available text models. Choose the model from the selector. Usage is billed to the user's OpenAI API account. A ChatGPT subscription is not an API key.

Cloud keys are held only in backend process memory for this app session, not localStorage, sessionStorage, note files or the model configuration. Restarting the app requires reconnecting. An OPENAI_API_KEY environment variable is also accepted by the backend; Refresh models validates and lists its models. Disconnect clears the in-memory key and cancels active cloud requests.

Cloud uses the OpenAI Responses API through the existing native worker or same-origin browser backend. Requests stream, set store:false, have a two-minute timeout, and send only the selected text, up to 1,200 characters of nearby context, the question and a bounded previous answer for follow-ups. Local mode never automatically falls back to Cloud. Browser middleware is restricted to localhost and same-origin JSON POST requests.

**Web search:** An explicit toggle available to Local and Cloud AI in Notes and Read, for Explain and Ask AI. Cloud invokes the OpenAI web_search tool. Local mode retrieves public DuckDuckGo search excerpts without an API key, with a clearly labeled Wikipedia fallback when search is unavailable. It sends the question and a short selection excerpt as a bounded query; it does not upload the document or call cloud inference. The answer includes clickable citations and an expandable source list. Copy/Save include source URLs. Summarize, Simplify and Translate work only on the selected material and do not search even if the toggle is on.

**Translation:** A separate translation route uses the selected Local or Cloud model, initially supporting English and Nepali. It preserves paragraph breaks. Change the language in the result card to translate again. Translation is model-based, not a dedicated third-party translation API; local quality depends on the installed model.

Cloud implementation references: [streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses), [web search](https://developers.openai.com/api/docs/guides/tools-web-search).

## First-time local AI setup

Open the cat without selected text, or **Settings ? Kitty**, and click **Set up Kitty**. The app checks usable RAM, CPU/architecture, OS, graphics adapters, dedicated VRAM where available, and free space on the model drive. It recommends a compatible model. **Install Kitty** downloads it, verifies SHA-256, initializes the runtime, and performs a small test inference before reporting success.

Normal controls use names such as Kitty Light and Kitty Balanced. Model version, quantization, context size, backend, file location and model license are available under Advanced. The bundled catalogue currently uses publisher-provided Qwen2.5 Instruct GGUF files (0.5B, 1.5B and 3B, Q4_K_M); the versions, pinned revisions, hashes, sizes, hardware thresholds and backend preferences are data in `server/kitty/model-manifest.json`. This can be updated independently of setup logic. Catalogue file sizes and SHA-256 values were checked against publisher metadata on 2026-09-28.

**Pause setup** retains a partial file. After reopening Mi Notes, click Set up Kitty and **Resume setup**. HTTP range responses are validated; a server that ignores Range restarts the file cleanly. The complete file must match both its expected size and SHA-256 before it is promoted to an installed model. Disk checks account for already downloaded bytes and a reserve. Setup continues while reading elsewhere in the app.

Models and configuration are stored under `%LOCALAPPDATA%/MINOTE/AI/` on Windows. **Remove Local AI** deletes only manifest-owned model and partial files, leaving notes and dictionary cache intact. Model changes retain the old installation until the new model passes validation.

## Managed runtime

The desktop app bundles Node and [node-llama-cpp](https://node-llama-cpp.withcat.ai/guide/). It starts a hidden worker on demand and communicates over private stdin/stdout IPC; no Ollama installation, localhost server, model-file picker or manual backend configuration is required. The CPU and installed native GPU dependencies travel with the Windows x64 installer.

Setup tries CUDA on NVIDIA, then Vulkan when a graphics adapter is present, then CPU. It verifies the actual backend and runs a short inference instead of assuming that a detected GPU works. The runtime is configured to use bundled native binaries and never compiles or downloads executable backends on the user's computer. Model download URLs are fixed by the bundled manifest; the UI cannot supply arbitrary paths or URLs.

Startup/status checks do not load a model. AI requests load the selected model lazily and stream text. The model stays warm for the selected interval (10 minutes by default), then releases its model/context resources. Setup unloads the model after its test. Closing the app terminates the worker. Local inference receives only the selected passage, the question and at most 1,200 characters of nearby context; local-mode content is not sent to a remote AI service. Cloud is a separate explicit choice.

In browser development, Vite exposes the same service through same-origin `/api/kitty/` routes restricted to localhost. This development transport is not a publicly hosted AI endpoint.

## Reading and writing

PDFs open in Select Text mode. Press V to return to selection after drawing; H explicitly activates highlighting. Copy and Add to Note work with PDF answers. Notes additionally support Insert and translation Replace with stale-selection checks and canvas undo. Image-only PDFs need a text layer; Kitty does not add OCR.

## Development and validation

- `node --test --test-isolation=none tests/kitty-search.test.mjs tests/kitty-cloud.test.mjs tests/kitty-setup.test.mjs`: Cloud SSE parsing, citations, connection/key lifecycle, sanitized errors, cancellation, and local setup/runtime checks with fixtures.
- `npx playwright test tests/dictionary.spec.ts tests/kitty-ai.spec.ts tests/kitty-routing.spec.ts tests/kitty-ui.spec.ts tests/reader-kitty.spec.ts tests/kitty-setup-ui.spec.ts`: Notes/Read selection, dictionary separation, both AI modes, model selection, translation, citations, copy/save/insert/replace, failure/retry, cancellation, responsive themes and local setup.
- `npm run build`: frontend type check and production bundle.
- `cargo check --manifest-path src-tauri/Cargo.toml`: native bridge compile check.
- `node scripts/prepare-kitty-runtime.mjs`: packages backend files, native dependencies and Node. The Tauri build script invokes this automatically.

Cloud and local inference tests use controlled responses; real cloud generation requires the user's API key and real local generation requires an installed model. These tests do not establish model translation quality. Live dictionary requests returned entries for convey, diplomacy, government, sovereignty, international, development, don't and well-being; xyzabc returned no entry.

Desktop bridge errors preserve backend messages, including missing keys, API credit and unavailable models. Cloud model choices are filtered for the supported Responses interface, and connecting selects an available model if the saved choice is unavailable. A real public local-search request was verified; cloud generation remains fixture-tested without a user API key.

The compact reader page pill opens chat directly when the cat is clicked. It captures the selection or up to 16,000 characters of text from the current page. If no text layer is available, Kitty can answer a general question without claiming to read the PDF. The arrow retains reading controls. Closing chat restores the compact pill. AI explanations and answers request Markdown headings and short points, rendered as safe React elements with bold text and source citations; raw HTML is never executed.

Existing Documents model: Kitty detects Documents/AI/models/Qwen3.5-2B_Q4_k_m.gguf, validates the GGUF header and uses the file in place. A manually installed managed model takes precedence after choosing Change model. Existing external files are never removed by Kitty. Local inference limits thought tokens so reasoning-capable models return a visible answer within the output budget. A real CPU inference with the user's Qwen3.5 2B file succeeded.
