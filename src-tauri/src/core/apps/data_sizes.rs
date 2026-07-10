use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use plist::Value;
use tauri::{AppHandle, State};

use crate::{
    engine,
    errors::AppError,
    logging,
    models::{AppDataSizeBatchResult, AppDataSizeResult, AppDataSizeStatus},
};

use super::value_to_u64;

const DATA_SIZE_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_BUNDLE_IDS: usize = 1_000;

#[derive(Debug)]
struct ActiveDataSizeBatch {
    batch_id: String,
    cancellation: Arc<AtomicBool>,
}

#[derive(Clone, Default)]
pub struct AppDataSizeManager {
    active: Arc<Mutex<Option<ActiveDataSizeBatch>>>,
}

impl AppDataSizeManager {
    fn begin(&self, batch_id: &str) -> Result<Arc<AtomicBool>, AppError> {
        let cancellation = Arc::new(AtomicBool::new(false));
        let mut active = self
            .active
            .lock()
            .map_err(|_| AppError::storage("App data size task lock poisoned"))?;
        if let Some(previous) = active.replace(ActiveDataSizeBatch {
            batch_id: batch_id.to_string(),
            cancellation: Arc::clone(&cancellation),
        }) {
            previous.cancellation.store(true, Ordering::Relaxed);
        }
        Ok(cancellation)
    }

    fn cancel(&self, batch_id: Option<&str>) -> Result<(), AppError> {
        let active = self
            .active
            .lock()
            .map_err(|_| AppError::storage("App data size task lock poisoned"))?;
        if let Some(active) = active.as_ref()
            && batch_id.is_none_or(|batch_id| batch_id == active.batch_id)
        {
            active.cancellation.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    fn finish(&self, batch_id: &str) -> Result<(), AppError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| AppError::storage("App data size task lock poisoned"))?;
        if active
            .as_ref()
            .is_some_and(|active| active.batch_id == batch_id)
        {
            *active = None;
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn fetch_app_data_sizes(
    app: AppHandle,
    manager: State<'_, AppDataSizeManager>,
    device_id: Option<String>,
    bundle_ids: Vec<String>,
    batch_id: String,
) -> Result<AppDataSizeBatchResult, AppError> {
    let batch_id = validate_batch_id(batch_id)?;
    let manager = manager.inner().clone();
    let cancellation = manager.begin(&batch_id)?;
    let task_batch_id = batch_id.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        fetch_app_data_sizes_sync(
            &app,
            device_id.as_deref(),
            bundle_ids,
            task_batch_id,
            cancellation,
        )
    })
    .await
    .map_err(|error| AppError::storage(format!("Failed to join app data size task: {error}")));
    manager.finish(&batch_id)?;
    let result = joined?;
    if let Err(error) = &result {
        logging::log_warning(
            "Apps",
            "App data sizes could not be loaded",
            Some(error.technical_message.clone()),
        )?;
    }
    result
}

#[tauri::command]
pub async fn cancel_app_data_sizes(
    manager: State<'_, AppDataSizeManager>,
    batch_id: Option<String>,
) -> Result<(), AppError> {
    manager.cancel(batch_id.as_deref())
}

fn fetch_app_data_sizes_sync(
    app: &AppHandle,
    device_id: Option<&str>,
    bundle_ids: Vec<String>,
    batch_id: String,
    cancellation: Arc<AtomicBool>,
) -> Result<AppDataSizeBatchResult, AppError> {
    let bundle_ids = normalize_bundle_ids(bundle_ids)?;
    if bundle_ids.is_empty() || cancellation.load(Ordering::Relaxed) {
        return Ok(cancelled_result(batch_id));
    }

    engine::ensure_engines(app)?;
    logging::log_info("Apps", "Loading app data sizes")?;
    let args = data_size_args(device_id, &bundle_ids);
    let output = engine::run_engine_cancellable_quiet(
        app,
        "ideviceinstaller",
        &args,
        Arc::clone(&cancellation),
        DATA_SIZE_TIMEOUT,
    )?;

    if cancellation.load(Ordering::Relaxed) {
        logging::log_info("Apps", "App data size loading cancelled")?;
        return Ok(cancelled_result(batch_id));
    }
    if !output.success {
        if let Some(error) = engine::classify_device_error(&output) {
            return Err(error);
        }
        return Err(AppError::process_failed(
            "Could not load app data sizes.",
            engine::combined_output(&output),
        ));
    }

    let dynamic_sizes = parse_dynamic_sizes(&output.stdout)?;
    if cancellation.load(Ordering::Relaxed) {
        logging::log_info("Apps", "App data size loading cancelled")?;
        return Ok(cancelled_result(batch_id));
    }

    let items = bundle_ids
        .into_iter()
        .map(|bundle_id| {
            let dynamic_disk_usage_bytes = dynamic_sizes.get(&bundle_id).copied().flatten();
            AppDataSizeResult {
                bundle_id,
                status: if dynamic_disk_usage_bytes.is_some() {
                    AppDataSizeStatus::Loaded
                } else {
                    AppDataSizeStatus::Unavailable
                },
                dynamic_disk_usage_bytes,
            }
        })
        .collect::<Vec<_>>();
    let loaded = items
        .iter()
        .filter(|item| item.status == AppDataSizeStatus::Loaded)
        .count();
    logging::log_success(
        "Apps",
        format!("App data sizes loaded: {loaded} apps"),
        None,
    )?;

    Ok(AppDataSizeBatchResult {
        batch_id,
        items,
        cancelled: false,
    })
}

fn validate_batch_id(batch_id: String) -> Result<String, AppError> {
    let batch_id = batch_id.trim().to_string();
    if batch_id.is_empty() || batch_id.len() > 128 {
        return Err(AppError::process_failed(
            "Could not load app data sizes.",
            "Invalid app data size batch id",
        ));
    }
    Ok(batch_id)
}

fn normalize_bundle_ids(bundle_ids: Vec<String>) -> Result<Vec<String>, AppError> {
    if bundle_ids.len() > MAX_BUNDLE_IDS {
        return Err(AppError::process_failed(
            "Could not load app data sizes.",
            "Too many bundle identifiers",
        ));
    }

    let mut seen = HashSet::new();
    let mut normalized = Vec::new();
    for bundle_id in bundle_ids {
        let bundle_id = bundle_id.trim();
        if bundle_id.is_empty()
            || bundle_id.len() > 255
            || bundle_id.starts_with('-')
            || !bundle_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        {
            return Err(AppError::process_failed(
                "Could not load app data sizes.",
                "Invalid bundle identifier",
            ));
        }
        if seen.insert(bundle_id.to_string()) {
            normalized.push(bundle_id.to_string());
        }
    }
    Ok(normalized)
}

fn data_size_args(device_id: Option<&str>, bundle_ids: &[String]) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(device_id) = device_id {
        args.extend(["-u".to_string(), device_id.to_string()]);
    }
    args.extend([
        "list".to_string(),
        "--user".to_string(),
        "--xml".to_string(),
        "-a".to_string(),
        "CFBundleIdentifier".to_string(),
        "-a".to_string(),
        "DynamicDiskUsage".to_string(),
    ]);
    for bundle_id in bundle_ids {
        args.extend(["-b".to_string(), bundle_id.clone()]);
    }
    args
}

