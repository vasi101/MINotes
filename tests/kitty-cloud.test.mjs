import test from "node:test";
import assert from "node:assert/strict";
import { CloudAIService } from "../server/kitty/cloud.mjs";

test("cloud failures distinguish missing API credit and model access", async () => {
  for (const [status, code, text] of [
    [429, "insufficient_quota", "no available credit"],
    [404, "model_not_found", "not available to your API key"],
  ]) {
    const cloud = new CloudAIService({
      apiKey: "fixture",
      fetcher: async () =>
        Response.json(
          { error: { code, message: "private upstream message" } },
          { status },
        ),
    });
    await assert.rejects(
      cloud.request("cloud-generate", args),
      (error) =>
        error.message.includes(text) && !error.message.includes("private"),
    );
  }
});

const args = {
  requestId: "test",
  model: "gpt-5-mini",
  system: "Explain quoted material.",
  prompt: '{"selectedText":"diplomacy"}',
};
const events = [
  { type: "response.web_search_call.in_progress" },
  { type: "response.output_text.delta", delta: "An answer [1]." },
  {
    type: "response.completed",
    response: {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "An answer [1].",
              annotations: [
                {
                  type: "url_citation",
                  url: "https://example.com/source",
                  title: "Source",
                  start_index: 10,
                  end_index: 13,
                },
                {
                  type: "url_citation",
                  url: "javascript:alert(1)",
                  start_index: 0,
                  end_index: 1,
                },
              ],
            },
          ],
        },
      ],
    },
  },
];
function stream(values) {
  const text = values
    .map(
      (event) =>
        `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`,
    )
    .join("");
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7)
          controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    }),
  );
}
test("cloud stream handles chunk boundaries, tool status and safe citations", async () => {
  const calls = [],
    updates = [];
  const service = new CloudAIService({
    apiKey: "fixture-key",
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return stream(events);
    },
  });
  const result = await service.request(
    "cloud-generate",
    { ...args, webSearch: true },
    (event) => updates.push(event),
  );
  assert.equal(result.text, "An answer [1].");
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].start, 10);
  assert.ok(updates.some((e) => e.phase === "searching"));
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.equal(body.tools[0].type, "web_search");
  assert.equal(body.tool_choice, "required");
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(JSON.stringify(service.status()).includes("fixture-key"), false);
});
test("search is absent when disabled and cloud needs its own key", async () => {
  let body;
  const service = new CloudAIService({
    apiKey: "",
    fetcher: async (_url, options) => {
      body = JSON.parse(options.body);
      return stream(events);
    },
  });
  await assert.rejects(
    service.request("cloud-generate", args),
    /Connect Cloud AI/,
  );
  service.apiKey = "fixture";
  await service.request("cloud-generate", args);
  assert.equal(body.tools, undefined);
});
test("connect lists text models, does not expose key, and disconnect clears it", async () => {
  const service = new CloudAIService({
    apiKey: "",
    fetcher: async () =>
      Response.json({
        data: [
          { id: "gpt-5-mini" },
          { id: "gpt-4.1" },
          { id: "gpt-image-1" },
          { id: "tts-1" },
        ],
      }),
  });
  const status = await service.request("cloud-connect", {
    apiKey: "fixture-key",
    requestId: "connect",
  });
  assert.deepEqual(status, {
    configured: true,
    models: ["gpt-4.1", "gpt-5-mini"],
  });
  assert.deepEqual(await service.request("cloud-disconnect"), {
    configured: false,
    models: [],
  });
});
test("provider errors are sanitized, interrupted streams are not success", async () => {
  for (const status of [401, 429, 500]) {
    const service = new CloudAIService({
      apiKey: "fixture",
      fetcher: async () =>
        new Response("secret raw upstream error", { status }),
    });
    await assert.rejects(
      service.request("cloud-generate", args),
      (error) =>
        !error.message.includes("secret") &&
        /key|limit|unavailable/.test(error.message),
    );
  }
  const service = new CloudAIService({
    apiKey: "fixture",
    fetcher: async () => stream(events.slice(0, 2)),
  });
  await assert.rejects(service.request("cloud-generate", args), /interrupted/);
});
test("cancelling aborts the actual cloud request", async () => {
  let aborted = false;
  const service = new CloudAIService({
    apiKey: "fixture",
    fetcher: async (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        }),
      ),
  });
  const pending = service.request("cloud-generate", args);
  service.cancel(args.requestId);
  await assert.rejects(pending, /stopped/);
  assert.equal(aborted, true);
  assert.equal(service.operations.size, 0);
});
