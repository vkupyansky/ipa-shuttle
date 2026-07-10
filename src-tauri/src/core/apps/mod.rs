use std::{
    collections::{HashSet, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use chrono::Utc;
use plist::Value;
use tauri::{AppHandle, Emitter};

use crate::{
    engine,
    errors::AppError,
    logging,
    models::{AppDataSizeStatus, AppIconResult, AppIconStatus, AppInfo, AppSource, LogLevel},
    storage,
};

pub(crate) mod data_sizes;

pub use data_sizes::AppDataSizeManager;

const ICON_RESULT_EVENT: &str = "app-icon-result";
const ICON_CONCURRENCY_LIMIT: usize = 4;
const ICON_TIMEOUT: Duration = Duration::from_secs(2);
const ICON_BATCH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
struct IconFetchJob {
    bundle_id: String,
    cache_invalid: bool,
    cache_details: Option<String>,
}

#[tauri::command]
pub async fn scan_installed_apps(
    app: AppHandle,
    device_id: Option<String>,
) -> Result<Vec<AppInfo>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_installed_apps_sync(&app, device_id.as_deref())
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join app scan: {err}")))?
}

#[tauri::command]
pub async fn fetch_app_icons(
    app: AppHandle,
    device_id: Option<String>,
    bundle_ids: Vec<String>,
    batch_id: Option<String>,
) -> Result<Vec<AppIconResult>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_app_icons_sync(&app, device_id.as_deref(), bundle_ids, batch_id)
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join app icon fetch: {err}")))?
}

#[tauri::command]
pub async fn refetch_app_icon(
    app: AppHandle,
    device_id: Option<String>,
    bundle_id: String,
    batch_id: Option<String>,
) -> Result<AppIconResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        refetch_app_icon_sync(
            &app,
            device_id.as_deref(),
            bundle_id,
            batch_id,
            "Icon refetch",
        )
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join app icon refetch: {err}")))?
}

fn scan_installed_apps_sync(
    app: &AppHandle,
    device_id: Option<&str>,
) -> Result<Vec<AppInfo>, AppError> {
    engine::ensure_engines(app)?;
    logging::log_info("Apps", "Scanning installed apps")?;

    let args = initial_scan_args(device_id);

    let output = engine::run_engine(
        app,
        "ideviceinstaller",
        &args,
        &args,
        "Scanned installed iPhone apps",
    )?;

    if !output.success {
        if let Some(error) = engine::classify_device_error(&output) {
            return Err(error);
        }
        return Err(AppError::process_failed(
            "Could not scan installed apps.",
            engine::combined_output(&output),
        ));
    }

    let mut apps = parse_apps_from_plist(&output.stdout)?;
    apps.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.bundle_id.cmp(&right.bundle_id))
    });
    apps.dedup_by(|left, right| left.bundle_id == right.bundle_id);
    logging::log_success(
        "Apps",
        format!("Scan completed: {} apps found", apps.len()),
        None,
    )?;

    Ok(apps)
}

fn initial_scan_args(device_id: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(udid) = device_id {
        args.push("-u".to_string());
        args.push(udid.to_string());
    }
    args.extend([
        "list".to_string(),
        "--user".to_string(),
        "--xml".to_string(),
        "-a".to_string(),
        "CFBundleIdentifier".to_string(),
        "-a".to_string(),
        "CFBundleDisplayName".to_string(),
        "-a".to_string(),
        "CFBundleName".to_string(),
        "-a".to_string(),
        "CFBundleShortVersionString".to_string(),
        "-a".to_string(),
        "StaticDiskUsage".to_string(),
    ]);
    args
}

