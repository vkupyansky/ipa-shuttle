use std::{
    io::{Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, State};
use zeroize::{Zeroize, Zeroizing};

use crate::{
    auth_store::{AuthSessionManager, LoadSavedSessionResult, TempSessionFile},
    engine,
    errors::AppError,
    logging,
    models::{AuthFlowResult, AuthFlowState, AuthSessionState, AuthState, ProcessOutput},
};

const LOGIN_PROMPT_TIMEOUT: Duration = Duration::from_secs(90);
const LOGIN_COMPLETE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Default)]
pub struct AppleLoginState {
    session: Arc<Mutex<Option<LoginSession>>>,
}

struct LoginSession {
    child: Child,
    stdin: Option<ChildStdin>,
    output: SharedOutput,
    temp_session: TempSessionFile,
    remember: bool,
    operation: u64,
}

impl Drop for LoginSession {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Clone, Default)]
struct SharedOutput {
    stdout: Arc<Mutex<String>>,
    stderr: Arc<Mutex<String>>,
}

#[tauri::command]
pub async fn get_apple_auth_status(
    app: AppHandle,
    sessions: State<'_, AuthSessionManager>,
) -> Result<AuthSessionState, AppError> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || get_apple_auth_status_sync(&app, &sessions))
        .await
        .map_err(|err| AppError::storage(format!("Failed to join auth status lookup: {err}")))?
}

#[tauri::command]
pub async fn start_apple_login(
    app: AppHandle,
    state: State<'_, AppleLoginState>,
    sessions: State<'_, AuthSessionManager>,
    email: String,
    password: String,
    remember: bool,
) -> Result<AuthFlowResult, AppError> {
    let state = state.inner().clone();
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start_apple_login_sync(&app, &state, &sessions, email, password, remember)
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join Apple ID login: {err}")))?
}

#[tauri::command]
pub async fn submit_apple_verification_code(
    app: AppHandle,
    state: State<'_, AppleLoginState>,
    sessions: State<'_, AuthSessionManager>,
    code: String,
) -> Result<AuthFlowResult, AppError> {
    let state = state.inner().clone();
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        submit_apple_verification_code_sync(&app, &state, &sessions, code)
    })
    .await
    .map_err(|err| AppError::storage(format!("Failed to join Apple ID verification: {err}")))?
}

#[tauri::command]
pub async fn cancel_apple_login(
    state: State<'_, AppleLoginState>,
    sessions: State<'_, AuthSessionManager>,
) -> Result<AuthFlowResult, AppError> {
    let state = state.inner().clone();
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || cancel_apple_login_sync(&state, &sessions))
        .await
        .map_err(|err| AppError::storage(format!("Failed to join Apple ID cancellation: {err}")))?
}

#[tauri::command]
pub async fn use_saved_apple_session(
    app: AppHandle,
    sessions: State<'_, AuthSessionManager>,
) -> Result<AuthSessionState, AppError> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || use_saved_apple_session_sync(&app, &sessions))
        .await
        .map_err(|err| {
            AppError::storage(format!(
                "Failed to join saved Apple ID session unlock: {err}"
            ))
        })?
}

#[tauri::command]
pub async fn forget_apple_session(
    sessions: State<'_, AuthSessionManager>,
) -> Result<AuthSessionState, AppError> {
    let sessions = sessions.inner().clone();
    tauri::async_runtime::spawn_blocking(move || forget_apple_session_sync(&sessions))
        .await
        .map_err(|err| {
            AppError::storage(format!("Failed to join Apple ID session removal: {err}"))
        })?
}

pub fn get_apple_auth_status_sync(
    app: &AppHandle,
    sessions: &AuthSessionManager,
) -> Result<AuthSessionState, AppError> {
    engine::ensure_engines(app)?;
    logging::log_info("Apple ID", "Checking Apple ID status")?;
    let session_state = sessions.state()?;
    match session_state.state {
        AuthState::SignedIn => {
            logging::log_success("Apple ID", "Apple ID signed in", None)?;
            Ok(AuthSessionState {
                state: AuthState::SignedIn,
                account: session_state.session.map(|session| session.email),
            })
        }
        AuthState::SavedSessionAvailable => {
            logging::log_info("Apple ID", "Saved Apple ID session available")?;
            Ok(AuthSessionState {
                state: AuthState::SavedSessionAvailable,
                account: None,
            })
        }
        AuthState::SessionExpired => {
            logging::log_warning("Apple ID", "Apple ID session expired", None)?;
            Ok(AuthSessionState {
                state: AuthState::SessionExpired,
                account: session_state.session.map(|session| session.email),
            })
        }
        _ => {
            logging::log_warning("Apple ID", "Apple ID not signed in", None)?;
            Ok(AuthSessionState {
                state: AuthState::NotSignedIn,
                account: None,
            })
        }
    }
}

