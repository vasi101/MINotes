import { fetchModel } from "./network.mjs";

function plain(text = "") {
  const entities = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
  };
  return text
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
      (match, entity) => {
        if (!entity.startsWith("#"))
          return entities[entity.toLowerCase()] ?? match;
        const n =
          entity[1].toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}
export function parseSearchHTML(html) {
  const results = [];
  const links = [
    ...html.matchAll(
      /<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi,
    ),
  ];
  for (let i = 0; i < links.length && results.length < 4; i++) {
    const match = links[i];
    const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    let url;
    try {
      const redirect = new URL(plain(href), "https://duckduckgo.com");
      url = new URL(
        redirect.hostname.endsWith("duckduckgo.com")
          ? redirect.searchParams.get("uddg") || redirect.href
          : redirect.href,
      );
    } catch {
      continue;
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      /(^|\.)duckduckgo\.com$/.test(url.hostname) ||
      results.some((r) => r.url === url.href)
    )
      continue;
    const block = html.slice(
      match.index + match[0].length,
      links[i + 1]?.index ?? html.length,
    );
    const snippet = block.match(
      /<(?:a|div|span)\b[^>]*class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span)>/i,
    )?.[1];
    const title = plain(match[2]).slice(0, 180),
      excerpt = plain(snippet).slice(0, 550);
    if (title && excerpt) results.push({ title, url: url.href, excerpt });
  }
  return results;
}

// Search happens in the backend for both native and browser use. Only the query
// is sent; we never follow arbitrary search-result URLs or execute page content.
export class WebSearchService {
  constructor({ fetcher = fetchModel } = {}) {
    this.fetcher = fetcher;
    this.operations = new Map();
    this.cache = new Map();
  }
  cancel(id) {
    this.operations.get(id)?.abort();
  }
  async search(args) {
    const query =
      typeof args.query === "string"
        ? args.query.replace(/\s+/g, " ").trim().slice(0, 400)
        : "";
    if (!query) throw new Error("Enter a question or select text to search.");
    const saved = this.cache.get(query);
    if (saved && Date.now() - saved.at < 600000) return saved.result;
    const controller = new AbortController();
    this.operations.set(args.requestId, controller);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(20000),
    ]);
    const options = {
      signal,
      headers: { "User-Agent": "MINotes/0.1 (personal reading assistant)" },
    };
    try {
      let sources = [],
        provider = "DuckDuckGo";
      try {
        const response = await this.fetcher(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
          {
            ...options,
            signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
          },
        );
        if (response.ok)
          sources = parseSearchHTML((await response.text()).slice(0, 1000000));
        else await response.body?.cancel();
      } catch {
        signal.throwIfAborted();
      }
      if (!sources.length) {
        // A challenge/rate limit is not bypassed. Use a separate public API,
        // and clearly label its narrower scope in the returned result.
        provider = "Wikipedia";
        const response = await this.fetcher(
          `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=4`,
          options,
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Search unavailable");
        }
        const data = await response.json();
        sources = (Array.isArray(data.pages) ? data.pages : [])
          .filter(
            (p) => typeof p.title === "string" && typeof p.key === "string",
          )
          .map((p) => ({
            title: p.title.slice(0, 180),
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
            excerpt: plain(p.excerpt).slice(0, 550),
          }))
          .filter((p) => p.excerpt);
      }
      signal.throwIfAborted();
      if (!sources.length)
        throw new Error(
          "No useful web results found. Try a more specific question.",
        );
      const result = {
        query,
        provider,
        sources,
        ...(provider === "Wikipedia"
          ? {
              notice:
                "General search was unavailable; using Wikipedia results.",
            }
          : {}),
      };
      this.cache.delete(query);
      this.cache.set(query, { at: Date.now(), result });
      while (this.cache.size > 60)
        this.cache.delete(this.cache.keys().next().value);
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new Error("Web search cancelled.");
      if (error.message?.startsWith("No useful")) throw error;
      throw new Error(
        "Web search is unavailable. Check your connection, retry, or turn off Web search.",
      );
    } finally {
      this.operations.delete(args.requestId);
    }
  }
}
