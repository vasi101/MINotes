import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchHTML, WebSearchService } from "../server/kitty/search.mjs";

const html =
  '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnepal&amp;rut=x">Nepal &amp; geography</a><a class="result__snippet">Nepal is in the <b>Northern</b> Hemisphere.</a>';
test("search parser returns plain excerpts and safe destination links", () => {
  assert.deepEqual(parseSearchHTML(html), [
    {
      title: "Nepal & geography",
      url: "https://example.com/nepal",
      excerpt: "Nepal is in the Northern Hemisphere.",
    },
  ]);
  assert.deepEqual(
    parseSearchHTML(
      html.replace(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnepal&amp;rut=x",
        "javascript:alert(1)",
      ),
    ),
    [],
  );
});
test("local search needs no cloud key and caches bounded public results", async () => {
  const calls = [];
  const search = new WebSearchService({
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return new Response(html);
    },
  });
  const result = await search.search({
    query: "Nepal hemispheres",
    requestId: "a",
  });
  assert.equal(result.provider, "DuckDuckGo");
  assert.equal(result.sources.length, 1);
  await search.search({ query: "Nepal hemispheres", requestId: "b" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  for (let i = 0; i < 65; i++)
    await search.search({ query: `example ${i}`, requestId: String(i) });
  assert.equal(search.cache.size, 60);
});
test("search challenge uses labeled Wikipedia fallback without bypassing it", async () => {
  const search = new WebSearchService({
    fetcher: async (url) =>
      url.includes("duckduckgo")
        ? new Response("challenge", { status: 202 })
        : Response.json({
            pages: [
              {
                key: "Nepal",
                title: "Nepal",
                excerpt: "<span>Nepal</span> is in South Asia.",
              },
            ],
          }),
  });
  const result = await search.search({ query: "Nepal", requestId: "a" });
  assert.equal(result.provider, "Wikipedia");
  assert.match(result.notice, /Wikipedia/);
  assert.equal(result.sources[0].url, "https://en.wikipedia.org/wiki/Nepal");
});
test("search errors are actionable and cancellation stops the request", async () => {
  const unavailable = new WebSearchService({
    fetcher: async () => {
      throw new TypeError("raw error");
    },
  });
  await assert.rejects(
    unavailable.search({ query: "Nepal", requestId: "a" }),
    /Web search is unavailable/,
  );
  const search = new WebSearchService({
    fetcher: async (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      ),
  });
  const pending = search.search({ query: "Nepal", requestId: "a" });
  search.cancel("a");
  await assert.rejects(pending, /cancelled/);
  assert.equal(search.operations.size, 0);
});
