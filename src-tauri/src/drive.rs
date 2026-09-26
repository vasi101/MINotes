use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const SCOPE: &str = "https://www.googleapis.com/auth/drive.readonly";
#[derive(Default)]
pub struct DriveState {
    token: Mutex<Option<Token>>,
    signing_in: AtomicBool,
    generation: AtomicU64,
}
#[derive(Clone, Serialize, Deserialize)]
struct ClientConfig {
    client_id: String,
    client_secret: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Token {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    account_id: String,
    email: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn location(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}
fn config(app: &tauri::AppHandle) -> Result<ClientConfig, String> {
    if let Some(client_id) = option_env!("GOOGLE_DESKTOP_CLIENT_ID").filter(|id| !id.trim().is_empty()) {
        return Ok(ClientConfig {
            client_id: client_id.to_string(),
            client_secret: option_env!("GOOGLE_DESKTOP_CLIENT_SECRET").unwrap_or_default().to_string(),
        });
    }
    serde_json::from_slice(
        &fs::read(location(app, "google-drive-client.json")?)
            .map_err(|_| "Google sign-in has not been configured for this app. Contact the app developer.")?,
    )
    .map_err(|_| "Invalid Google OAuth configuration. Load the Desktop app JSON again.".into())
}

// Windows DPAPI protects saved credentials for the current Windows user.
// Data travels through stdin, never command arguments or shell interpolation.
#[cfg(windows)]
fn powershell(script: &str, input: &str) -> Result<String, String> {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    let script = format!("[Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); {script}");
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script.as_str()])
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Unable to start the Windows credential helper.")?;
    child
        .stdin
        .take()
        .ok_or("Unable to open credential input.")?
        .write_all(input.as_bytes())
        .map_err(|_| "Unable to send credential data.")?;
    let output = child
        .wait_with_output()
        .map_err(|_| "Windows credential helper failed.")?;
    if !output.status.success() {
        return Err(
            "Windows could not protect or restore the Drive connection. Reconnect to Google Drive."
                .into(),
        );
    }
    String::from_utf8(output.stdout)
        .map_err(|_| "Invalid response from Windows credential helper.".into())
}
#[cfg(not(windows))]
fn powershell(_script: &str, _input: &str) -> Result<String, String> {
    Err("Google Drive sign-in is currently supported in the Windows desktop app.".into())
}
fn protect(input: &str, encrypt: bool) -> Result<String, String> {
    let script = if encrypt {
        r#"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($s); [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))"#
    } else {
        r#"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))"#
    };
    powershell(script, input)
}
fn read_token(app: &tauri::AppHandle) -> Result<Token, String> {
    let encrypted = fs::read_to_string(location(app, "google-drive-token.dpapi")?)
        .map_err(|_| "Connect to Google Drive first.")?;
    serde_json::from_str(&protect(&encrypted, false)?)
        .map_err(|_| "Reconnect to Google Drive to restore access.".into())
}
fn save_token(app: &tauri::AppHandle, token: &Token, generation: u64) -> Result<(), String> {
    let encrypted = protect(
        &serde_json::to_string(token).map_err(|e| e.to_string())?,
        true,
    )?;
    let state = app.state::<DriveState>();
    let mut cached = state
        .token
        .lock()
        .map_err(|_| "Drive connection is busy.")?;
    if state.generation.load(Ordering::SeqCst) != generation {
        return Err("Google Drive connection changed. Try again.".into());
    }
    let target = location(app, "google-drive-token.dpapi")?;
    fs::write(&target, encrypted).map_err(|_| "Could not save the Google Drive connection.")?;
    *cached = Some(token.clone());
    Ok(())
}
fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "Unable to initialize the Google Drive connection.".into())
}
async fn checked(response: reqwest::Response) -> Result<reqwest::Response, String> {
    match response.status().as_u16() {
        200..=299 => Ok(response),
        401 => Err("Google Drive access expired. Reconnect your account.".into()),
        403 => {
            let payload = response.json::<Value>().await.unwrap_or(Value::Null);
            let error = &payload["error"];
            let reasons: Vec<&str> = ["errors", "details"].iter()
                .filter_map(|key| error[*key].as_array()).flatten()
                .filter_map(|item| item["reason"].as_str()).collect();
            let has = |values: &[&str]| values.iter().any(|value| reasons.contains(value));
            let guidance = if has(&["SERVICE_DISABLED", "accessNotConfigured"]) {
                "Enable Google Drive API in the Google Cloud project containing your OAuth client: APIs & Services > Library > Google Drive API > Enable. Wait a few minutes, then connect again."
            } else if has(&["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions"]) {
                "Reconnect Google Drive and allow read-only Drive access on the Google consent screen."
            } else if has(&["rateLimitExceeded", "userRateLimitExceeded", "RATE_LIMIT_EXCEEDED", "dailyLimitExceeded"]) {
                "Google Drive quota was reached. Try again later or check the project API quotas in Google Cloud."
            } else if has(&["domainPolicy", "ORG_RESTRICTION_VIOLATION"]) {
                "Your Google Workspace organization blocks this app. Ask its administrator to allow Drive access."
            } else if has(&["insufficientFilePermissions", "appNotAuthorizedToFile"]) {
                "This account or app cannot access the file. Check its sharing permissions and reconnect with an account that has access."
            } else { "Google Drive denied this request." };
            let message: String = error["message"].as_str().unwrap_or_default().chars().take(1200).collect();
            let mut result = guidance.to_string();
            if !message.is_empty() { result.push_str(&format!(" Google: {message}")); }
            if !reasons.is_empty() { result.push_str(&format!(" Reason: {}", reasons.join(", "))); }
            Err(result)
        },
        410 => Err("DRIVE_CURSOR_INVALID".into()),
        404 => Err("This Google Drive folder or file is no longer available.".into()),
        429 => Err("Google Drive is busy. Try refreshing again shortly.".into()),
        _ => Err(format!("Google Drive request failed ({}). Try again.", response.status().as_u16())),
    }
}
async fn access(app: &tauri::AppHandle) -> Result<Token, String> {
    let generation = app.state::<DriveState>().generation.load(Ordering::SeqCst);
    let cached = app
        .state::<DriveState>()
        .token
        .lock()
        .map_err(|_| "Drive connection is busy.")?
        .clone();
    let mut token = match cached {
        Some(token) => token,
        None => {
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || read_token(&app))
                .await
                .map_err(|e| e.to_string())??
        }
    };
    if token.expires_at <= now() + 60 {
        let client = config(app)?;
        let response = http()?
            .post("https://oauth2.googleapis.com/token")
            .form(&[
                ("client_id", client.client_id.as_str()),
                ("client_secret", client.client_secret.as_str()),
                ("refresh_token", token.refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|_| "Cannot reach Google Drive. Check your internet connection.")?;
        if !response.status().is_success() {
            return Err(
                "Google Drive sign-in expired or was revoked. Reconnect your account.".into(),
            );
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid Google token response.")?;
        token.access_token = value["access_token"]
            .as_str()
            .ok_or("Google did not return an access token.")?
            .into();
        token.expires_at = now() + value["expires_in"].as_u64().unwrap_or(3600);
        let app = app.clone();
        let saved = token.clone();
        tauri::async_runtime::spawn_blocking(move || save_token(&app, &saved, generation))
            .await
            .map_err(|e| e.to_string())??;
    }
    {
        let state = app.state::<DriveState>();
        let mut cached = state
            .token
            .lock()
            .map_err(|_| "Drive connection is busy.")?;
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err("Google Drive connection changed. Try again.".into());
        }
        *cached = Some(token.clone());
    }
    Ok(token)
}
fn id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        Err("Invalid Google Drive file ID.".into())
    } else {
        Ok(())
    }
}
async fn get(
    app: &tauri::AppHandle,
    url: &str,
    query: &[(&str, &str)],
    account_id: Option<&str>,
) -> Result<reqwest::Response, String> {
    let token = access(app).await?;
    if account_id.is_some_and(|expected| expected != token.account_id) {
        return Err("This folder belongs to a different Google account. Reconnect the account used to import it.".into());
    }
    checked(
        http()?
            .get(url)
            .query(query)
            .bearer_auth(token.access_token)
            .send()
            .await
            .map_err(|_| {
                "Cannot reach Google Drive. Your downloaded PDFs are still available offline."
            })?,
    )
    .await
}

