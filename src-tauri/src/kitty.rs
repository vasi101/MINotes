use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, Command, Stdio}, sync::{mpsc, Arc, Mutex}, time::Duration};
use tauri::{ipc::Channel, Manager};

struct Pending { result: mpsc::Sender<Result<Value, String>>, events: Channel<Value> }
struct Runtime { child: Child, input: ChildStdin, pending: Arc<Mutex<HashMap<String, Pending>>> }
impl Drop for Runtime { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
#[derive(Default)]
pub struct KittyState { runtime: Mutex<Option<Runtime>> }

fn start(app: &tauri::AppHandle) -> Result<Runtime, String> {
    let (node, worker) = if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().ok_or("Missing project directory")?;
        (std::path::PathBuf::from("node"), root.join("server/kitty/worker.mjs"))
    } else {
        let root = app.path().resource_dir().map_err(|e| e.to_string())?.join("kitty-runtime");
        (root.join("node.exe"), root.join("worker.mjs"))
    };
    let mut command = Command::new(node);
    command.arg(worker).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn().map_err(|_| "Kitty runtime is unavailable. Reinstall Mi Notes or prepare the development runtime.".to_string())?;
    let input = child.stdin.take().ok_or("Unable to open Kitty input")?;
    let output = child.stdout.take().ok_or("Unable to open Kitty output")?;
    let pending = Arc::new(Mutex::new(HashMap::<String, Pending>::new()));
    let targets = pending.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else { break }; let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            let Some(id) = message["id"].as_str() else { continue };
            let Ok(mut targets) = targets.lock() else { break };
            if let Some(event) = message.get("event") {
                if let Some(target) = targets.get(id) { let _ = target.events.send(event.clone()); }
            } else if let Some(target) = targets.remove(id) {
                let result = if let Some(error) = message["error"].as_str() { Err(error.to_string()) } else { Ok(message["result"].clone()) };
                let _ = target.result.send(result);
            }
        }
        if let Ok(mut targets) = targets.lock() { for (_, target) in targets.drain() { let _ = target.result.send(Err("Kitty stopped unexpectedly. Retry to restart it; partial downloads are retained.".into())); } }
    });
    Ok(Runtime { child, input, pending })
}

#[tauri::command]
pub async fn kitty_request(app: tauri::AppHandle, state: tauri::State<'_, KittyState>, method: String, args: Value, on_event: Channel<Value>) -> Result<Value, String> {
    if !["status", "hardware", "install", "generate", "cancel", "remove", "web-search", "cloud-status", "cloud-connect", "cloud-disconnect", "cloud-generate"].contains(&method.as_str()) || args.to_string().len() > 45000 { return Err("Invalid Kitty request".into()); }
    let id = args["requestId"].as_str().ok_or("Missing request ID")?.to_string();
    if id.len() > 100 { return Err("Invalid request ID".into()); }
    let (sender, receiver) = mpsc::channel();
    {
        let mut guard = state.runtime.lock().map_err(|_| "Kitty runtime lock unavailable")?;
        let restart = match guard.as_mut() { Some(r) => r.child.try_wait().map_err(|e| e.to_string())?.is_some(), None => true };
        if restart { *guard = Some(start(&app)?); }
        let runtime = guard.as_mut().ok_or("Kitty did not start")?;
        runtime.pending.lock().map_err(|_| "Kitty request lock unavailable")?.insert(id.clone(), Pending { result: sender, events: on_event });
        if writeln!(runtime.input, "{}", json!({"id":id,"method":method,"args":args})).is_err() {
            runtime.pending.lock().map_err(|_| "Kitty request lock unavailable")?.remove(&id);
            return Err("Unable to send request to Kitty. Retry.".into());
        }
    }
    tauri::async_runtime::spawn_blocking(move || receiver.recv().map_err(|_| "Kitty disconnected".to_string())?).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn kitty_dictionary(term: String) -> Result<Value, String> {
    if term.is_empty() || term.len() > 240 || term.split_whitespace().count() > 2 { return Err("Invalid dictionary term".into()); }
    let mut url = reqwest::Url::parse("https://freedictionaryapi.com/api/v1/entries/en/").map_err(|e| e.to_string())?;
    url.path_segments_mut().map_err(|_| "Invalid dictionary URL")?.pop_if_empty().push(&term);
    let response = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().map_err(|e| e.to_string())?.get(url).send().await.map_err(|_| "Dictionary is temporarily unavailable")?;
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|_| "Unable to read dictionary response")?;
    Ok(json!({"status":status,"body":body}))
}
