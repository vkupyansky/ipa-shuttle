use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::SystemTime,
};

use chrono::Utc;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    auth_store::{self, AuthSessionManager},
    engine,
    errors::AppError,
    logging,
    models::{DownloadResult, LocalIpa, LocalIpaStatus},
    storage,
};

#[tauri::command]
pub async fn download_ipa(
    app: AppHandle,
    sessions: State<'_, AuthSessionManager>,
    bundle_id: String,
    app_name: Option<String>,
    source_device_name: Option<String>,
    visible_auth_state: Option<String>,
) -> Result<DownloadResult, AppError> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        download_ipa_sync(
            &app,
            &sessions,
            bundle_id,
            app_name,
            source_device_name,
            visible_auth_state,
        )
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join IPA download: {err}")))?
}

#[tauri::command]
pub async fn list_local_ipas() -> Result<Vec<LocalIpa>, AppError> {
    tauri::async_runtime::spawn_blocking(storage::list_local_ipas)
        .await
        .map_err(|err| AppError::storage(format!("Failed to join IPA library scan: {err}")))?
}

#[tauri::command]
pub async fn delete_local_ipas(ipa_ids: Vec<String>) -> Result<Vec<LocalIpa>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        storage::ensure_app_dirs()?;
        let removed = storage::delete_local_ipas(&ipa_ids)?;
        logging::log_success(
            "IPA Library",
            format!(
                "Deleted {removed} IPA library item{}",
                if removed == 1 { "" } else { "s" }
            ),
            None,
        )?;
        storage::list_local_ipas()
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join IPA deletion: {err}")))?
}

#[tauri::command]
pub async fn open_library_folder() -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(open_library_folder_sync)
        .await
        .map_err(|err| AppError::storage(format!("Failed to join Finder opener: {err}")))?
}

fn download_ipa_sync(
    app: &AppHandle,
    sessions: &AuthSessionManager,
    bundle_id: String,
    app_name: Option<String>,
    source_device_name: Option<String>,
    visible_auth_state: Option<String>,
) -> Result<DownloadResult, AppError> {
    engine::ensure_engines(app)?;
    storage::ensure_app_dirs()?;

    let auth_state = sessions.state()?;
    let decision = if auth_state.has_usable_session {
        "allowed"
    } else {
        "blocked"
    };
    let auth_details = auth_decision_details(visible_auth_state.as_deref(), &auth_state, decision);
    if !auth_state.has_usable_session {
        logging::log_warning(
            "Download",
            "Download blocked: Apple ID not signed in",
            Some(auth_details),
        )?;
        return Err(AppError::auth_required(
            if auth_state.state.as_str() == "sessionExpired" {
                "Sign in with Apple ID again."
            } else {
                "Apple ID is not signed in."
            },
        ));
    }

    let clean_bundle_id = bundle_id.trim().to_string();
    if clean_bundle_id.is_empty() {
        return Err(AppError::process_failed(
            "Could not download IPA.",
            "Bundle ID is empty.",
        ));
    }

    let library_dir = storage::library_dir()?;
    fs::create_dir_all(&library_dir)?;
    let started_at = SystemTime::now();
    let app_label = app_name.clone().unwrap_or_else(|| clean_bundle_id.clone());
    logging::log_info_with_details(
        "Download",
        format!("Downloading IPA: {app_label}"),
        auth_details,
    )?;
    let args = vec![
        "download".to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--non-interactive".to_string(),
        "-b".to_string(),
        clean_bundle_id.clone(),
        "--purchase".to_string(),
        "--platform".to_string(),
        "iphone".to_string(),
        "-o".to_string(),
        library_dir.to_string_lossy().to_string(),
    ];

    let (output, temp_session) = with_usable_auth_session(&auth_state, |session| {
        let temp_session = auth_store::write_session_temp(session)?;
        let session_path = temp_session.path_string();
        let output = engine::run_engine_with_env_quiet(
            app,
            "apple-auth-engine",
            &args,
            &[("IPASHUTTLE_AUTH_SESSION_FILE", &session_path)],
        )?;
        Ok((output, temp_session))
    })?;

    if !output.success {
        let combined = engine::combined_output(&output);
        if looks_like_auth_expired(&combined) {
            sessions.mark_session_expired()?;
            let expired_state = sessions.state()?;
            logging::log_warning(
                "Download",
                "Download blocked: Apple ID not signed in",
                Some(format!(
                    "{}\nengineDetails:\n{combined}",
                    auth_decision_details(visible_auth_state.as_deref(), &expired_state, "blocked")
                )),
            )?;
            return Err(AppError::auth_required(
                "Sign in with the Apple ID that owns this app.",
            ));
        }
        if looks_like_app_unavailable(&combined) {
            logging::log_warning(
                "Download",
                "Apple no longer provides this app for this Apple ID",
                Some(combined.clone()),
            )?;
            return Err(AppError::app_unavailable(combined));
        }
        logging::log_event(
            crate::models::LogLevel::Error,
            "Download",
            "IPA download failed",
            None,
            Some(combined.clone()),
        )?;
        return Err(AppError::process_failed(
            "Could not download IPA from Apple.",
            combined,
        ));
    }

    sessions.refresh_from_temp(&temp_session, auth_state.generation)?;

    let ipa_path = find_downloaded_ipa(&library_dir, started_at)
        .ok_or_else(|| AppError::ipa_missing("Download completed but no IPA file was found"))?;
    if !storage::validate_library_ipa(&ipa_path)? {
        return Err(AppError::ipa_missing(
            "Downloaded file is not a valid IPA in the local library",
        ));
    }
    let downloaded_at = Utc::now().to_rfc3339();
    let item = storage::new_manifest_item(
        Uuid::new_v4().to_string(),
        clean_bundle_id,
        app_name,
        ipa_path.to_string_lossy().to_string(),
        downloaded_at,
        source_device_name,
    );
    let item = storage::upsert_manifest_item(item)?;
    let local_ipa = storage::manifest_item_to_local_ipa(item);
    logging::log_success("Download", format!("IPA downloaded: {app_label}"), None)?;

    Ok(DownloadResult {
        ok: true,
        item: Some(local_ipa),
    })
}

