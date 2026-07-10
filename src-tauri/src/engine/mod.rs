use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager};

use crate::{
    errors::AppError,
    logging,
    models::{EngineStatus, ProcessOutput},
};

pub mod process;

const RESOURCE_BIN_DIR: &str = "resources/bin";
const REQUIRED_ENGINES: &[&str] = &[
    "apple-auth-engine",
    "idevice_id",
    "ideviceinfo",
    "ideviceinstaller",
];
const ALLOWED_ENGINES: &[&str] = &[
    "apple-auth-engine",
    "idevice_id",
    "ideviceinfo",
    "ideviceinstaller",
    "ipashuttle-icons",
];
const STANDARD_ENGINE_TIMEOUT: Duration = Duration::from_secs(120);
const LONG_ENGINE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[tauri::command]
pub async fn get_engine_status(app: AppHandle) -> Result<EngineStatus, AppError> {
    tauri::async_runtime::spawn_blocking(move || engine_status_sync(&app))
        .await
        .map_err(|err| AppError::storage(format!("Failed to join engine status check: {err}")))?
}

pub fn engine_status_sync(app: &AppHandle) -> Result<EngineStatus, AppError> {
    let missing = REQUIRED_ENGINES
        .iter()
        .filter_map(|name| match resolve_engine_path(app, name) {
            Ok(_) => None,
            Err(_) => Some((*name).to_string()),
        })
        .collect::<Vec<_>>();

    let ready = missing.is_empty();
    Ok(EngineStatus { ready, missing })
}

pub fn ensure_engines(app: &AppHandle) -> Result<(), AppError> {
    let status = engine_status_sync(app)?;
    if status.ready {
        Ok(())
    } else {
        Err(AppError::engine_missing(&status.missing))
    }
}

pub fn run_engine(
    app: &AppHandle,
    engine_name: &str,
    args: &[String],
    redacted_args: &[String],
    user_message: &str,
) -> Result<ProcessOutput, AppError> {
    run_engine_with_env(app, engine_name, args, redacted_args, user_message, &[])
}

pub fn run_engine_with_env(
    app: &AppHandle,
    engine_name: &str,
    args: &[String],
    redacted_args: &[String],
    user_message: &str,
    envs: &[(&str, &str)],
) -> Result<ProcessOutput, AppError> {
    let started_at = Instant::now();
    let engine_path = resolve_engine_path(app, engine_name)?;
    let command_for_log = format!(
        "{} {}",
        display_engine_name(engine_name),
        redacted_args.join(" ")
    );

    let runner = process::SystemProcessRunner;
    let process_output = process::ProcessRunner::run(
        &runner,
        &process::ProcessSpec {
            program: engine_path.clone(),
            args: args.to_vec(),
            envs: envs
                .iter()
                .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                .collect(),
            timeout: timeout_for(engine_name, args),
            cancellation: None,
        },
    )
    .map_err(|err| {
        AppError::process_failed(
            "Required internal engine could not be started.",
            format!("Failed to run {}: {err}", engine_path.display()),
        )
    })?;

    logging::log_process(
        display_task_name(engine_name),
        command_for_log,
        &process_output,
        user_message,
        Some(started_at.elapsed().as_millis()),
    )?;
    Ok(process_output)
}

pub fn run_engine_with_env_quiet(
    app: &AppHandle,
    engine_name: &str,
    args: &[String],
    envs: &[(&str, &str)],
) -> Result<ProcessOutput, AppError> {
    let engine_path = resolve_engine_path(app, engine_name)?;
    let runner = process::SystemProcessRunner;
    process::ProcessRunner::run(
        &runner,
        &process::ProcessSpec {
            program: engine_path.clone(),
            args: args.to_vec(),
            envs: envs
                .iter()
                .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
                .collect(),
            timeout: timeout_for(engine_name, args),
            cancellation: None,
        },
    )
    .map_err(|err| {
        AppError::process_failed(
            "Required internal engine could not be started.",
            format!("Failed to run {}: {err}", engine_path.display()),
        )
    })
}

