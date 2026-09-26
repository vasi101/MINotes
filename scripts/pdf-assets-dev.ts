import { createReadStream, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

// PDF.js dynamically imports these standalone decoders (including ?import URLs).
// Vite's public middleware skips import requests, but its transform middleware
// rejects modules from public. Serve only these known vendor files before both.
export function pdfDecoderAssets(): Plugin {
  return {
    name: 'pdfjs-decoder-assets',
    configureServer(server) {
      const directory = join(server.config.publicDir, 'pdfjs', 'wasm');
      const files = new Map(readdirSync(directory)
        .filter(name => name.endsWith('.js'))
        .map(name => [`/pdfjs/wasm/${name}`, join(directory, name)]));
      server.middlewares.use((request, response, next) => {
        const file = files.get((request.url || '').split('?')[0]);
        if (!file || !['GET', 'HEAD'].includes(request.method || '')) return next();
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        if (request.method === 'HEAD') { response.end(); return; }
        createReadStream(file).on('error', next).pipe(response);
      });
    },
  };
}
