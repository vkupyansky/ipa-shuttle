use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
    process::Command,
    sync::Mutex,
};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    errors::AppError,
    models::{LogEntry, LogLevel, ProcessOutput},
};

const APP_DIR_NAME: &str = "IPA Shuttle";
const LOG_FILE: &str = "app.log";
const MAX_VISIBLE_LOG_ENTRIES: usize = 200;
const LOG_RETENTION_DAYS: i64 = 7;
const MAX_LOG_FILE_BYTES: u64 = 5 * 1024 * 1024;
const ROTATED_LOG_FILES: usize = 3;
static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InternalLogEntry {
    timestamp: String,
    level: LogLevel,
    task_name: String,
    message: String,
    duration_ms: Option<u128>,
    technical_details: Option<String>,
}

pub fn log_dir() -> Result<PathBuf, AppError> {
    dirs::home_dir()
        .map(|home| home.join("Library").join("Logs").join(APP_DIR_NAME))
        .ok_or_else(|| AppError::storage("Unable to resolve home Library/Logs directory"))
}

fn log_path() -> Result<PathBuf, AppError> {
    Ok(log_dir()?.join(LOG_FILE))
}

fn rotated_log_path(index: usize) -> Result<PathBuf, AppError> {
    Ok(log_dir()?.join(format!("{LOG_FILE}.{index}")))
}

pub fn log_info(task_name: impl Into<String>, message: impl Into<String>) -> Result<(), AppError> {
    log_event(LogLevel::Info, task_name, message, None, None)
}

pub fn log_info_with_details(
    task_name: impl Into<String>,
    message: impl Into<String>,
    technical_details: String,
) -> Result<(), AppError> {
    log_event(
        LogLevel::Info,
        task_name,
        message,
        None,
        Some(technical_details),
    )
}

pub fn log_success(
    task_name: impl Into<String>,
    message: impl Into<String>,
    duration_ms: Option<u128>,
) -> Result<(), AppError> {
    log_event(LogLevel::Success, task_name, message, duration_ms, None)
}

pub fn log_warning(
    task_name: impl Into<String>,
    message: impl Into<String>,
    technical_details: Option<String>,
) -> Result<(), AppError> {
    log_event(
        LogLevel::Warning,
        task_name,
        message,
        None,
        technical_details,
    )
}

pub fn log_process(
    task_name: impl Into<String>,
    command: impl Into<String>,
    output: &ProcessOutput,
    user_message: impl Into<String>,
    duration_ms: Option<u128>,
) -> Result<(), AppError> {
    let level = if output.success {
        LogLevel::Success
    } else {
        LogLevel::Error
    };
    log_process_with_level(level, task_name, command, output, user_message, duration_ms)
}

pub fn log_process_with_level(
    level: LogLevel,
    task_name: impl Into<String>,
    command: impl Into<String>,
    output: &ProcessOutput,
    user_message: impl Into<String>,
    duration_ms: Option<u128>,
) -> Result<(), AppError> {
    let details = process_details(command.into(), output);
    log_event(level, task_name, user_message, duration_ms, Some(details))
}

pub fn log_event(
    level: LogLevel,
    task_name: impl Into<String>,
    message: impl Into<String>,
    duration_ms: Option<u128>,
    technical_details: Option<String>,
) -> Result<(), AppError> {
    write_internal(InternalLogEntry {
        timestamp: Utc::now().to_rfc3339(),
        level,
        task_name: task_name.into(),
        message: message.into(),
        duration_ms,
        technical_details: technical_details.map(|details| redact_secrets(&details)),
    })
}

