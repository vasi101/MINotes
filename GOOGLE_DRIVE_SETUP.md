# Google Drive setup for Mi Notes

## Desktop sign-in

For GitHub releases, set repository Actions secrets `GOOGLE_DESKTOP_CLIENT_ID` and `GOOGLE_DESKTOP_CLIENT_SECRET` to the same desktop client values. The release workflow passes them to the native build and stops if either is missing. Local `.env.local` files are not uploaded to GitHub.

The app developer configures a Google OAuth **Desktop app** client once. Set `GOOGLE_DESKTOP_CLIENT_ID` and `GOOGLE_DESKTOP_CLIENT_SECRET` in `.env.local`, using the desktop client's values. Enable the Drive API and add test users in Google Cloud while the app is in Testing. Restart `npm run tauri dev` (or build with `npm run tauri build`) after changing these values; they are included in the native build. Never use a Web application client secret here. Desktop OAuth clients are public clients, so these bundled values are not confidential credentials.

Users select **Continue with Google**, sign in through their system browser, and return to Mi Notes. They do not upload JSON. Existing locally configured desktop clients remain supported. A build without OAuth configuration shows sign-in as unavailable, rather than asking users to configure Google Cloud.

## Persistent browser sign-in (recommended)

The app owner configures Google once. Users then open **Read > Add > Google Drive**, click **Continue with Google**, approve read-only Drive access, and choose a folder. The same flow signs in returning users. No separate Mi Notes password or user-uploaded OAuth JSON is needed.

1. In Google Cloud, enable **Google Drive API**. Configure the Google Auth Platform audience as **External** and add your Google account as a test user while testing.
2. Create a **Web application** OAuth client. Under **Authorized redirect URIs**, add exactly `http://127.0.0.1:1420/api/auth/google/callback`. A JavaScript origin alone is not sufficient for this flow.
3. Copy `.env.example` to `.env.local`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from that client's JSON. These are server-only variables: never prefix them with `VITE_` or put the JSON in `public`.
4. Generate an encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and put it in `SESSION_ENCRYPTION_KEY`. Keep this key stable across restarts.
5. Run `npm run dev` and open **http://127.0.0.1:1420**. Restart Vite after changing `.env.local`.

The development server includes the auth backend; no second process is needed. When these variables are configured, the browser automatically uses persistent sign-in instead of the legacy temporary-token flow.

For a deployed browser app, run `npm run build` then `npm start` with Node.js 24 LTS. Set `APP_ORIGIN` to the exact public HTTPS origin and register its `/api/auth/google/callback` redirect URI with Google. `npm start` reads `.env.local`; a hosting platform that injects environment variables can run `node server/start.mjs` directly. A reverse proxy must preserve the public Host header, proxy both the app and `/api` to this server, and terminate HTTPS. Configure `PORT` and `HOST` as needed. Static hosting or `vite preview` alone does not provide persistent authentication.

Sessions last 30 days. Google access tokens renew server-side; reloads and server restarts do not require another sign-in. OAuth state, PKCE and a verified Google ID token protect sign-in. Credentials are encrypted with AES-256-GCM in `AUTH_DATA_DIR` (default `.minotes-auth`). The browser gets an HttpOnly, SameSite cookie, with Secure enabled for HTTPS. Both `.env.local` and the default credential directory are ignored by Git. Protect and persist this directory and the encryption key on the server. This file store supports one server instance; use a shared transactional store before running multiple instances. Expired records are removed when accessed; administrators should periodically remove abandoned expired data under their retention policy.

**Sign out** removes the server session and its saved credentials. Downloaded PDFs and annotations remain local to this browser profile; Google login does not upload, migrate, or isolate those local notes between users. Use separate browser profiles on shared devices. Public distribution with `drive.readonly` can require Google verification. External apps left in Testing can have refresh tokens expire after seven days, and revoked access also requires signing in again.

Validation: `npm run test:auth` checks the backend with mocked Google responses; `npx playwright test tests/reader-session.spec.ts` checks sign-in, folder import, reload, refresh and sign-out. Real Google consent still requires valid credentials and a registered redirect URI.