fn parse_apps_from_plist(stdout: &str) -> Result<Vec<AppInfo>, AppError> {
    let value = Value::from_reader_xml(std::io::Cursor::new(stdout.as_bytes())).map_err(|err| {
        AppError::process_failed("Could not parse installed apps.", err.to_string())
    })?;

    let apps = match value {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|item| match item {
                Value::Dictionary(dictionary) => {
                    let bundle_id = dictionary
                        .get("CFBundleIdentifier")
                        .and_then(Value::as_string)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())?
                        .to_string();
                    let name = dictionary
                        .get("CFBundleDisplayName")
                        .or_else(|| dictionary.get("CFBundleName"))
                        .and_then(Value::as_string)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(&bundle_id)
                        .to_string();
                    let version = dictionary
                        .get("CFBundleShortVersionString")
                        .and_then(Value::as_string)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToOwned::to_owned);
                    let static_disk_usage_bytes = value_to_u64(dictionary.get("StaticDiskUsage"));
                    let (icon_path, icon_updated_at, icon_cache_version) =
                        storage::cached_icon_metadata(&bundle_id);
                    let icon_status = if icon_path.is_some() {
                        AppIconStatus::Cached
                    } else {
                        AppIconStatus::Loading
                    };

                    Some(AppInfo {
                        name,
                        bundle_id,
                        source: AppSource::Device,
                        version,
                        static_disk_usage_bytes,
                        dynamic_disk_usage_bytes: None,
                        total_disk_usage_bytes: None,
                        data_size_status: AppDataSizeStatus::NotLoaded,
                        icon_path,
                        icon_updated_at,
                        icon_cache_version,
                        icon_status,
                        icon_error: None,
                    })
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };

    Ok(apps)
}

fn fetch_app_icons_sync(
    app: &AppHandle,
    device_id: Option<&str>,
    bundle_ids: Vec<String>,
    batch_id: Option<String>,
) -> Result<Vec<AppIconResult>, AppError> {
    storage::ensure_app_dirs()?;
    let started_at = Instant::now();

    let mut unique_bundle_ids = bundle_ids
        .into_iter()
        .map(|bundle_id| bundle_id.trim().to_string())
        .filter(|bundle_id| !bundle_id.is_empty())
        .collect::<Vec<_>>();
    unique_bundle_ids.sort();
    unique_bundle_ids.dedup();

    if unique_bundle_ids.is_empty() {
        return Ok(Vec::new());
    }

    let cache_lookup_started_at = Instant::now();
    let mut all_results = Vec::new();
    let mut icon_jobs = Vec::new();

    for bundle_id in unique_bundle_ids {
        let lookup = storage::validate_icon_cache(&bundle_id)?;
        if lookup.valid {
            let result = cached_icon_result(batch_id.clone(), &bundle_id, lookup);
            emit_icon_result(app, &result);
            all_results.push(result);
        } else {
            let cache_invalid = lookup.exists || lookup.metadata_version.is_some();
            let cache_details = if cache_invalid {
                let details = storage::icon_validation_details(&bundle_id, &lookup);
                storage::invalidate_icon_cache(&bundle_id)?;
                Some(details)
            } else {
                None
            };
            icon_jobs.push(IconFetchJob {
                bundle_id,
                cache_invalid,
                cache_details,
            });
        }
    }
    let cache_lookup_ms = cache_lookup_started_at.elapsed().as_millis();

    if icon_jobs.is_empty() {
        log_icon_summary(
            &all_results,
            started_at.elapsed().as_millis(),
            cache_lookup_ms,
            0,
        )?;
        return Ok(all_results);
    }

    if !engine::engine_available(app, "ipashuttle-icons") {
        let fallback_results = fallback_results_from_jobs(
            batch_id.clone(),
            icon_jobs,
            "App icons are unavailable, using fallback icons.",
            None,
            AppIconStatus::Failed,
        );
        for result in &fallback_results {
            emit_icon_result(app, result);
        }
        all_results.extend(fallback_results);
        logging::log_warning(
            "App Icons",
            "App icons are unavailable, using fallback icons",
            Some("Icon engine is missing from the app bundle.".to_string()),
        )?;
        log_icon_summary(
            &all_results,
            started_at.elapsed().as_millis(),
            cache_lookup_ms,
            0,
        )?;
        return Ok(all_results);
    }

    let device_fetch_started_at = Instant::now();
    let queue = Arc::new(Mutex::new(VecDeque::from(icon_jobs.clone())));
    let shared_results = Arc::new(Mutex::new(Vec::<AppIconResult>::new()));
    let abort_batch = Arc::new(AtomicBool::new(false));
    let worker_count =
        ICON_CONCURRENCY_LIMIT.min(queue.lock().map(|queue| queue.len()).unwrap_or(0).max(1));
    let deadline = Instant::now() + ICON_BATCH_TIMEOUT;

    thread::scope(|scope| {
        for _ in 0..worker_count {
            let queue = Arc::clone(&queue);
            let shared_results = Arc::clone(&shared_results);
            let abort_batch = Arc::clone(&abort_batch);
            let app = app.clone();
            let device_id = device_id.map(ToOwned::to_owned);
            let batch_id = batch_id.clone();

            scope.spawn(move || {
                while !abort_batch.load(Ordering::Relaxed) && Instant::now() < deadline {
                    let Some(job) = queue.lock().ok().and_then(|mut queue| queue.pop_front())
                    else {
                        break;
                    };

                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        break;
                    }

                    let timeout = ICON_TIMEOUT.min(remaining);
                    let result =
                        fetch_one_icon(&app, batch_id.clone(), device_id.as_deref(), job, timeout);
                    if helper_unavailable(&result) {
                        abort_batch.store(true, Ordering::Relaxed);
                    }
                    emit_icon_result(&app, &result);
                    if let Ok(mut shared_results) = shared_results.lock() {
                        shared_results.push(result);
                    }
                }
            });
        }
    });
    let device_fetch_ms = device_fetch_started_at.elapsed().as_millis();

    let mut fetched_results = Arc::try_unwrap(shared_results)
        .map_err(|_| AppError::storage("Could not collect app icon results"))?
        .into_inner()
        .map_err(|_| AppError::storage("App icon result lock poisoned"))?;

    let processed = fetched_results
        .iter()
        .map(|result| result.bundle_id.clone())
        .collect::<HashSet<_>>();
    let missed = icon_jobs
        .into_iter()
        .filter(|job| !processed.contains(&job.bundle_id))
        .collect::<Vec<_>>();
    if !missed.is_empty() {
        let reason = if abort_batch.load(Ordering::Relaxed) {
            "App icons are unavailable, using fallback icons."
        } else {
            "Icon loading timed out, using fallback icons."
        };
        let missed_results = fallback_results_from_jobs(
            batch_id.clone(),
            missed,
            reason,
            None,
            AppIconStatus::Fallback,
        );
        for result in &missed_results {
            emit_icon_result(app, result);
        }
        fetched_results.extend(missed_results);
    }

    all_results.extend(fetched_results);
    all_results.sort_by(|left, right| left.bundle_id.cmp(&right.bundle_id));
    for result in all_results.iter().filter(|result| result.ok) {
        if let Some(icon_path) = result.icon_path.as_deref() {
            storage::update_manifest_icon(
                &result.bundle_id,
                icon_path,
                result.icon_updated_at.as_deref(),
                result.icon_cache_version,
            )?;
        }
    }

    if abort_batch.load(Ordering::Relaxed) {
        logging::log_warning(
            "App Icons",
            "App icons are unavailable, using fallback icons",
            first_technical_details(&all_results),
        )?;
    }
    log_icon_summary(
        &all_results,
        started_at.elapsed().as_millis(),
        cache_lookup_ms,
        device_fetch_ms,
    )?;
    Ok(all_results)
}