fn use_saved_apple_session_sync(
    app: &AppHandle,
    sessions: &AuthSessionManager,
) -> Result<AuthSessionState, AppError> {
    engine::ensure_engines(app)?;
    logging::log_info("Apple ID", "Using saved Apple ID session")?;
    let session = match sessions.load_saved_interactive()? {
        LoadSavedSessionResult::Loaded(session) => session,
        outcome => {
            let expired = matches!(outcome, LoadSavedSessionResult::Expired);
            let interaction_required =
                matches!(outcome, LoadSavedSessionResult::InteractionRequired);
            logging::log_warning(
                "Apple ID",
                if expired {
                    "Apple ID session expired"
                } else if interaction_required {
                    "Saved Apple ID session locked"
                } else {
                    "Apple ID not signed in"
                },
                None,
            )?;
            return Ok(AuthSessionState {
                state: if expired {
                    AuthState::SessionExpired
                } else if interaction_required {
                    AuthState::SavedSessionLocked
                } else {
                    AuthState::NotSignedIn
                },
                account: None,
            });
        }
    };
    let session_state = sessions.state()?;
    Ok(AuthSessionState {
        state: session_state.state,
        account: Some(session.email),
    })
}

fn forget_apple_session_sync(sessions: &AuthSessionManager) -> Result<AuthSessionState, AppError> {
    sessions.forget()?;
    logging::log_success("Apple ID", "Forgot saved Apple ID session", None)?;
    Ok(AuthSessionState {
        state: AuthState::NotSignedIn,
        account: None,
    })
}

fn start_apple_login_sync(
    app: &AppHandle,
    state: &AppleLoginState,
    sessions: &AuthSessionManager,
    email: String,
    password: String,
    remember: bool,
) -> Result<AuthFlowResult, AppError> {
    engine::ensure_engines(app)?;
    cancel_existing_session(state)?;
    let operation = sessions.begin_auth_operation()?;

    let trimmed_email = email.trim().to_string();
    let password = Zeroizing::new(password);
    if trimmed_email.is_empty() || password.is_empty() {
        return Ok(auth_error("AUTH_CREDENTIALS_REQUIRED"));
    }

    let engine_path = engine::resolve_engine_path(app, "apple-auth-engine")?;
    let temp_session = TempSessionFile::new()?;
    let session_path = temp_session.path_string();

    let args = vec![
        "auth".to_string(),
        "login".to_string(),
        "--format".to_string(),
        "json".to_string(),
        "--email".to_string(),
        trimmed_email.clone(),
    ];
    let redacted_command = "apple-auth-engine auth login --format json --email <apple-id>";
    logging::log_info("Apple ID", "Started Apple ID sign-in")?;

    let mut command = Command::new(&engine_path);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    engine::process::configure_command_environment(
        &mut command,
        &[
            ("IPASHUTTLE_AUTH_SESSION_FILE".to_string(), session_path),
            ("IPASHUTTLE_PASSWORD_STDIN".to_string(), "1".to_string()),
        ],
    );
    let mut child = command.spawn().map_err(|err| {
        AppError::process_failed(
            "Apple ID sign-in could not be started.",
            format!("Failed to run {}: {err}", engine_path.display()),
        )
    })?;

    let mut stdin = child.stdin.take();
    if let Some(stdin) = stdin.as_mut() {
        stdin
            .write_all(password.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|err| {
                AppError::process_failed(
                    "Apple ID sign-in could not be started.",
                    format!("Failed to send Apple ID password to sign-in engine: {err}"),
                )
            })?;
    }
    let output = SharedOutput::default();
    spawn_reader(child.stdout.take(), Arc::clone(&output.stdout));
    spawn_reader(child.stderr.take(), Arc::clone(&output.stderr));

    let mut session = LoginSession {
        child,
        stdin,
        output,
        temp_session,
        remember,
        operation,
    };

    let result = wait_for_prompt_or_exit(
        app,
        sessions,
        &mut session,
        LOGIN_PROMPT_TIMEOUT,
        &[trimmed_email.as_str(), password.as_str()],
        redacted_command,
    )?;

    match result.state {
        AuthFlowState::VerificationRequired => {
            let mut guard = state
                .session
                .lock()
                .map_err(|_| AppError::storage("Apple login state lock poisoned"))?;
            *guard = Some(session);
            Ok(result)
        }
        _ => Ok(result),
    }
}

