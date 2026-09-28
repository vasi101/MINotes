import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchModel } from './network.mjs';

export async function hashFile(path, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) { signal?.throwIfAborted(); hash.update(chunk); }
  return hash.digest('hex');
}
export async function downloadModel(model, root, signal, progress, fetcher = fetchModel) {
  if (!/^[a-z0-9-]+\.gguf$/.test(model.filename) || !/^[a-f0-9]{64}$/.test(model.sha256)) throw new Error('Invalid model manifest.');
  await mkdir(root, { recursive: true });
  const final = join(root, model.filename), partial = final + '.part';
  if (await stat(final).then(s => s.size === model.sizeBytes).catch(() => false)) {
    progress({ phase: 'verifying', completed: model.sizeBytes, total: model.sizeBytes });
    if (await hashFile(final, signal) === model.sha256) return final;
    throw new Error('Installed model failed verification. Remove Local AI and install again.');
  }
  let offset = await stat(partial).then(s => s.size).catch(() => 0);
  if (offset > model.sizeBytes) { await unlink(partial); offset = 0; }
  if (offset < model.sizeBytes) {
    const response = await fetcher(model.url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal });
    if (!response.ok || !response.body) throw new Error(`Download unavailable (${response.status}). Retry to resume.`);
    if (response.status === 206) {
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      if (!range || Number(range[1]) !== offset || Number(range[3]) !== model.sizeBytes) { await response.body.cancel(); throw new Error('The download server returned an unexpected range.'); }
    } else if (response.status === 200) offset = 0;
    else { await response.body.cancel(); throw new Error('Unexpected download response.'); }
    const file = await open(partial, offset ? 'a' : 'w');
    try {
      let reported = 0;
      for await (const chunk of response.body) {
        signal.throwIfAborted();
        if (offset + chunk.length > model.sizeBytes) throw new Error('Download exceeded its expected size.');
        await file.writeFile(chunk); offset += chunk.length;
        if (Date.now() - reported > 150 || offset === model.sizeBytes) { progress({ phase: 'downloading', completed: offset, total: model.sizeBytes }); reported = Date.now(); }
      }
      await file.sync();
    } finally { await file.close(); }
  }
  if (offset !== model.sizeBytes) throw new Error('Download interrupted. Retry to resume.');
  progress({ phase: 'verifying', completed: offset, total: model.sizeBytes });
  if (await hashFile(partial, signal) !== model.sha256) { await unlink(partial); throw new Error('Model verification failed. Retry to download a clean copy.'); }
  signal.throwIfAborted(); await rename(partial, final); return final;
}
