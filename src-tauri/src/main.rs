#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod drive;
fn main() {
    tauri::Builder::default()
        .manage(drive::DriveState::default())
        .invoke_handler(tauri::generate_handler![
            drive::drive_status,
            drive::drive_configure,
            drive::drive_connect,
            drive::drive_disconnect,
            drive::drive_list,
            drive::drive_search,
            drive::drive_start_token,
            drive::drive_changes,
            drive::drive_metadata,
            drive::drive_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mi Notes");
}
