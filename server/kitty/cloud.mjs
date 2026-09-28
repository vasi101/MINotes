import { fetchModel } from "./network.mjs";

const endpoint = "https://api.openai.com/v1";
const safeError = (status) =>
  status === 401
    ? "The OpenAI API key was not accepted. Reconnect Cloud AI."
    : status === 429
      ? "Cloud AI has reached its usage or rate limit. Check your API billing or retry later."
      : status === 400 || status === 404
        ? "This model or tool is unavailable. Choose another model, or turn off web search."
        : "Cloud AI is temporarily unavailable. Try again.";
const textModels = (id) =>
  /^(gpt-(?:4\.1|4o|[56])(?:[-.]|$)|o[34](?:-|$))/.test(id) &&
  !/audio|realtime|transcribe|tts|image|search|codex|chat-latest|pro/.test(id);

async function apiError(response) {
  // Read structured error codes, never echo upstream request data or key fragments.
  let error;
  try {
    error = (await response.json())?.error;
  } catch {
    /* Non-JSON proxy error. */
  }
  if (error?.code === "insufficient_quota")
    return "Your OpenAI API account has no available credit. Add API billing credit, then retry. A ChatGPT subscription does not include API credit.";
  if (error?.code === "model_not_found")
    return "This model is not available to your API key. Open Model settings and choose an available model.";
  if (error?.code === "unsupported_country_region_territory")
    return "OpenAI API access is unavailable in this region.";
  if (response.status === 403)
    return "This API key does not have permission for this model or endpoint. Check the key permissions in your OpenAI project.";
  if (error?.param === "tools" || error?.param === "tool_choice")
    return "This model does not support the requested web-search tool. Choose a different model or turn off Web search.";
  return safeError(response.status);
}

// Keys live only in this backend process, never in localStorage or note files.
export class CloudAIService {
  constructor({
    fetcher = fetchModel,
    apiKey = process.env.OPENAI_API_KEY || "",
  } = {}) {
    this.fetcher = fetcher;
    this.apiKey = apiKey;
    this.models = [];
    this.operations = new Map();
  }
  status() {
    return { configured: !!this.apiKey, models: this.models };
  }
  cancel(id) {
    this.operations.get(id)?.abort();
  }
  async request(method, args = {}, emit = () => {}) {
    if (method === "cloud-status") return this.status();
    if (method === "cloud-disconnect") {
      for (const operation of this.operations.values()) operation.abort();
      this.apiKey = "";
      this.models = [];
      return this.status();
    }
    const controller = new AbortController();
    this.operations.set(args.requestId, controller);
    const timer = setTimeout(
      () => controller.abort(),
      method === "cloud-generate" ? 120000 : 15000,
    );
    const signal = controller.signal;
    try {
      if (method === "cloud-connect") {
        const key =
          typeof args.apiKey === "string" ? args.apiKey.trim() : this.apiKey;
        if (!key || key.length > 512 || /\s/.test(key))
          throw new Error("Enter a valid OpenAI API key.");
        const response = await this.fetcher(`${endpoint}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal,
        });
        if (!response.ok) {
          throw new Error(await apiError(response));
        }
        const data = await response.json();
        signal.throwIfAborted();
        this.models = (data.data ?? [])
          .map((m) => m.id)
          .filter((id) => typeof id === "string" && textModels(id))
          .sort();
        if (!this.models.length)
          throw new Error(
            "This key has no supported text models. Check your project model access.",
          );
        this.apiKey = key;
        return this.status();
      }
      if (method !== "cloud-generate")
        throw new Error("Unknown Cloud AI action.");
      if (!this.apiKey)
        throw new Error(
          "Connect Cloud AI with your OpenAI API key, or choose Local.",
        );
      if (
        typeof args.model !== "string" ||
        !/^[a-zA-Z0-9._:-]{1,100}$/.test(args.model)
      )
        throw new Error("Choose a cloud model.");
      if (
        typeof args.prompt !== "string" ||
        args.prompt.length > 22000 ||
        typeof args.system !== "string" ||
        args.system.length > 5000
      )
        throw new Error("Select a shorter passage.");
      const response = await this.fetcher(`${endpoint}/responses`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: args.model,
          instructions: args.system,
          input: args.prompt,
          stream: true,
          store: false,
          max_output_tokens: 8192,
          ...(/^(gpt-5(?:[-.]|$)|o[34](?:-|$))/.test(args.model)
            ? { reasoning: { effort: "low" } }
            : {}),
          ...(args.webSearch === true
            ? {
                tools: [{ type: "web_search", search_context_size: "low" }],
                tool_choice: "required",
              }
            : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(await apiError(response));
      }
      if (!response.body)
        throw new Error("Cloud AI returned no answer. Try again.");
      let text = "",
        buffer = "",
        completed = false,
        citations = [];
      const decoder = new TextDecoder();
      const consume = (frame) => {
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") return;
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          throw new Error(
            "Cloud AI returned an unreadable response. Try again.",
          );
        }
        if (event.type === "response.output_text.delta") {
          text += event.delta;
          emit({ phase: "generating", text });
        }
        if (event.type === "response.web_search_call.in_progress")
          emit({ phase: "searching" });
        if (["error", "response.failed"].includes(event.type)) {
          const code = event.code ?? event.response?.error?.code;
          throw new Error(
            code === "insufficient_quota"
              ? "Your OpenAI API account has no available credit. Add API billing credit, then retry."
              : code === "invalid_api_key"
                ? "The OpenAI API key was not accepted. Reconnect Cloud AI."
                : "Cloud AI could not finish. Try another model or check your API account.",
          );
        }
        if (event.type === "response.incomplete")
          throw new Error(
            "The answer was cut short. Try a shorter selection or another model.",
          );
        if (event.type === "response.completed") {
          let final = "";
          citations = [];
          for (const item of event.response?.output ?? [])
            for (const part of item.content ?? []) {
              if (part.type === "refusal")
                throw new Error(
                  part.refusal || "Kitty could not answer this request.",
                );
              if (part.type !== "output_text") continue;
              const offset = final.length;
              final += part.text ?? "";
              for (const a of part.annotations ?? [])
                if (
                  a.type === "url_citation" &&
                  /^https?:\/\//i.test(a.url) &&
                  Number.isInteger(a.start_index) &&
                  Number.isInteger(a.end_index)
                )
                  citations.push({
                    url: a.url,
                    title: a.title || a.url,
                    start: offset + a.start_index,
                    end: offset + a.end_index,
                  });
            }
          text = final || text;
          completed = true;
        }
      };
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          signal.throwIfAborted();
          buffer += decoder.decode(chunk.value, { stream: !chunk.done });
          buffer = buffer.replace(/\r\n/g, "\n");
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            consume(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
          }
          if (chunk.done) {
            if (buffer.trim()) consume(buffer);
            break;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (!completed || !text.trim())
        throw new Error("Cloud AI was interrupted. Try again.");
      return { text, citations, model: args.model };
    } catch (error) {
      if (signal.aborted)
        throw new Error("Cloud request stopped or timed out. Try again.");
      if (error instanceof TypeError)
        throw new Error(
          "Could not reach Cloud AI. Check your connection and retry.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
      this.operations.delete(args.requestId);
    }
  }
}