fn fetch_one_icon(
    app: &AppHandle,
    batch_id: Option<String>,
    device_id: Option<&str>,
    job: IconFetchJob,
    timeout: Duration,
) -> AppIconResult {
    let bundle_id = job.bundle_id.clone();
    match fetch_one_icon_result(app, batch_id.clone(), device_id, job, timeout) {
        Ok(result) => result,
        Err(error) => AppIconResult {
            batch_id,
            bundle_id,
            icon_path: None,
            icon_updated_at: None,
            icon_cache_version: None,
            width: None,
            height: None,
            file_size: None,
            cache_invalid: false,
            render_failed: false,
            status: AppIconStatus::Failed,
            icon_error: Some("App icon unavailable.".to_string()),
            technical_details: Some(error.technical_message),
            ok: false,
        },
    }
}

fn fetch_one_icon_result(
    app: &AppHandle,
    batch_id: Option<String>,
    device_id: Option<&str>,
    job: IconFetchJob,
    timeout: Duration,
) -> Result<AppIconResult, AppError> {
    let bundle_id = job.bundle_id;
    let icon_path = storage::cached_icon_path(&bundle_id)?;
    let mut args = vec![
        "--bundle-id".to_string(),
        bundle_id.clone(),
        "--output".to_string(),
        icon_path.to_string_lossy().to_string(),
    ];
    if let Some(udid) = device_id {
        args.push("--udid".to_string());
        args.push(udid.to_string());
    }

    let output = engine::run_engine_with_timeout(app, "ipashuttle-icons", &args, &args, timeout)?;

    if !output.success {
        let validation = storage::validate_icon_cache(&bundle_id)?;
        let technical_details = join_details([
            job.cache_details,
            Some(format!(
                "helperOutput:\n{}",
                engine::combined_output(&output)
            )),
            Some(storage::icon_validation_details(&bundle_id, &validation)),
        ]);
        let _ = storage::invalidate_icon_cache(&bundle_id);
        let unavailable = helper_unavailable_output(&output);
        return Ok(AppIconResult {
            batch_id,
            bundle_id,
            icon_path: None,
            icon_updated_at: None,
            icon_cache_version: None,
            width: None,
            height: None,
            file_size: None,
            cache_invalid: job.cache_invalid,
            render_failed: false,
            status: if unavailable {
                AppIconStatus::Failed
            } else {
                AppIconStatus::Fallback
            },
            icon_error: Some(if output.stderr.to_lowercase().contains("timed out") {
                "Icon request timed out.".to_string()
            } else {
                "Icon unavailable.".to_string()
            }),
            technical_details,
            ok: false,
        });
    }

    let lookup = match storage::write_icon_cache_metadata(&bundle_id) {
        Ok(lookup) => lookup,
        Err(error) => {
            let validation = storage::validate_icon_cache(&bundle_id)?;
            let technical_details = join_details([
                job.cache_details,
                Some(format!(
                    "helperOutput:\n{}",
                    engine::combined_output(&output)
                )),
                Some(format!("validationError:\n{}", error.technical_message)),
                Some(storage::icon_validation_details(&bundle_id, &validation)),
            ]);
            let _ = storage::invalidate_icon_cache(&bundle_id);
            return Ok(AppIconResult {
                batch_id,
                bundle_id,
                icon_path: None,
                icon_updated_at: None,
                icon_cache_version: None,
                width: None,
                height: None,
                file_size: None,
                cache_invalid: job.cache_invalid,
                render_failed: false,
                status: AppIconStatus::Fallback,
                icon_error: Some("Icon unavailable.".to_string()),
                technical_details,
                ok: false,
            });
        }
    };
    let technical_details = join_details([
        job.cache_details,
        Some(storage::icon_validation_details(&bundle_id, &lookup)),
    ]);

    Ok(AppIconResult {
        batch_id,
        bundle_id,
        icon_path: Some(lookup.path.to_string_lossy().to_string()),
        icon_updated_at: lookup
            .updated_at
            .clone()
            .or_else(|| Some(Utc::now().to_rfc3339())),
        icon_cache_version: Some(storage::ICON_CACHE_VERSION),
        width: lookup.width,
        height: lookup.height,
        file_size: lookup.file_size,
        cache_invalid: job.cache_invalid,
        render_failed: false,
        status: AppIconStatus::Loaded,
        icon_error: None,
        technical_details,
        ok: true,
    })
}