fn with_usable_auth_session<T>(
    state: &auth_store::AuthSessionState,
    run: impl FnOnce(&auth_store::AppleAuthSession) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let session = state
        .session
        .as_ref()
        .filter(|_| state.has_usable_session)
        .ok_or_else(|| AppError::auth_required("Apple ID is not signed in."))?;
    run(session)
}

fn auth_decision_details(
    visible_state: Option<&str>,
    backend_state: &auth_store::AuthSessionState,
    decision: &str,
) -> String {
    format!(
        "visibleState: {}\nbackendState: {}\nhasInMemorySession: {}\nhasUsableSession: {}\nsessionSource: {}\ndownloadDecision: {decision}",
        visible_state.unwrap_or("unknown"),
        backend_state.state.as_str(),
        backend_state.has_in_memory_session,
        backend_state.has_usable_session,
        backend_state.source.as_str(),
    )
}

fn looks_like_auth_expired(output: &str) -> bool {
    let lowered = output.to_lowercase();
    lowered.contains("password token is expired")
        || lowered.contains("app store request rejected")
        || lowered.contains("sign in required")
        || lowered.contains("authentication required")
}

fn looks_like_app_unavailable(output: &str) -> bool {
    let lowered = output.to_lowercase();
    lowered.contains("not available")
        || lowered.contains("not found")
        || lowered.contains("not entitled")
        || lowered.contains("license")
        || lowered.contains("purchase")
        || lowered.contains("redownload")
}

fn find_downloaded_ipa(library_dir: &Path, started_at: SystemTime) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(library_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("ipa"))
        })
        .filter_map(|path| {
            let modified = fs::metadata(&path).ok()?.modified().ok()?;
            if modified >= started_at {
                Some((path, modified))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    candidates.sort_by_key(|(_, modified)| *modified);
    candidates.pop().map(|(path, _)| path)
}

fn open_library_folder_sync() -> Result<(), AppError> {
    storage::ensure_app_dirs()?;
    let library_dir = storage::library_dir()?;
    Command::new("/usr/bin/open")
        .arg(&library_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|err| {
            AppError::process_failed(
                "Could not open the local IPA library.",
                format!("Failed to open {}: {err}", library_dir.display()),
            )
        })?;
    logging::log_info("IPA Library", "Opened IPA library folder")?;
    Ok(())
}

pub fn assert_downloaded(local_ipa: &LocalIpa) -> Result<(), AppError> {
    match local_ipa.status {
        LocalIpaStatus::Downloaded => Ok(()),
        LocalIpaStatus::Missing => Err(AppError::ipa_missing(format!(
            "Missing IPA path: {}",
            local_ipa.ipa_path
        ))),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use serde_json::json;

    use super::*;
    use crate::{
        auth_store::{AppleAuthSession, SessionSource},
        models::AuthState,
    };

    fn usable_auth_state() -> auth_store::AuthSessionState {
        auth_store::AuthSessionState {
            state: AuthState::SignedIn,
            session: Some(AppleAuthSession {
                email: "person@example.com".to_string(),
                name: None,
                password_token: Some("token".to_string()),
                directory_services_identifier: Some("dsid".to_string()),
                store_front: Some("143441-1,29".to_string()),
                pod: None,
                cookies: vec![json!({"url":"https://buy.itunes.apple.com"})],
            }),
            source: SessionSource::Memory,
            has_in_memory_session: true,
            has_usable_session: true,
            generation: 1,
        }
    }

    #[test]
    fn signed_in_state_launches_download_engine_callback() {
        let launched = Cell::new(false);

        let result = with_usable_auth_session(&usable_auth_state(), |_| {
            launched.set(true);
            Ok("engine started")
        })
        .expect("usable auth should launch engine");

        assert!(launched.get());
        assert_eq!(result, "engine started");
    }

    #[test]
    fn blocked_auth_state_never_launches_download_engine_callback() {
        let launched = Cell::new(false);
        let mut state = usable_auth_state();
        state.state = AuthState::SessionExpired;
        state.has_usable_session = false;

        let error = with_usable_auth_session(&state, |_| {
            launched.set(true);
            Ok(())
        })
        .expect_err("expired auth must be blocked");

        assert!(!launched.get());
        assert_eq!(error.code, "AUTH_REQUIRED");
    }
}
