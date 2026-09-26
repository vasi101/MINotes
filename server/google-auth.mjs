import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const DRIVE = 'https://www.googleapis.com/auth/drive.readonly';
const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const SESSION_SECONDS = 30 * 86400;

// A single-server encrypted store. The browser receives only an opaque session ID.
export function createGoogleAuth(env = process.env, dependencies = {}) {
  const origin = new URL(env.APP_ORIGIN || 'http://127.0.0.1:1420').origin;
  const secure = origin.startsWith('https:');
  if (!secure && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('APP_ORIGIN must use HTTPS outside localhost.');
  const configured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_ENCRYPTION_KEY);
  const key = Buffer.from(env.SESSION_ENCRYPTION_KEY || '', 'base64');
  if (configured && key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must be 32 random bytes encoded as base64.');
  const directory = resolve(env.AUTH_DATA_DIR || '.minotes-auth');
  const cookieName = secure ? '__Host-minotes-session' : 'minotes-session';
  const transactionCookie = secure ? '__Host-minotes-oauth' : 'minotes-oauth';
  const fetchGoogle = dependencies.fetch || fetch;
  const client = () => dependencies.client?.() || new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, `${origin}/api/auth/google/callback`);
  const locks = new Map();
  const path = id => join(directory, hash(id) + '.json');
  async function save(id, value) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    const temporary = path(id) + '.' + random() + '.tmp';
    await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    await rename(temporary, path(id));
  }
  async function remove(id) { if (id) await unlink(path(id)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  async function read(id, consume = false) {
    if (!id || !/^[\w-]{43}$/.test(id)) return undefined;
    let bytes;
    let source = path(id);
    try {
      if (consume) {
        source += '.' + random() + '.consumed';
        // Atomic rename makes OAuth state single-use even for concurrent callbacks.
        await rename(path(id), source);
      }
      bytes = await readFile(source);
    } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    finally { if (consume) await unlink(source).catch(() => {}); }
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (value.expiresAt <= Date.now()) { await remove(id); return undefined; }
    return value;
  }
  function cookie(name, value, seconds) { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`; }
  function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
  function finish(res, error) {
    const nonce = random();
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'`);
    res.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    const message = JSON.stringify({ type: 'minotes-google-auth', error }).replaceAll('<', '\\u003c');
    res.end(`<!doctype html><title>Mi Notes sign-in</title><p>${error ? 'Sign-in could not finish. Return to Mi Notes and try again.' : 'Connected. You can return to Mi Notes.'}</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${message},${JSON.stringify(origin)});window.close();}</script>`);
  }
  async function authorized(id) {
    if (locks.has(id)) return locks.get(id);
    const work = (async () => {
      const record = await read(id);
      if (!record || record.kind !== 'session') return undefined;
      if (record.tokens.expiry_date > Date.now() + 60000) return record;
      const oauth = client(); oauth.setCredentials(record.tokens);
      try {
        const { credentials } = await oauth.refreshAccessToken();
        record.tokens = { ...record.tokens, ...credentials };
        await save(id, record);
        return record;
      } catch (error) {
        if (error.response?.data?.error === 'invalid_grant') { await remove(id); return undefined; }
        throw error;
      }
    })();
    locks.set(id, work);
    try { return await work; } finally { locks.delete(id); }
  }
  return async function googleAuth(req, res, next = () => { res.writeHead(404); res.end(); }) {
    const url = new URL(req.url || '/', origin);
    if (!url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/drive/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
    const id = cookies[cookieName];
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Use the configured app address.' });
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Origin rejected.' });
      if (req.headers['sec-fetch-site'] === 'cross-site' && url.pathname !== '/api/auth/google/callback') return json(res, 403, { error: 'Cross-site request rejected.' });
      if (url.pathname === '/api/auth/status' && req.method === 'GET') {
        const record = configured ? await authorized(id) : undefined;
        return json(res, 200, { configured, persistent: true, connected: !!record, email: record?.email, accountId: record?.accountId, userId: record?.userId });
      }
      if (!configured) return json(res, 503, { error: 'Google sign-in is not configured on the server.' });
      if (url.pathname === '/api/auth/google/start' && req.method === 'GET') {
        await remove(cookies[transactionCookie]);
        const state = random(), verifier = random(), nonce = random();
        await save(state, { kind: 'oauth', verifier, nonce, expiresAt: Date.now() + 600000 });
        res.setHeader('Set-Cookie', cookie(transactionCookie, state, 600));
        const location = client().generateAuthUrl({ access_type: 'offline', scope: ['openid', 'email', DRIVE], prompt: 'consent', state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
        res.writeHead(302, { Location: location }); res.end(); return;
      }
      if (url.pathname === '/api/auth/google/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state');
        if (!state || state !== cookies[transactionCookie]) return finish(res, 'Sign-in verification failed. Try again.');
        const transaction = await read(state, true);
        res.setHeader('Set-Cookie', cookie(transactionCookie, '', 0));
        if (transaction?.kind !== 'oauth') return finish(res, 'Sign-in expired. Try again.');
        if (url.searchParams.has('error') || !url.searchParams.get('code')) return finish(res, 'Google sign-in was cancelled or denied.');
        const oauth = client();
        const { tokens } = await oauth.getToken({ code: url.searchParams.get('code'), codeVerifier: transaction.verifier });
        if (!tokens.scope?.split(' ').includes(DRIVE) || !tokens.refresh_token || !tokens.id_token) return finish(res, 'Allow read-only Google Drive access to stay connected.');
        const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
        const identity = ticket.getPayload();
        if (!identity?.sub || identity.nonce !== transaction.nonce || !identity.email_verified) return finish(res, 'Google account verification failed.');
        const about = await fetchGoogle('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,permissionId)', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(30000) });
        if (!about.ok) return finish(res, 'Google Drive access failed. Check that the Drive API is enabled and consent was granted.');
        const { user } = await about.json();
        if (!user?.permissionId) return finish(res, 'Unable to identify your Drive account.');
        const sessionId = random();
        await save(sessionId, { kind: 'session', userId: identity.sub, email: identity.email, accountId: user.permissionId, tokens, expiresAt: Date.now() + SESSION_SECONDS * 1000 });
        await remove(id);
        res.setHeader('Set-Cookie', [cookie(transactionCookie, '', 0), cookie(cookieName, sessionId, SESSION_SECONDS)]);
        return finish(res);
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        if (req.headers.origin !== origin) return json(res, 403, { error: 'Origin required.' });
        // Wait for pending renewal so it cannot recreate the removed session.
        await locks.get(id)?.catch(() => {});
        await remove(id);
        res.setHeader('Set-Cookie', cookie(cookieName, '', 0));
        return json(res, 200, { ok: true });
      }
      const route = url.pathname.match(/^\/api\/drive\/(files(?:\/[\w-]+)?|changes(?:\/startPageToken)?)$/);
      if (route && req.method === 'GET') {
        const record = await authorized(id);
        if (!record) return json(res, 401, { error: 'Sign in again to refresh your Drive folders.' });
        if (req.headers['x-drive-account'] !== record.accountId) return json(res, 409, { error: 'Sign in with the Google account used to import this folder.' });
        const target = new URL(`https://www.googleapis.com/drive/v3/${route[1]}`);
        for (const [name, value] of url.searchParams) {
          if (['q', 'fields', 'pageSize', 'pageToken', 'supportsAllDrives', 'includeItemsFromAllDrives', 'includeRemoved', 'includeCorpusRemovals', 'spaces', 'alt'].includes(name)) target.searchParams.set(name, value);
        }
        const response = await fetchGoogle(target, { headers: { Authorization: `Bearer ${record.tokens.access_token}` }, signal: AbortSignal.timeout(120000), redirect: 'error' });
        if (response.status === 401) await remove(id);
        res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' });
        res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      return json(res, 404, { error: 'Unknown endpoint.' });
    } catch {
      if (url.pathname === '/api/auth/google/callback') return finish(res, 'Google sign-in could not finish. Check the server configuration and try again.');
      if (!res.headersSent) json(res, 503, { error: 'Cannot reach Google sign-in right now. Try again shortly.' });
      else res.end();
    }
  };
}