fn cached_icon_result(
    batch_id: Option<String>,
    bundle_id: &str,
    lookup: storage::IconCacheLookup,
) -> AppIconResult {
    AppIconResult {
        batch_id,
        bundle_id: bundle_id.to_string(),
        icon_path: Some(lookup.path.to_string_lossy().to_string()),
        icon_updated_at: lookup.updated_at.clone(),
        icon_cache_version: Some(storage::ICON_CACHE_VERSION),
        width: lookup.width,
        height: lookup.height,
        file_size: lookup.file_size,
        cache_invalid: false,
        render_failed: false,
        status: AppIconStatus::Cached,
        icon_error: None,
        technical_details: Some(storage::icon_validation_details(bundle_id, &lookup)),
        ok: true,
    }
}

fn fallback_results_from_jobs(
    batch_id: Option<String>,
    jobs: Vec<IconFetchJob>,
    message: &str,
    technical_details: Option<String>,
    status: AppIconStatus,
) -> Vec<AppIconResult> {
    jobs.into_iter()
        .map(|job| {
            let technical_details = join_details([job.cache_details, technical_details.clone()]);
            AppIconResult {
                batch_id: batch_id.clone(),
                bundle_id: job.bundle_id,
                icon_path: None,
                icon_updated_at: None,
                icon_cache_version: None,
                width: None,
                height: None,
                file_size: None,
                cache_invalid: job.cache_invalid,
                render_failed: false,
                status: status.clone(),
                icon_error: Some(message.to_string()),
                technical_details,
                ok: false,
            }
        })
        .collect()
}

