import { performance } from "node:perf_hooks";
import { backendOrder } from "./hardware.mjs";

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
      const result = await session.prompt(args.prompt, {
        signal,
        budgets: { thoughtTokens: 0 },
        maxTokens: args.concise ? 180 : 768,
        temperature: args.translation ? 0.1 : 0.3,
        onTextChunk: (chunk) => {
          text += chunk;
          progress({ phase: "generating", text });
        },
      });
      if (!result.trim())
        throw new Error("Kitty returned an empty answer. Try again.");
      return result;
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
