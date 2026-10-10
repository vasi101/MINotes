import { createHash } from "node:crypto";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fetchModel } from "./network.mjs";

const MAX_MODEL_BYTES = 16 * 1024 ** 3;

export async function downloadCustomModel(
  url,
  expectedSha256,
  root,
  signal,
  progress,
  fetcher = fetchModel,
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid direct GGUF download URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("Model downloads must use a public HTTPS URL.");
  if (expectedSha256 && !/^[a-f0-9]{64}$/i.test(expectedSha256))
    throw new Error("SHA-256 must contain exactly 64 hexadecimal characters.");

  const urlId = createHash("sha256").update(parsed.href).digest("hex").slice(0, 16);
  await mkdir(root, { recursive: true });
  const final = join(root, `custom-${urlId}.gguf`);
  const partial = `${final}.part`;
  let offset = await stat(partial).then((info) => info.size).catch(() => 0);
  if (offset > MAX_MODEL_BYTES) {
    await unlink(partial);
    offset = 0;
  }
  const response = await fetcher(parsed.href, {
    headers: offset ? { Range: `bytes=${offset}-` } : {},
    signal,
  });
  if (!response.ok || !response.body)
    throw new Error(`Model download unavailable (${response.status}).`);
  if (response.url && new URL(response.url).protocol !== "https:") {
    await response.body.cancel();
    throw new Error("Model downloads must stay on HTTPS.");
  }

  const contentLength = Number(response.headers.get("content-length"));
  const range = response.headers.get("content-range")?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
  if (response.status === 206) {
    if (!range || Number(range[1]) !== offset) {
      await response.body.cancel();
      throw new Error("The download server returned an unexpected range.");
    }
  } else if (response.status === 200) offset = 0;
  else {
    await response.body.cancel();
    throw new Error("Unexpected model download response.");
  }
  const total = response.status === 206
    ? range?.[3] === "*" ? 0 : Number(range?.[3])
    : contentLength + offset;
  if (Number.isFinite(total) && total > MAX_MODEL_BYTES) {
    await response.body.cancel();
    throw new Error("Model is larger than Kitty's 16 GB custom-model limit.");
  }

  const file = await open(partial, offset ? "a" : "w");
  try {
    let reported = 0;
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      offset += chunk.length;
      if (offset > MAX_MODEL_BYTES)
        throw new Error("Model is larger than Kitty's 16 GB custom-model limit.");
      await file.writeFile(chunk);
      if (Date.now() - reported > 150 || offset === total) {
        progress({ phase: "downloading", completed: offset, total: total || 0 });
        reported = Date.now();
      }
    }
    await file.sync();
  } finally {
    await file.close();
  }
  if (total && offset !== total)
    throw new Error("Download interrupted. Retry to resume.");

  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  for await (const chunk of createReadStream(partial)) {
    signal.throwIfAborted();
    hash.update(chunk);
  }
  const sha256 = hash.digest("hex");
  if (expectedSha256 && sha256 !== expectedSha256.toLowerCase()) {
    await unlink(partial).catch(() => {});
    throw new Error("SHA-256 does not match. Check the URL and checksum.");
  }
  progress({ phase: "verifying", completed: offset, total: offset });
  await unlink(final).catch(() => {});
  await rename(partial, final);
  return { path: final, sha256, sizeBytes: offset };
}
