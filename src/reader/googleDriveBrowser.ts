import type { DriveFile, DriveStatus, DriveChangesPage } from './googleDrive';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const CONFIG_KEY = 'minotes-google-web-client';
type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string };
type GoogleIdentity = { accounts: { oauth2: { initTokenClient: (config: {
  client_id: string; scope: string; callback: (response: TokenResponse) => void;
  error_callback: (error: { type?: string }) => void;
}) => { requestAccessToken: (options: { prompt: string }) => void } } } };
let session: { token: string; expiresAt: number; accountId: string; email: string } | undefined;
let generation = 0;
let library: Promise<void> | undefined;
const google = () => (window as unknown as { google?: GoogleIdentity }).google;
let persistent = false;

export async function browserDriveStatus(): Promise<DriveStatus> {
  try {
    const response = await fetch('/api/auth/status', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) });
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const status: DriveStatus = await response.json();
      if (status.persistent && status.configured) { persistent = true; return status; }
    }
  } catch {
    if (persistent) throw new Error('Cannot reach your sign-in server. Your downloaded PDFs are still available.');
  }
  if (persistent) throw new Error('Google sign-in is unavailable on the server. Try again shortly.');
  const valid = session && session.expiresAt > Date.now() + 30000;
  return { configured: !!localStorage.getItem(CONFIG_KEY), connected: !!valid, email: valid ? session!.email : undefined, accountId: valid ? session!.accountId : undefined };
}
export function configureBrowserDrive(configJson: string) {
  let value: { web?: { client_id?: string; javascript_origins?: string[] } };
  try { value = JSON.parse(configJson); } catch { throw new Error('Choose the OAuth JSON downloaded from Google Cloud.'); }
  const client = value?.web;
  if (!client?.client_id || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(client.client_id)) throw new Error('Browser sign-in needs an OAuth client of type Web application. Download its JSON from Google Cloud.');
  if (!client.javascript_origins?.includes(window.location.origin)) throw new Error(`Add ${window.location.origin} to Authorized JavaScript origins in Google Cloud, then download the updated JSON.`);
  // Only the public client ID is stored. Never persist a web client secret or access token.
  localStorage.setItem(CONFIG_KEY, client.client_id);
  session = undefined; generation++;
}
export function prepareBrowserDrive(): Promise<void> {
  if (persistent) return Promise.resolve();
  if (google()?.accounts?.oauth2) return Promise.resolve();
  if (library) return library;
  library = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const fail = () => { clearTimeout(timer); script.remove(); library = undefined; reject(new Error('Could not load Google sign-in. Check your connection or content blocker, then try again.')); };
    const timer = window.setTimeout(fail, 20000);
    script.onload = () => { if (!google()?.accounts?.oauth2) { fail(); return; } clearTimeout(timer); resolve(); };
    script.onerror = fail;
    document.head.append(script);
  });
  return library;
}
async function request(path: string, query: Record<string, string> = {}, accountId?: string, tokenOverride?: string): Promise<Response> {
  const current = session;
  if (!persistent && !tokenOverride && (!current || current.expiresAt <= Date.now() + 30000)) throw new Error('Reconnect Google Drive to refresh this folder. Your downloaded PDFs are still available.');
  if (!persistent && accountId && current?.accountId !== accountId) throw new Error('This folder belongs to a different Google account. Reconnect the account used to import it.');
  const url = persistent ? new URL(`/api/drive/${path}`, location.origin) : new URL(`https://www.googleapis.com/drive/v3/${path}`);
  url.search = new URLSearchParams(query).toString();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(url, { headers: persistent ? { 'X-Drive-Account': accountId || '' } : { Authorization: `Bearer ${tokenOverride || current!.token}` }, credentials: persistent ? 'same-origin' : 'omit', signal: controller.signal });
    if (response.ok) return response;
    if (response.status === 401) {
      if (session === current) session = undefined;
      throw new Error('Google Drive sign-in expired. Reconnect your account.');
    }
    if (response.status === 403) {
      const payload = await response.json().catch(() => null);
      const error = payload?.error;
      const reasons: string[] = [...(Array.isArray(error?.errors) ? error.errors : []), ...(Array.isArray(error?.details) ? error.details : [])]
        .map(item => item?.reason).filter((reason): reason is string => typeof reason === 'string');
      const has = (...values: string[]) => values.some(value => reasons.includes(value));
      let guidance = 'Google Drive denied this request.';
      if (has('SERVICE_DISABLED', 'accessNotConfigured')) guidance = 'Enable Google Drive API in the Google Cloud project containing your OAuth client: APIs & Services > Library > Google Drive API > Enable. Wait a few minutes, then connect again.';
      else if (has('ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions')) guidance = 'Reconnect Google Drive and allow read-only Drive access on the Google consent screen.';
      else if (has('rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED', 'dailyLimitExceeded')) guidance = 'Google Drive quota was reached. Try again later or check the project API quotas in Google Cloud.';
      else if (has('domainPolicy', 'ORG_RESTRICTION_VIOLATION')) guidance = 'Your Google Workspace organization blocks this app. Ask its administrator to allow Drive access.';
      else if (has('insufficientFilePermissions', 'appNotAuthorizedToFile')) guidance = 'This account or app cannot access the file. Check its sharing permissions and reconnect with an account that has access.';
      const message = typeof error?.message === 'string' ? error.message.slice(0, 1200) : '';
      throw new Error([guidance, message ? `Google: ${message}` : '', reasons.length ? `Reason: ${[...new Set(reasons)].join(', ')}` : ''].filter(Boolean).join(' '));
    }
    if (response.status === 410) throw new Error('DRIVE_CURSOR_INVALID');
    if (response.status === 404) throw new Error('This Google Drive folder or file is no longer available.');
    if (response.status === 409) throw new Error('Sign in with the Google account used to import this folder.');
    if (response.status === 429) throw new Error('Google Drive is busy. Try refreshing again shortly.');
    throw new Error(`Google Drive request failed (${response.status}). Try again.`);
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) throw new Error('Cannot reach Google Drive. Your downloaded PDFs are still available offline.');
    throw error;
  } finally { clearTimeout(timer); }
}
export function connectBrowserDrive(): Promise<DriveStatus> {
  if (persistent) return connectPersistentDrive();
  const clientId = localStorage.getItem(CONFIG_KEY);
  if (!clientId) return Promise.reject(new Error('Load your Google Web application OAuth JSON first.'));
  const sdk = google();
  if (!sdk?.accounts?.oauth2) return prepareBrowserDrive().then(() => { throw new Error('Google sign-in is ready. Click Connect Google Drive again.'); });
  const attempt = ++generation;
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = window.setTimeout(() => fail('Google sign-in timed out. Try connecting again.'), 180000);
    const fail = (message: string) => { if (finished) return; finished = true; clearTimeout(timer); reject(new Error(message)); };
    try {
      const client = sdk.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: response => {
          if (finished) return;
          if (response.error || !response.access_token) { fail('Google sign-in was cancelled or denied. Try connecting again.'); return; }
          if (!response.scope?.split(' ').includes(SCOPE)) { fail('Allow read-only Google Drive access to import folders.'); return; }
          void (async () => {
            const account = await (await request('about', { fields: 'user(emailAddress,permissionId)' }, undefined, response.access_token)).json();
            if (!account.user?.permissionId) throw new Error('Unable to identify your Google Drive account.');
            if (attempt !== generation || finished) { fail('Google Drive connection changed. Try again.'); return; }
            session = { token: response.access_token!, expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000, accountId: account.user.permissionId, email: account.user.emailAddress || 'Google account' };
            finished = true; clearTimeout(timer); resolve(browserDriveStatus());
          })().catch(error => fail(error instanceof Error ? error.message : String(error)));
        },
        error_callback: error => fail(error.type === 'popup_closed' ? 'Google sign-in was closed. Click Connect Google Drive to try again.' : 'Google could not open sign-in. Allow pop-ups for this site and try again.'),
      });
      // Called directly from the user's click, so the browser may open Google's popup.
      client.requestAccessToken({ prompt: 'select_account' });
    } catch { fail('Could not start Google sign-in. Check your OAuth configuration and try again.'); }
  });
}
function connectPersistentDrive(): Promise<DriveStatus> {
  const popup = window.open('/api/auth/google/start', 'minotes-google-login', 'popup,width=520,height=700');
  if (!popup) return Promise.reject(new Error('Allow pop-ups for Mi Notes to sign in with Google.'));
  return new Promise((resolve, reject) => {
    let finished = false, checking = false;
    const finish = (status?: DriveStatus, error?: string) => {
      if (finished) return;
      finished = true; clearInterval(poll); clearTimeout(timer);
      window.removeEventListener('message', receive); popup.close();
      if (status) resolve(status); else reject(new Error(error || 'Sign-in did not finish. Try again.'));
    };
    const check = async () => {
      if (checking || finished) return;
      checking = true;
      try { const status = await browserDriveStatus(); if (status.connected) finish(status); }
      catch { /* A temporary server outage can recover before the sign-in timeout. */ }
      finally { checking = false; }
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== popup || event.data?.type !== 'minotes-google-auth') return;
      if (event.data.error) finish(undefined, event.data.error); else void check();
    };
    // Polling also works when Google's cross-origin policy severs window.opener.
    const poll = window.setInterval(() => void check(), 1000);
    const timer = window.setTimeout(() => finish(undefined, 'Google sign-in timed out or was closed. Try again.'), 180000);
    window.addEventListener('message', receive);
  });
}
export async function disconnectBrowserDrive() {
  if (persistent) {
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not sign out. Try again.');
  }
  session = undefined; generation++;
}
function validateId(id: string) { if (!/^[\w-]+$/.test(id)) throw new Error('Invalid Google Drive file ID.'); }
export async function browserDriveMetadata(fileId: string, accountId: string): Promise<DriveFile> {
  validateId(fileId);
  const file = await (await request(`files/${fileId}`, { fields: 'id,name,mimeType,modifiedTime,size,trashed', supportsAllDrives: 'true' }, accountId)).json();
  if (file.trashed) throw new Error('The connected folder is in Google Drive trash. Restore it or connect another folder.');
  return file;
}
export async function browserListDrive(folderId: string, accountId: string): Promise<DriveFile[]> {
  validateId(folderId);
  return browserQueryDrive(`'${folderId}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/pdf')`, accountId);
}
export async function browserSearchDrive(name: string, accountId: string): Promise<DriveFile[]> {
  const escaped = name.trim().replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  if (!escaped) throw new Error('Enter a folder name.');
  return browserQueryDrive(`trashed = false and mimeType = 'application/vnd.google-apps.folder' and name contains '${escaped}'`, accountId);
}
async function browserQueryDrive(query: string, accountId: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []; let pageToken = '';
  const seen = new Set<string>();
  do {
    if (seen.has(pageToken)) throw new Error('Google Drive returned an incomplete folder listing. Try again.');
    seen.add(pageToken);
    const value = await (await request('files', {
      q: query,
      pageSize: '1000', pageToken, fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,size)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    }, accountId)).json();
    if (value.incompleteSearch || !Array.isArray(value.files)) throw new Error('Google Drive returned an incomplete folder listing. Try again.');
    files.push(...value.files); pageToken = value.nextPageToken || '';
  } while (pageToken);
  return files;
}
export async function browserDownloadDrive(fileId: string, accountId: string): Promise<Uint8Array> {
  const file = await browserDriveMetadata(fileId, accountId);
  if (file.mimeType !== 'application/pdf') throw new Error('Only PDF files can be imported from Google Drive.');
  return new Uint8Array(await (await request(`files/${fileId}`, { alt: 'media', supportsAllDrives: 'true' }, accountId)).arrayBuffer());
}

export async function browserDriveStartToken(accountId: string): Promise<string> {
  const value = await (await request('changes/startPageToken', { supportsAllDrives: 'true' }, accountId)).json();
  if (!value.startPageToken) throw new Error('Google Drive did not return a change marker.');
  return value.startPageToken;
}
export async function browserDriveChanges(pageToken: string, accountId: string): Promise<DriveChangesPage> {
  return (await request('changes', {
    pageToken, pageSize: '1000', spaces: 'drive', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', includeRemoved: 'true', includeCorpusRemovals: 'true',
    fields: 'nextPageToken,newStartPageToken,changes(changeType,fileId,removed,file(id,name,mimeType,modifiedTime,size,parents,trashed))',
  }, accountId)).json();
}
