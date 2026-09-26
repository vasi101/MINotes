import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createGoogleAuth } from '../server/google-auth.mjs';

test('Google sessions survive restart, renew on the server, and enforce OAuth and account boundaries', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'minotes-auth-test-'));
  let handler, nonce, refreshes = 0, denyScope = false, revoked = false;
  const server = createServer((req, res) => void handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const env = { APP_ORIGIN: origin, GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', SESSION_ENCRYPTION_KEY: randomBytes(32).toString('base64'), AUTH_DATA_DIR: directory };
  const dependencies = {
    client: () => ({
      generateAuthUrl(options) { nonce = options.nonce; assert.equal(options.access_type, 'offline'); assert.equal(options.code_challenge_method, 'S256'); return 'https://accounts.google.com/auth?state=' + options.state; },
      async getToken(options) { assert.ok(options.codeVerifier); return { tokens: { access_token: 'private-access', refresh_token: 'private-refresh', id_token: 'verified-id', expiry_date: 1, scope: denyScope ? 'email' : 'https://www.googleapis.com/auth/drive.readonly' } }; },
      async verifyIdToken() { return { getPayload: () => ({ sub: 'google-user', email: 'reader@example.com', email_verified: true, nonce }) }; },
      setCredentials(tokens) { assert.equal(tokens.refresh_token, 'private-refresh'); },
      async refreshAccessToken() { refreshes++; if (revoked) throw { response: { data: { error: 'invalid_grant' } } }; return { credentials: { access_token: 'renewed-access', expiry_date: Date.now() + 3600000 } }; },
    }),
    async fetch(url, options) {
      if (String(url).includes('/about')) return Response.json({ user: { permissionId: 'drive-account', emailAddress: 'reader@example.com' } });
      assert.equal(options.headers.Authorization, 'Bearer renewed-access');
      assert.match(String(url), /^https:\/\/www.googleapis.com\/drive\/v3\/(files|changes)/);
      if (String(url).includes('/changes')) return Response.json({ changes: [], newStartPageToken: 'next' });
      return Response.json({ files: [] });
    },
  };
  handler = createGoogleAuth(env, dependencies);
  const request = (path, options = {}) => fetch(origin + path, { redirect: 'manual', ...options });
  const start = async () => {
    const response = await request('/api/auth/google/start');
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    return { cookie, state: new URL(response.headers.get('location')).searchParams.get('state') };
  };
  assert.equal((await request('/api/drive/files')).status, 401);
  const pending = await start();
  assert.equal((await request(`/api/auth/google/callback?state=${pending.state}&code=code`)).status, 400);
  const complete = await request(`/api/auth/google/callback?state=${pending.state}&code=code`, { headers: { Cookie: pending.cookie } });
  assert.equal(complete.status, 200);
  const sessionCookie = complete.headers.getSetCookie().find(value => value.startsWith('minotes-session='));
  assert.match(sessionCookie, /HttpOnly/); assert.match(sessionCookie, /SameSite=Lax/);
  const headers = { Cookie: sessionCookie.split(';')[0] };
  assert.equal((await request(`/api/auth/google/callback?state=${pending.state}&code=code`, { headers: { Cookie: pending.cookie } })).status, 400);
  handler = createGoogleAuth(env, dependencies); // Simulate a server restart.
  const statuses = await Promise.all([request('/api/auth/status', { headers }), request('/api/auth/status', { headers })]);
  for (const response of statuses) {
    const text = await response.text(); assert.equal(JSON.parse(text).connected, true); assert.ok(!text.includes('private-')); assert.ok(!text.includes('renewed-access'));
  }
  assert.equal(refreshes, 1);
  assert.equal((await request('/api/drive/files', { headers: { ...headers, 'X-Drive-Account': 'wrong-account' } })).status, 409);
  assert.equal((await request('/api/drive/files', { headers: { ...headers, 'X-Drive-Account': 'drive-account' } })).status, 200);
  for (const path of ['/api/drive/changes?pageToken=previous&includeRemoved=true', '/api/drive/changes/startPageToken']) {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { headers: { ...headers, 'X-Drive-Account': 'wrong' } })).status, 409);
    assert.equal((await request(path, { headers: { ...headers, 'X-Drive-Account': 'drive-account' } })).status, 200);
  }
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  for (const name of await readdir(directory)) { const bytes = await readFile(join(directory, name)); assert.ok(!bytes.includes(Buffer.from('private-refresh'))); }
  assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { ...headers, Origin: origin } })).status, 200);
  assert.equal((await (await request('/api/auth/status', { headers })).json()).connected, false);
  denyScope = true;
  const denied = await start();
  assert.equal((await request(`/api/auth/google/callback?state=${denied.state}&code=code`, { headers: { Cookie: denied.cookie } })).status, 400);
  denyScope = false;
  const again = await start();
  const callback = await request(`/api/auth/google/callback?state=${again.state}&code=code`, { headers: { Cookie: again.cookie } });
  const revokedCookie = callback.headers.getSetCookie().find(value => value.startsWith('minotes-session=')).split(';')[0];
  revoked = true;
  assert.equal((await (await request('/api/auth/status', { headers: { Cookie: revokedCookie } })).json()).connected, false);
});
