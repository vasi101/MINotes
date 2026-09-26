fn main() {
    for name in ["GOOGLE_DESKTOP_CLIENT_ID", "GOOGLE_DESKTOP_CLIENT_SECRET"] {
        println!("cargo:rerun-if-env-changed={name}");
        if let Ok(value) = std::env::var(name) {
            assert!(!value.contains(['\n', '\r']), "Invalid OAuth configuration");
            println!("cargo:rustc-env={name}={value}");
        }
    }
    tauri_build::build()
}