References: [Google server-side OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Legacy browser and Windows desktop setup

Mi Notes connects directly to Google Drive in both the **browser** and the **Windows desktop app**. Each uses a different OAuth client type.

## Legacy manual configuration (browser fallback)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. In **APIs & Services ? Library**, enable **Google Drive API**.
3. Open **Google Auth Platform**. Complete the app branding and audience setup. For a personal project, choose **External**, keep the app in **Testing**, and add your own Google email address under **Test users**.
4. In **Data Access**, add the read-only scope `https://www.googleapis.com/auth/drive.readonly`.
5. In **Clients**, create the appropriate OAuth client:
   - **Browser:** choose **Web application**. Add the exact origin shown in the Mi Notes setup panel to **Authorized JavaScript origins**, for example `http://127.0.0.1:1420`. If you also use `http://localhost:1420`, add it separately. Download the JSON after saving these origins. No redirect URI is needed for the Google popup token flow.
   - **Windows desktop:** choose **Desktop app** and download its JSON.
   - Do not create a service account.
6. In Mi Notes, open **Read ? Add ? Google Drive ? Load Google OAuth JSON**, then select the downloaded file.
7. Click **Connect Google Drive** and complete consent in your normal browser. Return to Mi Notes when the browser tells you to.
8. Browse to the folder you want, or paste its Google Drive folder link, and click **Import this Drive folder**.

Google requires the app to be configured before anyone can sign in. Unconfigured development builds do not include Google client credentials. Keep the downloaded JSON outside the repository.

## Refresh behavior

- **Refresh now** in the Google Drive panel checks all connected Drive folders. While Mi Notes is open, linked Drive folders are checked every 30 seconds across all screens, and again on focus or network reconnection. Imports continue in the background; the Profile button beside Settings shows progress and errors. Only new or changed PDFs are downloaded. The app must remain open; this is polling, not instant push notification.
- New and changed PDFs download into the existing library location. Empty subfolders are retained and new folders get varied colors.
- Drive file IDs preserve document identity, annotations, favourites, and reading progress across file renames and moves within a connected folder.
- PDFs removed from the connected Drive tree are removed from that linked library. Their local annotations are removed with them. Moving a file outside that tree counts as removal.
- A failed or incomplete folder listing does not remove local documents. Downloaded PDFs remain readable offline.
- Sync is one-way, **Google Drive ? Mi Notes**. Local annotations are not uploaded. Use the existing PDF export controls to save annotated copies.
- Local folder import remains available as a copy-only import. Previously imported local folders are not automatically linked by name to Drive folders.
- Google-native documents, shortcuts, and non-PDF files are skipped. For a shared folder not listed under My Drive, paste its folder link; your signed-in account must have access.
- **Disconnect** removes saved sign-in credentials from this device and keeps downloaded PDFs. It does not delete Drive files or revoke Google's app grant. You can remove the grant from your Google Account permissions if desired.

## Credentials and account access

Desktop sign-in uses the system browser, a loopback callback, PKCE, and OAuth state validation. Desktop access tokens stay in the Rust backend. Saved credentials are encrypted with Windows DPAPI for the current Windows user; they are not stored in browser localStorage or IndexedDB. Folder IDs and library metadata are stored locally.

The `drive.readonly` scope lets the app enumerate folders and download PDFs, without writing to Drive. It is a restricted Google scope: public distribution may require Google's verification process. An External app left in Testing can have refresh tokens expire after seven days; use **Reconnect account** when needed. Connections are tied to the account that imported them, so switching accounts does not delete the first account's library.

Official references: [Desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive access scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

Browser sign-in uses Google Identity Services and stores access tokens only in page memory. Only the public OAuth client ID is saved, never the web client secret. Reconnect after a page reload or token expiry; linked folders and downloaded PDFs remain saved. Automatic refresh never opens a sign-in popup. If Google reports an origin mismatch, update Authorized JavaScript origins and load the updated JSON using **Change configuration**. Allow popups for the app when connecting.

Official browser reference: [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

## Development requirements

Install Rust and Microsoft C++ Build Tools with **Desktop development with C++** and a Windows SDK to build or run Tauri. Then run `npm run tauri -- dev`.

`npm run dev` starts the browser app, including Google Drive sign-in using a Web application OAuth client. Desktop builds use the Desktop app client. Automated tests mock Google responses and desktop IPC; live sign-in requires your own Google OAuth configuration.

## Incremental Drive sync

Each linked folder now saves a Drive Changes API marker and its folder index locally. After the initial scan, opening Mi Notes or a 30-second check requests changes since that marker instead of listing the entire folder tree. Unrelated account changes and unchanged folders trigger no file listing or downloads. Modified/new PDFs are downloaded; moves and deletions update the local library. A newly added or moved-in folder is listed once to discover its existing contents.

Existing linked folders need one migration scan to build their index. Markers are captured before scanning and advanced only after all pages, downloads, and local writes succeed. Interrupted requests retry from the previous marker. Invalid markers or shared-drive membership changes trigger a recovery scan. Downloaded PDFs remain available if the linked root becomes inaccessible. These are periodic change-feed checks, not push notifications; the app must be open.

Reference: [Google Drive Changes API](https://developers.google.com/workspace/drive/api/guides/manage-changes).