fn parse_dynamic_sizes(stdout: &str) -> Result<HashMap<String, Option<u64>>, AppError> {
    let value = Value::from_reader_xml(Cursor::new(stdout.as_bytes())).map_err(|error| {
        AppError::process_failed("Could not parse app data sizes.", error.to_string())
    })?;
    let Value::Array(items) = value else {
        return Ok(HashMap::new());
    };

    Ok(items
        .into_iter()
        .filter_map(|item| {
            let Value::Dictionary(dictionary) = item else {
                return None;
            };
            let bundle_id = dictionary
                .get("CFBundleIdentifier")?
                .as_string()?
                .trim()
                .to_string();
            if bundle_id.is_empty() {
                return None;
            }
            Some((bundle_id, value_to_u64(dictionary.get("DynamicDiskUsage"))))
        })
        .collect())
}

fn cancelled_result(batch_id: String) -> AppDataSizeBatchResult {
    AppDataSizeBatchResult {
        batch_id,
        items: Vec::new(),
        cancelled: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_size_request_is_filtered_and_only_requests_dynamic_usage() {
        let args = data_size_args(
            Some("device-id"),
            &["com.example.one".to_string(), "com.example.two".to_string()],
        );

        assert!(
            args.windows(2)
                .any(|pair| pair == ["-a", "DynamicDiskUsage"])
        );
        assert!(!args.iter().any(|arg| arg == "StaticDiskUsage"));
        assert_eq!(args.iter().filter(|arg| *arg == "-b").count(), 2);
    }

    #[test]
    fn parses_dynamic_sizes_and_marks_missing_values_unavailable() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array>
  <dict><key>CFBundleIdentifier</key><string>com.example.one</string><key>DynamicDiskUsage</key><integer>84</integer></dict>
  <dict><key>CFBundleIdentifier</key><string>com.example.two</string></dict>
</array></plist>"#;

        let parsed = parse_dynamic_sizes(xml).expect("data size plist should parse");

        assert_eq!(parsed.get("com.example.one"), Some(&Some(84)));
        assert_eq!(parsed.get("com.example.two"), Some(&None));
    }

    #[test]
    fn starting_or_cancelling_a_batch_sets_its_token() {
        let manager = AppDataSizeManager::default();
        let first = manager.begin("first").expect("first batch should start");
        let second = manager.begin("second").expect("second batch should start");

        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
        manager
            .cancel(Some("second"))
            .expect("second batch should cancel");
        assert!(second.load(Ordering::Relaxed));
    }
}
