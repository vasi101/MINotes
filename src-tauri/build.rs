fn main() {
    for name in ["GOOGLE_DESKTOP_CLIENT_ID", "GOOGLE_DESKTOP_CLIENT_SECRET"] {
        println!("cargo:rerun-if-env-changed={name}");
        if let Ok(value) = std::env::var(name) {
            assert!(!value.contains(['\n', '\r']), "Invalid OAuth configuration");
            println!("cargo:rustc-env={name}={value}");
        }
    }
    // The installed Tauri CLI still injects the deprecated STATIC_VCRUNTIME
    // environment variable. Set the same behavior through the build API instead.
    std::env::remove_var("STATIC_VCRUNTIME");
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new().static_vc_runtime(true),
        ),
    )
    .expect("failed to run tauri-build");
}
