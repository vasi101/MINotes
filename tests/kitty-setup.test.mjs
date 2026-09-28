import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { downloadModel } from "../server/kitty/download.mjs";
import { selectModel, backendOrder } from "../server/kitty/hardware.mjs";
import { KittyAIService, manifest } from "../server/kitty/service.mjs";
import { NodeLlamaProvider } from "../server/kitty/runtime.mjs";

const hardware = (ramGB = 16, vramGB = 0) => ({
  ramGB,
  availableRamGB: 10,
  diskFreeBytes: 20e9,
  architecture: "x64",
  gpus: vramGB ? [{ name: "NVIDIA GPU", vendor: "NVIDIA", vramGB }] : [],
});
const fixture = () => {
  const bytes = Buffer.from("A small verified model fixture.");
  return {
    bytes,
    model: {
      id: "fixture",
      filename: "fixture.gguf",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: "https://example.invalid/model",
    },
  };
};

test("recommendations follow manifest, RAM, graphics, disk and architecture", () => {
  assert.equal(selectModel(hardware(4), manifest).recommendedId, "kitty-light");
  assert.equal(
    selectModel(hardware(8), manifest).recommendedId,
    "kitty-balanced",
  );
  assert.equal(
    selectModel(hardware(16), manifest).recommendedId,
    "kitty-balanced",
  );
  assert.equal(
    selectModel(hardware(16, 6), manifest).recommendedId,
    "kitty-quality",
  );
  assert.equal(
    selectModel({ ...hardware(), diskFreeBytes: 10 }, manifest).recommendedId,
    null,
  );
  assert.equal(
    selectModel({ ...hardware(), architecture: "ia32" }, manifest)
      .recommendedId,
    null,
  );
  assert.deepEqual(backendOrder(hardware(16, 6)), ["cuda", "vulkan", "cpu"]);
  assert.deepEqual(backendOrder(hardware()), ["cpu"]);
  const changed = structuredClone(manifest);
  changed.models[1].recommendedRamGB = 32;
  assert.equal(selectModel(hardware(8), changed).recommendedId, "kitty-light");
});
test("interrupted downloads resume from a validated range and verify SHA256", async () => {
  const root = await mkdtemp(join(tmpdir(), "minotes-kitty-test-"));
  const { bytes, model } = fixture();
  await writeFile(join(root, "fixture.gguf.part"), bytes.subarray(0, 7));
  const phases = [];
  const path = await downloadModel(
    model,
    root,
    new AbortController().signal,
    (p) => phases.push(p.phase),
    async (_url, options) => {
      assert.equal(options.headers.Range, "bytes=7-");
      return new Response(bytes.subarray(7), {
        status: 206,
        headers: {
          "Content-Range": `bytes 7-${bytes.length - 1}/${bytes.length}`,
        },
      });
    },
  );
  assert.deepEqual(await readFile(path), bytes);
  assert(phases.includes("verifying"));
  await assert.rejects(stat(path + ".part"));
});
test("server ignoring ranges restarts cleanly instead of appending duplicate bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "minotes-kitty-test-"));
  const { bytes, model } = fixture();
  await writeFile(join(root, "fixture.gguf.part"), bytes.subarray(0, 3));
  const path = await downloadModel(
    model,
    root,
    new AbortController().signal,
    () => {},
    async () => new Response(bytes),
  );
  assert.deepEqual(await readFile(path), bytes);
});
test("bad checksums, unexpected ranges and path injection cannot install a model", async () => {
  const root = await mkdtemp(join(tmpdir(), "minotes-kitty-test-"));
  const { bytes, model } = fixture();
  await assert.rejects(
    downloadModel(
      { ...model, filename: "../outside.gguf" },
      root,
      new AbortController().signal,
      () => {},
    ),
    /manifest/,
  );
  await assert.rejects(
    downloadModel(
      model,
      root,
      new AbortController().signal,
      () => {},
      async () => new Response(Buffer.alloc(bytes.length)),
    ),
    /verification/,
  );
  await assert.rejects(stat(join(root, "fixture.gguf")));
  await writeFile(join(root, "fixture.gguf.part"), bytes.subarray(0, 3));
  await assert.rejects(
    downloadModel(
      model,
      root,
      new AbortController().signal,
      () => {},
      async () =>
        new Response(bytes, {
          status: 206,
          headers: {
            "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
          },
        }),
    ),
    /range/,
  );
});
test("aborted download retains its partial file and never promotes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "minotes-kitty-test-"));
  const { bytes, model } = fixture();
  const controller = new AbortController();
  const response = new Response(
    new ReadableStream({
      start(stream) {
        stream.enqueue(bytes.subarray(0, 8));
      },
      pull(stream) {
        controller.abort();
        stream.enqueue(bytes.subarray(8));
        stream.close();
      },
    }),
  );
  await assert.rejects(
    downloadModel(
      model,
      root,
      controller.signal,
      () => {},
      async () => response,
    ),
  );
  await assert.rejects(stat(join(root, "fixture.gguf")));
});
test("status never initializes a model; install commits only after validation and unloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "minotes-kitty-test-"));
  const calls = [];
  const runtime = {
    backend: "cpu",
    load: async () => calls.push("load"),
    unload: async () => calls.push("unload"),
  };
  const service = new KittyAIService({
    documentsModelDirectory: null,
    root,
    runtime,
    analyze: async () => hardware(),
    download: async () => {
      calls.push("download");
      return "/fixture.gguf";
    },
  });
  assert.equal((await service.request("status")).installed, null);
  assert.deepEqual(calls, []);
  await assert.rejects(
    service.request("generate", { requestId: "g", system: "s", prompt: "p" }),
    /Set up Kitty/,
  );
  await service.request("install", { requestId: "i", modelId: "kitty-light" });
  assert.deepEqual(calls, ["unload", "download", "load", "unload"]);
  const config = JSON.parse(await readFile(join(root, "config.json")));
  assert.equal(config.modelId, "kitty-light");
  assert.equal(config.backend, "cpu");
});
test("failed validation does not mark the model installed", async () => {
  const root = await mkdtemp(join(tmpdir(), "minotes-kitty-test-"));
  const service = new KittyAIService({
    documentsModelDirectory: null,
    root,
    runtime: {
      unload: async () => {},
      load: async () => {
        throw Error("backend failed");
      },
    },
    analyze: async () => hardware(),
    download: async () => "/fixture.gguf",
  });
  await assert.rejects(
    service.request("install", { requestId: "i", modelId: "kitty-light" }),
    /backend failed/,
  );
  assert.equal((await service.status()).installed, null);
  await assert.rejects(stat(join(root, "config.json")));
});
test("cancellation targets the active operation and releases the busy lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "minotes-kitty-test-"));
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const service = new KittyAIService({
    documentsModelDirectory: null,
    root,
    runtime: { unload: async () => {} },
    analyze: async () => hardware(),
    download: async (_model, _path, signal) => {
      started();
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    },
  });
  const installing = service.request("install", {
    requestId: "install-1",
    modelId: "kitty-light",
  });
  const failure = assert.rejects(installing);
  await ready;
  await assert.rejects(
    service.request("install", {
      requestId: "install-2",
      modelId: "kitty-light",
    }),
    /busy/,
  );
  await service.request("cancel", {
    requestId: "cancel-1",
    targetId: "install-1",
  });
  await failure;
  assert.equal(service.busy, false);
  assert.equal(service.progress.phase, "paused");
});