fn submit_apple_verification_code_sync(
    app: &AppHandle,
    state: &AppleLoginState,
    sessions: &AuthSessionManager,
    code: String,
) -> Result<AuthFlowResult, AppError> {
    let clean_code = Zeroizing::new(code.trim().replace(' ', ""));
    if clean_code.len() != 6
        || !clean_code
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Ok(auth_error("AUTH_CODE_REQUIRED"));
    }

    let mut session = {
        let mut guard = state
            .session
            .lock()
            .map_err(|_| AppError::storage("Apple login state lock poisoned"))?;
        guard
            .take()
            .ok_or_else(|| AppError::auth_required("No active Apple ID sign-in session."))?
    };

    if let Some(stdin) = session.stdin.as_mut() {
        stdin
            .write_all(clean_code.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|err| {
                AppError::process_failed(
                    "Could not submit the verification code.",
                    format!("Failed to write verification code to Apple login process: {err}"),
                )
            })?;
    } else {
        return Ok(auth_error("AUTH_SESSION_EXPIRED"));
    }

    let result = wait_for_login_exit(
        app,
        sessions,
        &mut session,
        LOGIN_COMPLETE_TIMEOUT,
        &[clean_code.as_str()],
        "apple-auth-engine auth login <verification-code-redacted>",
    )?;

    if result.state == AuthFlowState::VerificationRequired {
        let mut guard = state
            .session
            .lock()
            .map_err(|_| AppError::storage("Apple login state lock poisoned"))?;
        *guard = Some(session);
    }

    Ok(result)
}

fn cancel_apple_login_sync(
    state: &AppleLoginState,
    sessions: &AuthSessionManager,
) -> Result<AuthFlowResult, AppError> {
    cancel_existing_session(state)?;
    sessions.cancel_auth_operations()?;
    logging::log_warning("Apple ID", "Cancelled Apple ID sign-in", None)?;
    Ok(AuthFlowResult {
        state: AuthFlowState::Error,
        signed_in: false,
        account: None,
        error_code: Some("AUTH_CANCELLED".to_string()),
    })
}

fn wait_for_prompt_or_exit(
    app: &AppHandle,
    sessions: &AuthSessionManager,
    session: &mut LoginSession,
    timeout: Duration,
    redactions: &[&str],
    redacted_command: &str,
) -> Result<AuthFlowResult, AppError> {
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        let combined = session.output.combined();
        if requires_verification(&combined) {
            log_session_output(redacted_command, session, redactions, true)?;
            return Ok(AuthFlowResult {
                state: AuthFlowState::VerificationRequired,
                signed_in: false,
                account: None,
                error_code: None,
            });
        }

        if let Some(status) = session.child.try_wait()? {
            let output = session
                .output
                .to_process_output(status.code(), status.success());
            log_redacted_process(
                redacted_command,
                &output,
                redactions,
                "Completed Apple ID sign-in",
            )?;
            return login_result_from_output(
                app,
                sessions,
                &output,
                Some(&session.temp_session),
                session.remember,
                session.operation,
            );
        }

        thread::sleep(Duration::from_millis(120));
    }

    let _ = session.child.kill();
    let _ = session.child.wait();
    Ok(auth_error("AUTH_NETWORK"))
}

fn wait_for_login_exit(
    app: &AppHandle,
    sessions: &AuthSessionManager,
    session: &mut LoginSession,
    timeout: Duration,
    redactions: &[&str],
    redacted_command: &str,
) -> Result<AuthFlowResult, AppError> {
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if let Some(status) = session.child.try_wait()? {
            thread::sleep(Duration::from_millis(100));
            let output = session
                .output
                .to_process_output(status.code(), status.success());
            log_redacted_process(
                redacted_command,
                &output,
                redactions,
                "Completed Apple ID verification",
            )?;
            return login_result_from_output(
                app,
                sessions,
                &output,
                Some(&session.temp_session),
                session.remember,
                session.operation,
            );
        }

        thread::sleep(Duration::from_millis(120));
    }

    let _ = session.child.kill();
    let _ = session.child.wait();
    Ok(auth_error("AUTH_CODE_EXPIRED"))
}

fn login_result_from_output(
    app: &AppHandle,
    sessions: &AuthSessionManager,
    output: &ProcessOutput,
    temp_session: Option<&TempSessionFile>,
    remember: bool,
    operation: u64,
) -> Result<AuthFlowResult, AppError> {
    let combined = engine::combined_output(output);
    if output.success || login_succeeded(&combined) {
        let temp_session = temp_session
            .ok_or_else(|| AppError::auth_required("Apple ID session was not returned."))?;
        let mut raw_session = temp_session.read_raw()?;
        let session_result = sessions.save_login_session(&raw_session, remember, operation);
        raw_session.zeroize();
        let session = session_result?;
        let status = get_apple_auth_status_sync(app, sessions)?;
        return Ok(AuthFlowResult {
            state: AuthFlowState::Success,
            signed_in: status.state == AuthState::SignedIn,
            account: status.account.or(Some(session.email)),
            error_code: None,
        });
    }

    if requires_verification(&combined) {
        return Ok(AuthFlowResult {
            state: AuthFlowState::VerificationRequired,
            signed_in: false,
            account: None,
            error_code: None,
        });
    }

    Ok(auth_error(classify_auth_error(&combined)))
}