fn emit_icon_result(app: &AppHandle, result: &AppIconResult) {
    let _ = app.emit(ICON_RESULT_EVENT, result);
}

fn helper_unavailable(result: &AppIconResult) -> bool {
    result.status == AppIconStatus::Failed
        && result
            .technical_details
            .as_deref()
            .is_some_and(helper_unavailable_text)
}

fn helper_unavailable_output(output: &crate::models::ProcessOutput) -> bool {
    output
        .exit_code
        .is_some_and(|code| matches!(code, 126 | 127))
        || helper_unavailable_text(&engine::combined_output(output))
}

fn helper_unavailable_text(value: &str) -> bool {
    let lowered = value.to_lowercase();
    lowered.contains("dyld")
        || lowered.contains("library not loaded")
        || lowered.contains("image not found")
        || lowered.contains("bad cpu type")
        || lowered.contains("could not connect to iphone")
        || lowered.contains("could not start springboardservices")
}

fn log_icon_summary(
    results: &[AppIconResult],
    duration_ms: u128,
    cache_lookup_ms: u128,
    device_fetch_ms: u128,
) -> Result<(), AppError> {
    let cached = results
        .iter()
        .filter(|result| result.status == AppIconStatus::Cached)
        .count();
    let loaded = results
        .iter()
        .filter(|result| result.status == AppIconStatus::Loaded)
        .count();
    let fallback = results
        .iter()
        .filter(|result| result.status == AppIconStatus::Fallback)
        .count();
    let failed = results
        .iter()
        .filter(|result| result.status == AppIconStatus::Failed)
        .count();
    let cache_invalid = results.iter().filter(|result| result.cache_invalid).count();
    let render_failed = results.iter().filter(|result| result.render_failed).count();
    let summary = format!(
        "loadedFromDevice: {loaded}\ncachedValid: {cached}\nfallback: {fallback}\ncacheInvalid: {cache_invalid}\nrenderFailed: {render_failed}\nhelperFailed: {failed}\ncacheLookupMs: {cache_lookup_ms}\ndeviceFetchMs: {device_fetch_ms}\ntotalIconPipelineMs: {duration_ms}"
    );
    let details = join_details([Some(summary), first_technical_details(results)]);
    if failed > 0 || fallback > 0 || cache_invalid > 0 || render_failed > 0 {
        logging::log_event(
            LogLevel::Warning,
            "App Icons",
            "App icons are unavailable, using fallback icons",
            Some(duration_ms),
            details,
        )
    } else {
        logging::log_event(
            LogLevel::Success,
            "App Icons",
            "App icons loaded",
            Some(duration_ms),
            details,
        )
    }
}

fn first_technical_details(results: &[AppIconResult]) -> Option<String> {
    results
        .iter()
        .find_map(|result| result.technical_details.clone())
}