test("backend failures fall through CUDA and Vulkan to tested CPU and idle model unloads", async () => {
  const tried = [],
    phases = [];
  let disposed = 0;
  const runtime = new NodeLlamaProvider(async () => ({
    getLlama: async (options) => {
      tried.push(options.gpu);
      assert.equal(options.build, "never");
      assert.equal(options.skipDownload, true);
      return {
        gpu: options.gpu,
        dispose: async () => {},
        loadModel: async () => {
          if (options.gpu) throw Error("GPU driver unavailable");
          return {
            dispose: async () => {
              disposed++;
            },
            createContext: async () => ({
              getSequence: () => ({}),
              dispose: async () => {},
            }),
          };
        },
      };
    },
    LlamaChatSession: class {
      async prompt(_text, options) {
        options.onTextChunk?.("Answer");
        return "Answer";
      }
      async dispose() {}
    },
  }));
  const model = manifest.models[0];
  const answer = await runtime.generate(
    model,
    "/fixture.gguf",
    hardware(16, 6),
    { system: "system", prompt: "text", keepWarmMinutes: 0 },
    new AbortController().signal,
    (p) => phases.push(p),
  );
  assert.equal(answer, "Answer");
  assert.deepEqual(tried, ["cuda", "vulkan", false]);
  assert.equal(runtime.backend, "cpu");
  assert(phases.some((p) => p.phase === "validated" && p.backend === "cpu"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.model, undefined);
  assert(disposed > 0);
});
test("resuming disk checks count only remaining bytes and the reserve", () => {
  const model = manifest.models[1];
  const h = {
    ...hardware(8),
    diskFreeBytes: manifest.diskReserveBytes + 100000000,
  };
  assert(!selectModel(h, manifest).compatibleIds.includes(model.id));
  assert(
    selectModel(h, manifest, {
      [model.id]: model.sizeBytes - 50000000,
    }).compatibleIds.includes(model.id),
  );
});

test("Documents model is used in place, validates its header, and is never deleted", async () => {
  const root = await mkdtemp(join(tmpdir(), "kitty-documents-"));
  const directory = join(root, "documents");
  await mkdir(directory);
  const path = join(directory, "Qwen3.5-2B_Q4_k_m.gguf");
  const bytes = Buffer.alloc(1000008);
  bytes.write("GGUF");
  bytes.writeUInt32LE(3, 4);
  await writeFile(path, bytes);
  let used;
  const service = new KittyAIService({
    root: join(root, "managed"),
    documentsModelDirectory: directory,
    analyze: async () => hardware(),
    runtime: {
      unload: async () => {},
      generate: async (info, file) => {
        used = { info, file };
        return "A real answer";
      },
    },
  });
  assert.equal((await service.status()).installed.displayName, "Qwen3.5 2B");
  assert.deepEqual(
    await service.request("generate", {
      prompt: "Question",
      system: "Help",
      requestId: "external",
    }),
    { text: "A real answer" },
  );
  assert.equal(used.file, path);
  await service.request("remove");
  assert.equal((await stat(path)).size, bytes.length);
  assert.equal((await service.status()).installed, null);
  await service.save({});
  await writeFile(path, Buffer.alloc(bytes.length));
  assert.equal((await service.status()).installed, null);
});
