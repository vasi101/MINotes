import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
export type RuntimeEvent = {
  phase: string;
  completed?: number;
  total?: number;
  backend?: string;
  text?: string;
  error?: string;
  modelId?: string;
  testMilliseconds?: number;
};
export async function kittyRequest<T>(
  method: string,
  args: Record<string, unknown> = {},
  onEvent: (event: RuntimeEvent) => void = () => {},
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  const payload = { ...args, requestId };
  const cancel = () => {
    void kittyRequest("cancel", { targetId: requestId }).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    if (isTauri()) {
      const channel = new Channel<RuntimeEvent>();
      channel.onmessage = (event) => {
        if (!signal?.aborted) onEvent(event);
      };
      const result = await invoke<T>("kitty_request", {
        method,
        args: payload,
        onEvent: channel,
      });
      signal?.throwIfAborted();
      return result;
    }
    const response = await fetch(`/api/kitty/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok || !response.body)
      throw new Error(
        "Kitty is unavailable. Open Mi Notes on this computer and try again.",
      );
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      result: T | undefined,
      complete = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const message = JSON.parse(line);
      if (message.error) throw new Error(message.error);
      if (message.event) onEvent(message.event);
      if ("result" in message) {
        result = message.result;
        complete = true;
      }
    };
    try {
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(consume);
        if (chunk.done) {
          consume(buffer);
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    signal?.throwIfAborted();
    if (!complete) throw new Error("Kitty was interrupted. Try again.");
    return result as T;
  } catch (error) {
    // Tauri rejects invoke() with the command's error string, not an Error.
    // Keep the backend's user-facing diagnosis instead of replacing it with
    // the generic "Kitty could not answer" fallback in the action controller.
    if (typeof error === "string") {
      if (
        /unknown kitty action|invalid kitty request|command .*not found/i.test(
          error,
        )
      )
        throw new Error("Restart Mi Notes to load the updated Kitty service.");
      throw new Error(error);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