#[tauri::command]
pub async fn drive_status(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let configured = config(&app).is_ok();
        let token = read_token(&app).ok();
        Ok(json!({ "configured": configured, "persistent": true, "connected": token.is_some(), "email": token.as_ref().map(|t| &t.email), "accountId": token.as_ref().map(|t| &t.account_id) }))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn drive_configure(app: tauri::AppHandle, config_json: String) -> Result<(), String> {
    let value: Value = serde_json::from_str(&config_json)
        .map_err(|_| "Choose the OAuth JSON downloaded from Google Cloud.")?;
    let installed = &value["installed"];
    let client_id = installed["client_id"]
        .as_str()
        .filter(|s| s.ends_with(".apps.googleusercontent.com"))
        .ok_or("Create an OAuth client of type Desktop app, then download its JSON.")?;
    let client = ClientConfig {
        client_id: client_id.into(),
        client_secret: installed["client_secret"]
            .as_str()
            .unwrap_or_default()
            .into(),
    };
    if location(&app, "google-drive-token.dpapi")?.exists() {
        return Err("Disconnect Google Drive before replacing its configuration.".into());
    }
    fs::write(
        location(&app, "google-drive-client.json")?,
        serde_json::to_vec(&client).map_err(|e| e.to_string())?,
    )
    .map_err(|_| "Could not save the Google OAuth configuration.".into())
}

struct SignInGuard(tauri::AppHandle);
impl Drop for SignInGuard {
    fn drop(&mut self) {
        self.0
            .state::<DriveState>()
            .signing_in
            .store(false, Ordering::SeqCst);
    }
}
fn random() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "Cannot generate secure sign-in state.")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn wait_for_code(listener: TcpListener, expected: String) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(180) {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .map_err(|e| e.to_string())?;
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while request.len() < 8192 && !request.windows(4).any(|part| part == b"\r\n\r\n") {
                    match stream.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => request.extend_from_slice(&buffer[..count]),
                    }
                }
                let text = String::from_utf8_lossy(&request);
                let target = text
                    .lines()
                    .next()
                    .and_then(|line| line.strip_prefix("GET "))
                    .and_then(|line| line.split_whitespace().next())
                    .unwrap_or("");
                let parsed = url::Url::parse(&format!("http://127.0.0.1{target}"));
                let Ok(parsed) = parsed else { continue };
                let params: std::collections::HashMap<_, _> =
                    parsed.query_pairs().into_owned().collect();
                if parsed.path() != "/" || params.get("state") != Some(&expected) {
                    let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                let body = "You can close this tab and return to Mi Notes.";
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
                if params.contains_key("error") {
                    return Err("Google Drive sign-in was cancelled or denied.".into());
                }
                return params
                    .get("code")
                    .cloned()
                    .ok_or("Google did not return an authorization code.".into());
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100))
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Google sign-in timed out. Click Connect Google Drive to try again.".into())
}
#[tauri::command]
pub async fn drive_connect(app: tauri::AppHandle) -> Result<Value, String> {
    if app
        .state::<DriveState>()
        .signing_in
        .swap(true, Ordering::SeqCst)
    {
        return Err("Google sign-in is already open in your browser.".into());
    }
    let _guard = SignInGuard(app.clone());
    let generation = app
        .state::<DriveState>()
        .generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let client = config(&app)?;
    let verifier = random()?;
    let state = random()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|_| "Cannot open the local Google sign-in callback.")?;
    let redirect = format!(
        "http://127.0.0.1:{}/",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let mut authorization = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|e| e.to_string())?;
    authorization.query_pairs_mut().extend_pairs([
        ("client_id", client.client_id.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("response_type", "code"),
        ("scope", SCOPE),
        ("code_challenge", challenge.as_str()),
        ("code_challenge_method", "S256"),
        ("state", state.as_str()),
        ("access_type", "offline"),
        ("prompt", "consent select_account"),
    ]);
    tauri::async_runtime::spawn_blocking(move || powershell("$ErrorActionPreference='Stop'; $u=[Console]::In.ReadToEnd(); Start-Process -FilePath $u", authorization.as_str())).await.map_err(|e| e.to_string())??;
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, state))
        .await
        .map_err(|e| e.to_string())??;
    let response = http()?
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|_| "Cannot complete Google sign-in. Check your internet connection.")?;
    if !response.status().is_success() {
        return Err("Google could not complete sign-in. Check the Desktop app OAuth configuration and try again.".into());
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Invalid Google sign-in response.")?;
    if value["scope"]
        .as_str()
        .is_some_and(|scope| !scope.split_whitespace().any(|s| s == SCOPE))
    {
        return Err("Allow read-only Google Drive access to import folders.".into());
    }
    let access_token = value["access_token"]
        .as_str()
        .ok_or("Google did not return an access token.")?
        .to_string();
    let response = checked(
        http()?
            .get("https://www.googleapis.com/drive/v3/about")
            .query(&[("fields", "user(emailAddress,permissionId)")])
            .bearer_auth(&access_token)
            .send()
            .await
            .map_err(|_| "Cannot read your Google Drive account.")?,
    )
    .await?;
    let account: Value = response
        .json()
        .await
        .map_err(|_| "Invalid Google Drive account response.")?;
    let token = Token {
        access_token,
        refresh_token: value["refresh_token"]
            .as_str()
            .ok_or("Google did not grant offline access. Try connecting again.")?
            .into(),
        expires_at: now() + value["expires_in"].as_u64().unwrap_or(3600),
        account_id: account["user"]["permissionId"]
            .as_str()
            .ok_or("Unable to identify the Google Drive account.")?
            .into(),
        email: account["user"]["emailAddress"]
            .as_str()
            .unwrap_or("Google account")
            .into(),
    };
    let result = json!({ "configured": true, "persistent": true, "connected": true, "email": token.email, "accountId": token.account_id });
    tauri::async_runtime::spawn_blocking(move || save_token(&app, &token, generation))
        .await
        .map_err(|e| e.to_string())??;
    Ok(result)
}
#[tauri::command]
pub async fn drive_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<DriveState>();
    let mut cached = state
        .token
        .lock()
        .map_err(|_| "Drive connection is busy.")?;
    state.generation.fetch_add(1, Ordering::SeqCst);
    let target = location(&app, "google-drive-token.dpapi")?;
    match fs::remove_file(target) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err("Could not remove the saved Drive connection.".into()),
    }
    *cached = None;
    Ok(())
}
#[tauri::command]
pub async fn drive_list(
    app: tauri::AppHandle,
    folder_id: String,
    account_id: String,
) -> Result<Value, String> {
    id(&folder_id)?;
    let query = format!("'{}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/pdf')", folder_id);
    query_files(&app, &query, &account_id).await
}
#[tauri::command]
pub async fn drive_search(app: tauri::AppHandle, name: String, account_id: String) -> Result<Value, String> {
    let name = name.trim();
    if name.is_empty() { return Err("Enter a folder name.".into()); }
    let escaped = name.replace('\\', "\\\\").replace('\'', "\\'");
    let query = format!("trashed = false and mimeType = 'application/vnd.google-apps.folder' and name contains '{escaped}'");
    query_files(&app, &query, &account_id).await
}
async fn query_files(app: &tauri::AppHandle, query: &str, account_id: &str) -> Result<Value, String> {
    let mut files = Vec::new();
    let mut page = String::new();
    let mut seen = std::collections::HashSet::new();
    loop {
        if !seen.insert(page.clone()) { return Err("Google Drive returned an incomplete folder listing. Try again.".into()); }
        let response: Value = get(
            &app,
            "https://www.googleapis.com/drive/v3/files",
            &[
                ("q", &query),
                ("pageSize", "1000"),
                ("pageToken", &page),
                (
                    "fields",
                    "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,size)",
                ),
                ("supportsAllDrives", "true"),
                ("includeItemsFromAllDrives", "true"),
            ],
            Some(&account_id),
        )
        .await?
        .json()
        .await
        .map_err(|_| "Invalid Google Drive folder response.")?;
        if response["incompleteSearch"].as_bool() == Some(true) {
            return Err(
                "Google Drive returned an incomplete folder listing. Try refreshing again.".into(),
            );
        }
        files.extend(
            response["files"]
                .as_array()
                .ok_or("Google Drive returned an incomplete folder listing.")?
                .iter()
                .cloned(),
        );
        match response["nextPageToken"].as_str().filter(|s| !s.is_empty()) {
            Some(next) => page = next.into(),
            None => break,
        }
    }
    Ok(Value::Array(files))
}
#[tauri::command]
pub async fn drive_metadata(
    app: tauri::AppHandle,
    file_id: String,
    account_id: String,
) -> Result<Value, String> {
    id(&file_id)?;
    let value: Value = get(
        &app,
        &format!("https://www.googleapis.com/drive/v3/files/{file_id}"),
        &[
            ("fields", "id,name,mimeType,modifiedTime,size,trashed"),
            ("supportsAllDrives", "true"),
        ],
        Some(&account_id),
    )
    .await?
    .json()
    .await
    .map_err(|_| "Invalid Google Drive file response.")?;
    if value["trashed"].as_bool() == Some(true) {
        return Err("The connected folder is in Google Drive's trash. Restore it or connect another folder.".into());
    }
    Ok(value)
}
#[tauri::command]
pub async fn drive_download(
    app: tauri::AppHandle,
    file_id: String,
    account_id: String,
) -> Result<Vec<u8>, String> {
    let metadata = drive_metadata(app.clone(), file_id.clone(), account_id.clone()).await?;
    if metadata["mimeType"] != "application/pdf" {
        return Err("Only PDF files can be imported from Google Drive.".into());
    }
    Ok(get(
        &app,
        &format!("https://www.googleapis.com/drive/v3/files/{file_id}"),
        &[("alt", "media"), ("supportsAllDrives", "true")],
        Some(&account_id),
    )
    .await?
    .bytes()
    .await
    .map_err(|_| "Google Drive download was interrupted.")?
    .to_vec())
}

#[tauri::command]
pub async fn drive_start_token(app: tauri::AppHandle, account_id: String) -> Result<String, String> {
    let value: Value = get(&app, "https://www.googleapis.com/drive/v3/changes/startPageToken", &[("supportsAllDrives", "true")], Some(&account_id))
        .await?.json().await.map_err(|_| "Invalid Google Drive change marker.")?;
    value["startPageToken"].as_str().map(String::from).ok_or("Google Drive did not return a change marker.".into())
}
#[tauri::command]
pub async fn drive_changes(app: tauri::AppHandle, page_token: String, account_id: String) -> Result<Value, String> {
    get(&app, "https://www.googleapis.com/drive/v3/changes", &[
        ("pageToken", &page_token), ("pageSize", "1000"), ("spaces", "drive"),
        ("supportsAllDrives", "true"), ("includeItemsFromAllDrives", "true"), ("includeRemoved", "true"), ("includeCorpusRemovals", "true"),
        ("fields", "nextPageToken,newStartPageToken,changes(changeType,fileId,removed,file(id,name,mimeType,modifiedTime,size,parents,trashed))"),
    ], Some(&account_id)).await?.json().await.map_err(|_| "Invalid Google Drive changes response.".into())
}