fn refetch_app_icon_sync(
    app: &AppHandle,
    device_id: Option<&str>,
    bundle_id: String,
    batch_id: Option<String>,
    task_name: &str,
) -> Result<AppIconResult, AppError> {
    storage::ensure_app_dirs()?;
    let started_at = Instant::now();
    let lookup = storage::validate_icon_cache(&bundle_id).ok();
    let cache_invalid = lookup
        .as_ref()
        .is_some_and(|lookup| lookup.exists || lookup.metadata_version.is_some());
    let cache_details = lookup
        .as_ref()
        .filter(|_| cache_invalid)
        .map(|lookup| storage::icon_validation_details(&bundle_id, lookup));
    storage::invalidate_icon_cache(&bundle_id)?;

    let result = if engine::engine_available(app, "ipashuttle-icons") {
        fetch_one_icon(
            app,
            batch_id,
            device_id,
            IconFetchJob {
                bundle_id: bundle_id.clone(),
                cache_invalid,
                cache_details,
            },
            ICON_TIMEOUT,
        )
    } else {
        fallback_results_from_jobs(
            batch_id,
            vec![IconFetchJob {
                bundle_id: bundle_id.clone(),
                cache_invalid,
                cache_details,
            }],
            "App icons are unavailable, using fallback icons.",
            Some("Icon engine is missing from the app bundle.".to_string()),
            AppIconStatus::Failed,
        )
        .remove(0)
    };

    if let Some(icon_path) = result.icon_path.as_deref() {
        storage::update_manifest_icon(
            &result.bundle_id,
            icon_path,
            result.icon_updated_at.as_deref(),
            result.icon_cache_version,
        )?;
    }
    emit_icon_result(app, &result);

    let duration_ms = Some(started_at.elapsed().as_millis());
    if result.ok {
        logging::log_success(
            "App Icons",
            format!("{task_name}: {}", result.bundle_id),
            duration_ms,
        )?;
    } else {
        logging::log_warning(
            "App Icons",
            format!("{task_name} failed: {}", result.bundle_id),
            result.technical_details.clone(),
        )?;
    }

    Ok(result)
}

fn join_details<const N: usize>(parts: [Option<String>; N]) -> Option<String> {
    let joined = parts
        .into_iter()
        .flatten()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");

    if joined.is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn value_to_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| {
        value
            .as_unsigned_integer()
            .or_else(|| {
                value
                    .as_signed_integer()
                    .and_then(|value| u64::try_from(value).ok())
            })
            .or_else(|| value.as_string()?.trim().parse::<u64>().ok())
    })
}

#[cfg(test)]
mod tests {
    use plist::{Dictionary, Value};

    use super::*;

    #[test]
    fn parses_initial_xml_apps_without_dynamic_disk_usage() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
  <dict>
    <key>CFBundleIdentifier</key><string>com.example.app</string>
    <key>CFBundleDisplayName</key><string>Example</string>
    <key>CFBundleShortVersionString</key><string>1.2.3</string>
    <key>StaticDiskUsage</key><integer>400</integer>
    <key>DynamicDiskUsage</key><integer>84</integer>
  </dict>
</array>
</plist>"#;

        let apps = parse_apps_from_plist(xml).expect("plist should parse");

        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].bundle_id, "com.example.app");
        assert_eq!(apps[0].name, "Example");
        assert_eq!(apps[0].version.as_deref(), Some("1.2.3"));
        assert_eq!(apps[0].static_disk_usage_bytes, Some(400));
        assert_eq!(apps[0].dynamic_disk_usage_bytes, None);
        assert_eq!(apps[0].total_disk_usage_bytes, None);
        assert_eq!(apps[0].data_size_status, AppDataSizeStatus::NotLoaded);
    }

    #[test]
    fn initial_scan_never_requests_dynamic_disk_usage() {
        let args = initial_scan_args(Some("device-id"));

        assert!(
            args.windows(2)
                .any(|pair| pair == ["-a", "StaticDiskUsage"])
        );
        assert!(!args.iter().any(|arg| arg == "DynamicDiskUsage"));
        assert!(args.windows(2).any(|pair| pair == ["-u", "device-id"]));
    }

    #[test]
    fn converts_disk_usage_values_safely() {
        let mut dictionary = Dictionary::new();
        dictionary.insert("unsigned".to_string(), Value::Integer(42u64.into()));
        dictionary.insert("signed".to_string(), Value::Integer(64i64.into()));
        dictionary.insert("string".to_string(), Value::String("128".to_string()));
        dictionary.insert("negative".to_string(), Value::Integer((-1i64).into()));

        assert_eq!(value_to_u64(dictionary.get("unsigned")), Some(42));
        assert_eq!(value_to_u64(dictionary.get("signed")), Some(64));
        assert_eq!(value_to_u64(dictionary.get("string")), Some(128));
        assert_eq!(value_to_u64(dictionary.get("negative")), None);
    }

    #[test]
    fn joins_non_empty_technical_details() {
        let details = join_details([
            Some("cache invalid".to_string()),
            Some(String::new()),
            Some("helper failed".to_string()),
        ]);

        assert_eq!(details.as_deref(), Some("cache invalid\n\nhelper failed"));
    }
}
