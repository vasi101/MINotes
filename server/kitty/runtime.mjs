import { performance } from "node:perf_hooks";
import { backendOrder } from "./hardware.mjs";

function trimRepeatedPhrase(text) {
  const words = text.trimEnd().split(/\s+/u);
  const firstPossibleStart = Math.max(0, words.length - 48);
  for (let start = firstPossibleStart; start <= words.length - 9; start++) {
    const maxPhraseLength = Math.min(16, Math.floor((words.length - start) / 3));
    for (let length = maxPhraseLength; length >= 3; length--) {
      let repetitions = 1;
      while (
        start + (repetitions + 1) * length <= words.length &&
        words
          .slice(start, start + length)
          .every(
            (word, index) =>
              word === words[start + repetitions * length + index],
          )
      ) {
        repetitions++;
      }
      if (repetitions >= 3)
        return {
          text: words.slice(0, start + length).join(" "),
          repeated: true,
        };
    }
  }
  return { text: text.trimEnd(), repeated: false };
}

export class NodeLlamaProvider {
  model;
  llama;
  backend;
  timer;
  modelId;
  constructor(loadBindings = () => import("node-llama-cpp")) {
    this.loadBindings = loadBindings;
  }
  async unload() {
    clearTimeout(this.timer);
    await this.model?.dispose();
    this.model = undefined;
    this.modelId = undefined;
    await this.llama?.dispose();
    this.llama = undefined;
  }
  async load(modelInfo, path, hardware, signal, progress) {
    clearTimeout(this.timer);
    if (this.model && this.modelId === modelInfo.id) return;
    await this.unload();
    const { getLlama, LlamaChatSession } = await this.loadBindings();
    const failures = [];
    for (const backend of backendOrder(hardware).filter((b) =>
      modelInfo.backends.includes(b),
    )) {
      signal.throwIfAborted();
      progress({ phase: "loading", backend });
      let context, session;
      try {
        this.llama = await getLlama({
          gpu: backend === "cpu" ? false : backend,
          build: "never",
          skipDownload: true,
          progressLogs: false,
          logLevel: "error",
          logger: () => {},
        });
        if (backend !== "cpu" && this.llama.gpu !== backend)
          throw new Error("Requested acceleration is unavailable.");
        this.model = await this.llama.loadModel({
          modelPath: path,
          gpuLayers: backend === "cpu" ? 0 : "auto",
          loadSignal: signal,
        });
        signal.throwIfAborted();
        context = await this.model.createContext({
          contextSize: modelInfo.contextSize,
        });
        session = new LlamaChatSession({
          contextSequence: context.getSequence(),
        });
        progress({ phase: "testing", backend });
        const start = performance.now();
        const result = await session.prompt("Reply with OK.", {
          maxTokens: 64,
          budgets: { thoughtTokens: 0 },
          signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
        });
        if (!result.trim()) throw new Error("No output from test inference.");
        this.backend = backend;
        this.modelId = modelInfo.id;
        progress({
          phase: "validated",
          backend,
          testMilliseconds: Math.round(performance.now() - start),
        });
        return;
      } catch (error) {
        failures.push(backend);
        await session?.dispose();
        session = undefined;
        await context?.dispose();
        context = undefined;
        await this.unload();
        signal.throwIfAborted();
      } finally {
        await session?.dispose();
        await context?.dispose();
      }
    }
    throw new Error(
      `Local AI could not start on this computer (${failures.join(", ")}). Try Kitty Light or update your graphics driver.`,
    );
  }
  async generate(info, path, hardware, args, signal, progress) {
    await this.load(info, path, hardware, signal, progress);
    const { LlamaChatSession } = await this.loadBindings();
    let context, session;
    try {
      context = await this.model.createContext({
        contextSize: info.contextSize,
      });
      session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: args.system,
      });
      let text = "";
      const repetitionStop = new AbortController();
      const generationSignal = args.translation
        ? AbortSignal.any([signal, repetitionStop.signal])
        : signal;
      const result = await session.prompt(args.prompt, {
        signal: generationSignal,
        stopOnAbortSignal: !!args.translation,
        budgets: { thoughtTokens: 0 },
        maxTokens: args.translation
          ? Math.min(768, Math.max(160, Math.ceil(args.prompt.length * 1.4)))
          : args.concise
            ? 180
            : 768,
        temperature: args.translation ? 0.05 : 0.3,
        ...(args.translation
          ? {
              repeatPenalty: { lastTokens: 128, penalty: 1.15 },
              dryRepeatPenalty: { strength: 0.8, allowedLength: 4 },
            }
          : {}),
        onTextChunk: (chunk) => {
          text += chunk;
          if (args.translation) {
            const checked = trimRepeatedPhrase(text);
            if (checked.repeated) {
              text = checked.text;
              repetitionStop.abort();
            }
          }
          progress({ phase: "generating", text });
        },
      });
      const output = args.translation ? trimRepeatedPhrase(result).text : result;
      if (!output.trim())
        throw new Error("Kitty returned an empty answer. Try again.");
      return output;
    } finally {
      await session?.dispose();
      await context?.dispose();
      const minutes = Number.isFinite(args.keepWarmMinutes)
        ? Math.max(0, Math.min(30, args.keepWarmMinutes))
        : 10;
      this.timer = setTimeout(() => {
        void this.unload();
      }, minutes * 60000);
      this.timer.unref();
    }
  }
}