fn cancel_existing_session(state: &AppleLoginState) -> Result<(), AppError> {
    let mut guard = state
        .session
        .lock()
        .map_err(|_| AppError::storage("Apple login state lock poisoned"))?;

    if let Some(mut session) = guard.take() {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }

    Ok(())
}

fn spawn_reader<R>(reader: Option<R>, target: Arc<Mutex<String>>)
where
    R: Read + Send + 'static,
{
    if let Some(mut reader) = reader {
        thread::spawn(move || {
            let mut buffer = [0_u8; 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        let chunk = String::from_utf8_lossy(&buffer[..count]).to_string();
                        if let Ok(mut value) = target.lock() {
                            value.push_str(&chunk);
                        }
                    }
                }
            }
        });
    }
}

fn log_session_output(
    redacted_command: &str,
    session: &LoginSession,
    redactions: &[&str],
    success: bool,
) -> Result<(), AppError> {
    let output = session.output.to_process_output(None, success);
    log_redacted_process(
        redacted_command,
        &output,
        redactions,
        "Apple ID sign-in needs verification",
    )
}

fn log_redacted_process(
    redacted_command: &str,
    output: &ProcessOutput,
    redactions: &[&str],
    message: &str,
) -> Result<(), AppError> {
    let redacted_output = ProcessOutput {
        stdout: redact_secrets(&output.stdout, redactions),
        stderr: redact_secrets(&output.stderr, redactions),
        exit_code: output.exit_code,
        success: output.success,
        timed_out: output.timed_out,
    };
    logging::log_process(
        "Apple ID",
        redacted_command,
        &redacted_output,
        message,
        None,
    )
}

fn redact_secrets(value: &str, redactions: &[&str]) -> String {
    let explicitly_redacted = redactions
        .iter()
        .fold(value.to_string(), |current, secret| {
            if secret.is_empty() {
                current
            } else {
                current.replace(secret, "<redacted>")
            }
        });

    explicitly_redacted
        .lines()
        .map(|line| {
            let lowered = line.to_lowercase();
            if lowered.contains("password")
                || lowered.contains("verification")
                || lowered.contains("auth code")
                || lowered.contains("token")
                || lowered.contains("cookie")
                || lowered.contains("session")
                || lowered.contains("dsid")
                || lowered.contains("authorization")
            {
                "<redacted sensitive output>".to_string()
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn requires_verification(output: &str) -> bool {
    let lowered = output.to_lowercase();
    lowered.contains("enter 2fa code")
        || lowered.contains("2fa code is required")
        || lowered.contains("auth code")
        || lowered.contains("verification code")
        || lowered.contains("two-factor")
}

fn login_succeeded(output: &str) -> bool {
    let lowered = output.to_lowercase();
    lowered.contains("\"success\":true") || lowered.contains("success=true")
}

fn classify_auth_error(output: &str) -> &'static str {
    let lowered = output.to_lowercase();

    if lowered.contains("invalid code")
        || lowered.contains("incorrect verification")
        || lowered.contains("auth code")
    {
        return "AUTH_CODE_INVALID";
    }

    if lowered.contains("expired") || lowered.contains("too many") {
        return "AUTH_CODE_EXPIRED";
    }

    if lowered.contains("locked") || lowered.contains("disabled") {
        return "AUTH_ACCOUNT_LOCKED";
    }

    if lowered.contains("password")
        || lowered.contains("unauthorized")
        || lowered.contains("invalid")
    {
        return "AUTH_WRONG_CREDENTIALS";
    }

    if lowered.contains("network")
        || lowered.contains("timed out")
        || lowered.contains("connection")
        || lowered.contains("failed to get bag")
    {
        return "AUTH_NETWORK";
    }

    "AUTH_FAILED"
}

fn auth_error(code: impl Into<String>) -> AuthFlowResult {
    AuthFlowResult {
        state: AuthFlowState::Error,
        signed_in: false,
        account: None,
        error_code: Some(code.into()),
    }
}

impl SharedOutput {
    fn combined(&self) -> String {
        format!("{}\n{}", self.read_stdout(), self.read_stderr())
    }

    fn to_process_output(&self, exit_code: Option<i32>, success: bool) -> ProcessOutput {
        ProcessOutput {
            stdout: self.read_stdout(),
            stderr: self.read_stderr(),
            exit_code,
            success,
            timed_out: false,
        }
    }

    fn read_stdout(&self) -> String {
        self.stdout
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    fn read_stderr(&self) -> String {
        self.stderr
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }
}