pub fn run_engine_with_timeout(
    app: &AppHandle,
    engine_name: &str,
    args: &[String],
    redacted_args: &[String],
    timeout: Duration,
) -> Result<ProcessOutput, AppError> {
    let engine_path = resolve_engine_path(app, engine_name)?;
    let runner = process::SystemProcessRunner;
    let output = process::ProcessRunner::run(
        &runner,
        &process::ProcessSpec {
            program: engine_path,
            args: args.to_vec(),
            envs: Vec::new(),
            timeout,
            cancellation: None,
        },
    )?;

    if output.timed_out {
        let command_for_log = format!(
            "{} {}",
            display_engine_name(engine_name),
            redacted_args.join(" ")
        );
        logging::log_process_with_level(
            crate::models::LogLevel::Warning,
            display_task_name(engine_name),
            command_for_log,
            &output,
            "Internal engine timed out",
            Some(timeout.as_millis()),
        )?;
    }

    Ok(output)
}

pub fn run_engine_cancellable_quiet(
    app: &AppHandle,
    engine_name: &str,
    args: &[String],
    cancellation: Arc<AtomicBool>,
    timeout: Duration,
) -> Result<ProcessOutput, AppError> {
    let engine_path = resolve_engine_path(app, engine_name)?;
    let runner = process::SystemProcessRunner;
    process::ProcessRunner::run(
        &runner,
        &process::ProcessSpec {
            program: engine_path,
            args: args.to_vec(),
            envs: Vec::new(),
            timeout,
            cancellation: Some(cancellation),
        },
    )
    .map_err(|err| {
        AppError::process_failed(
            "Required internal engine could not be started.",
            format!("Failed to run {engine_name}: {err}"),
        )
    })
}

fn timeout_for(engine_name: &str, args: &[String]) -> Duration {
    if engine_name == "apple-auth-engine"
        || (engine_name == "ideviceinstaller" && args.iter().any(|arg| arg == "install"))
    {
        LONG_ENGINE_TIMEOUT
    } else {
        STANDARD_ENGINE_TIMEOUT
    }
}

pub fn engine_available(app: &AppHandle, engine_name: &str) -> bool {
    resolve_engine_path(app, engine_name).is_ok()
}

pub(crate) fn resolve_engine_path(app: &AppHandle, engine_name: &str) -> Result<PathBuf, AppError> {
    if !ALLOWED_ENGINES.contains(&engine_name) {
        return Err(AppError::engine_missing(&[
            "unknown internal engine".to_string()
        ]));
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|err| AppError::engine_missing(&[format!("resource directory ({err})")]))?;
    let bin_dir = resource_dir.join(RESOURCE_BIN_DIR);
    let path = bin_dir.join(engine_name);

    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| AppError::engine_missing(&[engine_name.to_string()]))?;
    if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return Err(AppError::engine_missing(&[engine_name.to_string()]));
    }

    let canonical_bin_dir = fs::canonicalize(bin_dir)
        .map_err(|_| AppError::engine_missing(&[engine_name.to_string()]))?;
    let canonical_path =
        fs::canonicalize(path).map_err(|_| AppError::engine_missing(&[engine_name.to_string()]))?;
    canonical_path
        .starts_with(canonical_bin_dir)
        .then_some(canonical_path)
        .ok_or_else(|| AppError::engine_missing(&[engine_name.to_string()]))
}

fn display_engine_name(engine_name: &str) -> &str {
    match engine_name {
        "apple-auth-engine" => "apple-auth-engine",
        "ipashuttle-icons" => "app-icon-engine",
        "idevice_id" | "ideviceinfo" | "ideviceinstaller" => "iphone-engine",
        _ => "internal-engine",
    }
}

fn display_task_name(engine_name: &str) -> &str {
    match engine_name {
        "apple-auth-engine" => "Apple ID",
        "ipashuttle-icons" => "App Icons",
        "idevice_id" | "ideviceinfo" | "ideviceinstaller" => "iPhone",
        _ => "Internal Engine",
    }
}

pub fn combined_output(output: &ProcessOutput) -> String {
    format!("{}\n{}", output.stdout, output.stderr)
}

pub fn classify_device_error(output: &ProcessOutput) -> Option<AppError> {
    let combined = combined_output(output).to_lowercase();

    if combined.contains("lockdownd")
        || combined.contains("pair")
        || combined.contains("trust")
        || combined.contains("invalid host id")
    {
        return Some(AppError::not_trusted(combined));
    }

    if combined.contains("no device") || combined.contains("could not find device") {
        return Some(AppError::no_device(combined));
    }

    None
}