fn write_internal(entry: InternalLogEntry) -> Result<(), AppError> {
    let _guard = LOG_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::storage("Activity log writer lock poisoned"))?;
    crate::storage::ensure_private_dir(&log_dir()?)?;
    prune_expired_logs_locked()?;
    rotate_logs_locked()?;
    let path = log_path()?;
    let encoded = serde_json::to_string(&entry)
        .map_err(|err| AppError::storage(format!("Failed to encode log entry: {err}")))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&path)
        .map_err(|err| AppError::storage(format!("Failed to open {}: {err}", path.display())))?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|err| AppError::storage(format!("Failed to secure {}: {err}", path.display())))?;
    writeln!(file, "{encoded}")
        .map_err(|err| AppError::storage(format!("Failed to write {}: {err}", path.display())))
}

#[tauri::command]
pub async fn write_activity_event(
    level: String,
    task_name: String,
    message: String,
    technical_details: Option<String>,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let level = parse_level(&level);
        log_event(level, task_name, message, None, technical_details)
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join log writer: {err}")))?
}

#[tauri::command]
pub async fn read_activity_log() -> Result<Vec<LogEntry>, AppError> {
    tauri::async_runtime::spawn_blocking(read_activity_log_sync)
        .await
        .map_err(|err| AppError::storage(format!("Failed to join log reader: {err}")))?
}

#[tauri::command]
pub async fn read_activity_diagnostics() -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(read_activity_diagnostics_sync)
        .await
        .map_err(|err| AppError::storage(format!("Failed to join diagnostics reader: {err}")))?
}

#[tauri::command]
pub async fn clear_activity_logs() -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(clear_activity_logs_sync)
        .await
        .map_err(|err| AppError::storage(format!("Failed to join log clearer: {err}")))?
}

#[tauri::command]
pub async fn open_logs_folder() -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(open_logs_folder_sync)
        .await
        .map_err(|err| AppError::storage(format!("Failed to join logs folder opener: {err}")))?
}

fn read_activity_log_sync() -> Result<Vec<LogEntry>, AppError> {
    let _guard = LOG_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::storage("Activity log writer lock poisoned"))?;
    read_activity_log_locked()
}

fn read_activity_log_locked() -> Result<Vec<LogEntry>, AppError> {
    let cutoff = Utc::now() - Duration::days(LOG_RETENTION_DAYS);
    let mut entries = read_internal_log_entries()?
        .into_iter()
        .filter(|entry| entry_is_new_enough(&entry.timestamp, cutoff))
        .map(normalize_log_entry)
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
    if entries.len() > MAX_VISIBLE_LOG_ENTRIES {
        entries = entries.split_off(entries.len() - MAX_VISIBLE_LOG_ENTRIES);
    }

    Ok(entries)
}

fn read_activity_diagnostics_sync() -> Result<String, AppError> {
    let entries = read_activity_log_sync()?;
    let mut diagnostics = vec![
        "IPA Shuttle diagnostics".to_string(),
        format!("generatedAt: {}", Utc::now().to_rfc3339()),
        format!("retentionDays: {LOG_RETENTION_DAYS}"),
        format!("visibleEvents: {}", entries.len()),
        "logLocation: ~/Library/Logs/IPA Shuttle".to_string(),
        "appDataLocation: ~/Library/Application Support/IPA Shuttle".to_string(),
        format!("os: {}", std::env::consts::OS),
        format!("arch: {}", std::env::consts::ARCH),
    ];

    diagnostics.push("activityEvents:".to_string());
    diagnostics.extend(entries.into_iter().map(|entry| {
        [
            format!(
                "[{}] {} {}: {}",
                entry.timestamp,
                format!("{:?}", entry.level).to_uppercase(),
                entry.task_name,
                entry.message
            ),
            entry
                .duration_ms
                .map(|duration| format!("durationMs: {duration}"))
                .unwrap_or_default(),
            entry
                .technical_details
                .map(|details| format!("details:\n{details}"))
                .unwrap_or_default(),
        ]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
    }));

    Ok(diagnostics.join("\n\n"))
}

