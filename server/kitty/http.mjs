import { KittyAIService } from './service.mjs';
let service;
export function kittyMiddleware(req, res, next) {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (!path.startsWith('/api/kitty/')) return next();
  // Browser development only: never expose local model management cross-origin.
  const origin = req.headers.origin;
  if (req.method !== 'POST' || !String(req.headers['content-type']).startsWith('application/json') || origin && new URL(origin).host !== req.headers.host || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 40000) req.destroy(); });
  req.on('end', () => {
    void (async () => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      const write = value => { if (!res.destroyed) res.write(JSON.stringify(value) + '\n'); };
      try { service ??= new KittyAIService(); const args = JSON.parse(body); res.on('close', () => { if (!res.writableEnded) void service.request('cancel', { targetId: args.requestId }); }); const result = await service.request(path.slice('/api/kitty/'.length), args, event => write({ event })); write({ result }); }
      catch (error) { write({ error: error.message }); }
      finally { res.end(); }
    })();
  });
}
