mod core;
mod engine;
mod models;

pub(crate) use core::{
    apps, auth, auth_store, devices, errors, installer, ipa_library, logging, storage,
};

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .manage(auth::AppleLoginState::default())
        .manage(auth_store::AuthSessionManager::default())
        .manage(apps::AppDataSizeManager::default())
        .setup(|app| {
            storage::ensure_app_dirs()?;
            logging::log_info("Application", "App started")?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("IPA Shuttle");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::get_engine_status,
            devices::detect_devices,
            devices::get_device_info,
            apps::scan_installed_apps,
            apps::data_sizes::fetch_app_data_sizes,
            apps::data_sizes::cancel_app_data_sizes,
            apps::fetch_app_icons,
            apps::refetch_app_icon,
            auth::get_apple_auth_status,
            auth::start_apple_login,
            auth::submit_apple_verification_code,
            auth::cancel_apple_login,
            auth::use_saved_apple_session,
            auth::forget_apple_session,
            ipa_library::download_ipa,
            ipa_library::list_local_ipas,
            ipa_library::delete_local_ipas,
            ipa_library::open_library_folder,
            installer::install_ipa,
            logging::write_activity_event,
            logging::read_activity_log,
            logging::read_activity_diagnostics,
            logging::clear_activity_logs,
            logging::open_logs_folder,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run IPA Shuttle");
}
