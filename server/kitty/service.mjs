import {
  readFile,
  writeFile,
  mkdir,
  stat,
  rename,
  unlink,
  open,
} from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { analyzeHardware, selectModel } from "./hardware.mjs";
import { downloadModel } from "./download.mjs";
import { NodeLlamaProvider } from "./runtime.mjs";
import { CloudAIService } from "./cloud.mjs";
import { WebSearchService } from "./search.mjs";

export const manifest = JSON.parse(
  await readFile(new URL("./model-manifest.json", import.meta.url), "utf8"),
);
export class KittyAIService {
  constructor({
    root = join(
      process.env.LOCALAPPDATA || join(homedir(), ".local", "share"),
      "MINOTE",
      "AI",
    ),
    runtime = new NodeLlamaProvider(),
    analyze = analyzeHardware,
    download = downloadModel,
    documentsModelDirectory = join(homedir(), "Documents", "AI", "models"),
  } = {}) {
    this.cloud = new CloudAIService();
    this.search = new WebSearchService();
    this.documentsModelDirectory = documentsModelDirectory;
    this.root = root;
    this.runtime = runtime;
    this.analyze = analyze;
    this.download = download;
    this.operations = new Map();
    this.progress = { phase: "idle" };
    this.busy = false;
  }
  async config() {
    try {
      return JSON.parse(await readFile(join(this.root, "config.json"), "utf8"));
    } catch {
      return {};
    }
  }
  async documentsModel(config = {}) {
    if (config.useDocumentsModel === false || !this.documentsModelDirectory)
      return null;
    const path = join(this.documentsModelDirectory, "Qwen3.5-2B_Q4_k_m.gguf");
    let handle;
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size < 1000000) return null;
      handle = await open(path, "r");
      const header = Buffer.alloc(8);
      await handle.read(header, 0, 8, 0);
      if (
        header.toString("ascii", 0, 4) !== "GGUF" ||
        ![2, 3].includes(header.readUInt32LE(4))
      )
        return null;
      return {
        id: "documents-qwen35-2b",
        displayName: "Qwen3.5 2B",
        model: "Qwen3.5 2B",
        quantization: "Q4_K_M",
        contextSize: 4096,
        sizeBytes: info.size,
        path,
        external: true,
        backend: this.runtime.backend || "automatic",
        backends: ["cuda", "vulkan", "cpu"],
      };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(
        "Could not read the model in Documents/AI/models. Check file access.",
      );
    } finally {
      await handle?.close();
    }
  }
  async existingBytes() {
    const sizes = {};
    for (const model of manifest.models) {
      const final = await stat(join(this.root, "models", model.filename))
        .then((s) => s.size)
        .catch(() => 0);
      const partial = await stat(
        join(this.root, "models", model.filename + ".part"),
      )
        .then((s) => s.size)
        .catch(() => 0);
      sizes[model.id] = Math.min(model.sizeBytes, final || partial);
    }
    return sizes;
  }
  async save(config) {
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, "config.json.tmp"), JSON.stringify(config));
    await rename(
      join(this.root, "config.json.tmp"),
      join(this.root, "config.json"),
    );
  }
  async status() {
    const config = await this.config();
    const documentsModel = await this.documentsModel(config);
    const installed = manifest.models.find((m) => m.id === config.modelId);
    const exists =
      installed &&
      (await stat(join(this.root, "models", installed.filename))
        .then((s) => s.size === installed.sizeBytes)
        .catch(() => false));
    const partials = [];
    for (const m of manifest.models) {
      const bytes = await stat(join(this.root, "models", m.filename + ".part"))
        .then((s) => s.size)
        .catch(() => 0);
      if (bytes)
        partials.push({ modelId: m.id, completed: bytes, total: m.sizeBytes });
    }
    return {
      installed:
        documentsModel ??
        (exists
          ? {
              id: installed.id,
              displayName: installed.displayName,
              sizeBytes: installed.sizeBytes,
              backend: config.backend,
              model: installed.model,
              quantization: installed.quantization,
              contextSize: installed.contextSize,
              path: join(this.root, "models", installed.filename),
            }
          : null),
      progress: this.progress,
      busy: this.busy,
      partials,
      loaded: !!this.runtime.model,
      models: manifest.models,
    };
  }
  async request(method, args = {}, emit = () => {}) {
    if (method === "web-search") return this.search.search(args);
    if (method.startsWith("cloud-"))
      return this.cloud.request(method, args, emit);
    if (method === "status") return this.status();
    if (method === "hardware") {
      const hardware = await this.analyze(this.root);
      return {
        hardware,
        ...selectModel(hardware, manifest, await this.existingBytes()),
        models: manifest.models,
      };
    }
    if (method === "cancel") {
      this.operations.get(args.targetId)?.abort();
      this.cloud.cancel(args.targetId);
      this.search.cancel(args.targetId);
      return { cancelled: true };
    }
    if (!["install", "generate", "remove"].includes(method))
      throw new Error("Unknown Kitty action.");
    if (this.busy)
      throw new Error(
        "Kitty is busy. Finish or cancel the current task first.",
      );
    this.busy = true;
    const controller = new AbortController();
    this.operations.set(args.requestId, controller);
    const signal = controller.signal;
    const timer =
      method === "generate"
        ? setTimeout(
            () =>
              controller.abort(
                new Error("The answer took too long. Try a shorter selection."),
              ),
            180000,
          )
        : undefined;
    const progress = (update) => {
      this.progress = update;
      emit(update);
    };
    try {
      if (method === "remove") {
        await this.runtime.unload();
        // Only manifest-owned files are removable. Never accept a path from the UI.
        for (const model of manifest.models)
          for (const suffix of ["", ".part"])
            await unlink(
              join(this.root, "models", model.filename + suffix),
            ).catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
        await this.save({ useDocumentsModel: false });
        progress({ phase: "idle" });
        return this.status();
      }
      const hardware = await this.analyze(this.root);
      if (method === "install") {
        const model = manifest.models.find((m) => m.id === args.modelId);
        if (!model) throw new Error("Choose a supported Kitty model.");
        const compatible = selectModel(
          hardware,
          manifest,
          await this.existingBytes(),
        ).compatibleIds.includes(model.id);
        if (!compatible)
          throw new Error(
            "This model needs more memory or disk space. Choose a lighter model.",
          );
        await this.runtime.unload();
        progress({
          phase: "downloading",
          modelId: model.id,
          completed: 0,
          total: model.sizeBytes,
        });
        const path = await this.download(
          model,
          join(this.root, "models"),
          signal,
          progress,
        );
        await this.runtime.load(model, path, hardware, signal, progress);
        signal.throwIfAborted();
        await this.save({
          version: 1,
          useDocumentsModel: false,
          modelId: model.id,
          backend: this.runtime.backend,
          sha256: model.sha256,
        });
        await this.runtime.unload();
        progress({ phase: "ready", modelId: model.id });
        return { installed: true, modelId: model.id };
      }
      if (
        typeof args.prompt !== "string" ||
        args.prompt.length > 22000 ||
        typeof args.system !== "string" ||
        args.system.length > 5000
      )
        throw new Error("Select a shorter passage.");
      const config = await this.config(),
        external = await this.documentsModel(config),
        model =
          external ?? manifest.models.find((m) => m.id === config.modelId);
      if (!model || (!external && config.sha256 !== model.sha256))
        throw new Error(
          "Set up Kitty AI to use this action. Dictionary meanings work without AI.",
        );
      const text = await this.runtime.generate(
        model,
        external?.path ?? join(this.root, "models", model.filename),
        hardware,
        args,
        signal,
        progress,
      );
      progress({ phase: "ready" });
      return { text };
    } catch (error) {
      if (method === "install") await this.runtime.unload();
      progress({
        phase: signal.aborted ? "paused" : "error",
        error: signal.aborted
          ? "Paused. Your download can resume."
          : error.message,
      });
      throw error;
    } finally {
      clearTimeout(timer);
      this.operations.delete(args.requestId);
      this.busy = false;
    }
  }
}