fn clear_activity_logs_sync() -> Result<(), AppError> {
    let _guard = LOG_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::storage("Activity log writer lock poisoned"))?;
    crate::storage::ensure_private_dir(&log_dir()?)?;
    remove_log_files(&log_file_paths()?)
}

fn remove_log_files(paths: &[PathBuf]) -> Result<(), AppError> {
    for path in paths {
        if path.exists() {
            fs::remove_file(path).map_err(|err| {
                AppError::storage(format!("Failed to remove {}: {err}", path.display()))
            })?;
        }
    }
    Ok(())
}

fn open_logs_folder_sync() -> Result<(), AppError> {
    crate::storage::ensure_private_dir(&log_dir()?)?;
    let dir = log_dir()?;
    Command::new("/usr/bin/open")
        .arg(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|err| {
            AppError::process_failed(
                "Could not open the logs folder.",
                format!("Failed to open {}: {err}", dir.display()),
            )
        })?;
    Ok(())
}

fn read_internal_log_entries() -> Result<Vec<InternalLogEntry>, AppError> {
    let mut entries = Vec::new();
    for path in log_file_paths()?.into_iter().rev() {
        if !path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|err| {
            AppError::storage(format!("Failed to read {}: {err}", path.display()))
        })?;
        entries.extend(
            raw.lines()
                .filter_map(|line| serde_json::from_str::<InternalLogEntry>(line).ok()),
        );
    }
    Ok(entries)
}

fn log_file_paths() -> Result<Vec<PathBuf>, AppError> {
    let mut paths = vec![log_path()?];
    for index in 1..=ROTATED_LOG_FILES {
        paths.push(rotated_log_path(index)?);
    }
    Ok(paths)
}

fn rotate_logs_locked() -> Result<(), AppError> {
    let path = log_path()?;
    if !path.exists() || fs::metadata(&path)?.len() < MAX_LOG_FILE_BYTES {
        return Ok(());
    }

    let oldest = rotated_log_path(ROTATED_LOG_FILES)?;
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }
    for index in (1..ROTATED_LOG_FILES).rev() {
        let current = rotated_log_path(index)?;
        if current.exists() {
            fs::rename(current, rotated_log_path(index + 1)?)?;
        }
    }
    fs::rename(path, rotated_log_path(1)?)?;
    Ok(())
}

fn prune_expired_logs_locked() -> Result<(), AppError> {
    let cutoff = Utc::now() - Duration::days(LOG_RETENTION_DAYS);
    for path in log_file_paths()? {
        if !path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&path)?;
        let kept = raw
            .lines()
            .filter(|line| {
                serde_json::from_str::<InternalLogEntry>(line)
                    .ok()
                    .is_some_and(|entry| entry_is_new_enough(&entry.timestamp, cutoff))
            })
            .collect::<Vec<_>>();

        if kept.is_empty() {
            fs::remove_file(&path)?;
        } else if kept.len() != raw.lines().count() {
            crate::storage::atomic_write_private(
                &path,
                format!("{}\n", kept.join("\n")).as_bytes(),
            )?;
        }
    }
    Ok(())
}

fn entry_is_new_enough(timestamp: &str, cutoff: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(timestamp)
        .map(|timestamp| timestamp.with_timezone(&Utc) >= cutoff)
        .unwrap_or(false)
}

fn normalize_log_entry(entry: InternalLogEntry) -> LogEntry {
    LogEntry {
        timestamp: entry.timestamp,
        level: entry.level,
        task_name: entry.task_name,
        message: entry.message,
        duration_ms: entry.duration_ms,
        technical_details: entry
            .technical_details
            .map(|details| redact_secrets(&details)),
    }
}

