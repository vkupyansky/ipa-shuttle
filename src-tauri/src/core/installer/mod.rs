use tauri::AppHandle;

use crate::{engine, errors::AppError, ipa_library, logging, models::InstallResult, storage};

#[tauri::command]
pub async fn install_ipa(
    app: AppHandle,
    device_id: String,
    ipa_id: String,
) -> Result<InstallResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || install_ipa_sync(&app, &device_id, &ipa_id))
        .await
        .map_err(|err| AppError::storage(format!("Failed to join IPA installation: {err}")))?
}

fn install_ipa_sync(
    app: &AppHandle,
    device_id: &str,
    ipa_id: &str,
) -> Result<InstallResult, AppError> {
    engine::ensure_engines(app)?;
    let local_ipa = storage::find_local_ipa(ipa_id)?
        .ok_or_else(|| AppError::ipa_missing(format!("Unknown IPA id: {ipa_id}")))?;
    ipa_library::assert_downloaded(&local_ipa)?;

    if !storage::validate_library_ipa(std::path::Path::new(&local_ipa.ipa_path))? {
        return Err(AppError::ipa_missing(format!(
            "Missing IPA path: {}",
            local_ipa.ipa_path
        )));
    }

    let clean_device_id = device_id.trim();
    if clean_device_id.is_empty() {
        return Err(AppError::no_device("Target device ID is empty."));
    }

    let args = vec![
        "-u".to_string(),
        clean_device_id.to_string(),
        "install".to_string(),
        local_ipa.ipa_path.clone(),
    ];
    let app_label = local_ipa
        .app_name
        .clone()
        .unwrap_or_else(|| local_ipa.bundle_id.clone());
    logging::log_info("Install", format!("Installing IPA: {app_label}"))?;
    let output = engine::run_engine(
        app,
        "ideviceinstaller",
        &args,
        &args,
        "Installed IPA on target iPhone",
    )?;

    if !output.success {
        if let Some(error) = engine::classify_device_error(&output) {
            return Err(error);
        }
        return Err(AppError::install_failed(engine::combined_output(&output)));
    }

    logging::log_success("Install", format!("IPA installed: {app_label}"), None)?;
    Ok(InstallResult {
        ok: true,
        ipa_id: ipa_id.to_string(),
        bundle_id: Some(local_ipa.bundle_id),
    })
}