fn process_details(command: String, output: &ProcessOutput) -> String {
    [
        Some(format!("command: {command}")),
        output.exit_code.map(|value| format!("exitCode: {value}")),
        output.timed_out.then_some("timedOut: true".to_string()),
        Some(format!("stdout:\n{}", output.stdout)),
        Some(format!("stderr:\n{}", output.stderr)),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join("\n\n")
}

fn redact_secrets(value: &str) -> String {
    let home = dirs::home_dir().map(|path| path.to_string_lossy().to_string());
    value
        .lines()
        .map(|line| {
            let lowered = line.to_lowercase();
            if is_safe_auth_diagnostic(&lowered) {
                line.to_string()
            } else if lowered.contains("password")
                || lowered.contains("verification")
                || lowered.contains("auth code")
                || lowered.contains("token")
                || lowered.contains("cookie")
                || lowered.contains("session")
                || lowered.contains("authorization")
                || lowered.contains("x-dsid")
                || lowered.contains("x-token")
                || lowered.contains("phone")
                || lowered.contains("internationalmobileequipmentidentity")
                || lowered.contains("internationalmobilesubscriberidentity")
                || lowered.contains("integratedcircuitcardidentity")
                || lowered.contains("mobileequipmentidentifier")
                || lowered.contains("serialnumber")
                || lowered.contains("basebandserialnumber")
                || lowered.contains("bluetoothaddress")
                || lowered.contains("ethernetaddress")
                || lowered.contains("wifiaddress")
                || lowered.contains("uniquechipid")
                || lowered.contains("dieid")
                || lowered.contains("pkhash")
            {
                "<redacted sensitive output>".to_string()
            } else {
                home.as_deref()
                    .map(|home| line.replace(home, "~"))
                    .unwrap_or_else(|| line.to_string())
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_safe_auth_diagnostic(line: &str) -> bool {
    [
        "visiblestate:",
        "backendstate:",
        "hasinmemorysession:",
        "hasusablesession:",
        "sessionsource:",
        "downloaddecision:",
    ]
    .iter()
    .any(|prefix| line.starts_with(prefix))
}

fn parse_level(value: &str) -> LogLevel {
    match value {
        "success" => LogLevel::Success,
        "warning" => LogLevel::Warning,
        "error" => LogLevel::Error,
        _ => LogLevel::Info,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn redacts_password_codes_tokens_cookies_and_session_json() {
        let raw = [
            "email: person@example.com",
            "password: secret",
            "verification code: 123456",
            "token: abc",
            "cookie: session=abc",
            "session: {\"passwordToken\":\"abc\"}",
        ]
        .join("\n");

        let redacted = redact_secrets(&raw);

        assert!(redacted.contains("email: person@example.com"));
        assert!(!redacted.contains("secret"));
        assert!(!redacted.contains("123456"));
        assert!(!redacted.contains("passwordToken"));
        assert!(redacted.contains("<redacted sensitive output>"));
    }

    #[test]
    fn keeps_safe_auth_decision_diagnostics_without_secrets() {
        let details = [
            "visibleState: signedIn",
            "backendState: sessionExpired",
            "hasInMemorySession: true",
            "hasUsableSession: false",
            "sessionSource: memory",
            "downloadDecision: blocked",
        ]
        .join("\n");

        assert_eq!(redact_secrets(&details), details);
    }

    #[test]
    fn parses_unknown_level_as_info() {
        assert!(matches!(parse_level("warning"), LogLevel::Warning));
        assert!(matches!(parse_level("unknown"), LogLevel::Info));
    }

    #[test]
    fn removes_current_and_rotated_log_files() {
        let dir = tempdir().expect("create temp log directory");
        let paths = (0..=ROTATED_LOG_FILES)
            .map(|index| {
                let name = if index == 0 {
                    LOG_FILE.to_string()
                } else {
                    format!("{LOG_FILE}.{index}")
                };
                let path = dir.path().join(name);
                fs::write(&path, "test log\n").expect("write temp log file");
                path
            })
            .collect::<Vec<_>>();

        remove_log_files(&paths).expect("remove all log files");

        assert!(paths.iter().all(|path| !path.exists()));
    }
}
