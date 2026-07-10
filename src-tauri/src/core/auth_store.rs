use std::{
    fs::{self, OpenOptions},
    io::{Seek, SeekFrom, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use chrono::{DateTime, Utc};
use security_framework::passwords::{
    PasswordOptions, delete_generic_password, generic_password, set_generic_password_options,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::{errors::AppError, models::AuthState, storage};

pub const SESSION_SERVICE_V2: &str = "com.ipashuttle.apple-session.v2";
pub const SESSION_ACCOUNT_V2: &str = "active";
const SESSION_SCHEMA_VERSION: u32 = 2;
const SESSION_MARKER_V2_FILE: &str = "apple-session-v2.json";
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
const ERR_SEC_AUTH_FAILED: i32 = -25293;
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionValidity {
    Usable,
    Expired,
}

#[derive(Debug, Clone)]
struct CachedAuthSession {
    session: AppleAuthSession,
    validity: SessionValidity,
}

#[derive(Debug, Default)]
struct AuthRuntime {
    cached: Option<CachedAuthSession>,
    generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppleAuthSession {
    pub email: String,
    pub name: Option<String>,
    #[serde(rename = "passwordToken")]
    pub password_token: Option<String>,
    #[serde(rename = "directoryServicesIdentifier")]
    pub directory_services_identifier: Option<String>,
    #[serde(rename = "storeFront")]
    pub store_front: Option<String>,
    pub pod: Option<String>,
    pub cookies: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionEnvelope {
    pub schema_version: u32,
    pub account: String,
    pub saved_at: String,
    pub expires_at: Option<String>,
    pub session: AppleAuthSession,
}

#[derive(Debug, Clone)]
pub enum SessionStoreLoad {
    Found(Box<SessionEnvelope>),
    NotFound,
    InteractionRequired,
}

pub trait SessionStore: Send + Sync {
    fn load_interactive(&self) -> Result<SessionStoreLoad, AppError>;
    fn save(&self, envelope: &SessionEnvelope) -> Result<(), AppError>;
    fn delete(&self) -> Result<(), AppError>;
}

#[derive(Debug, Default)]
pub struct MacKeychainSessionStore;

impl SessionStore for MacKeychainSessionStore {
    fn load_interactive(&self) -> Result<SessionStoreLoad, AppError> {
        let options = PasswordOptions::new_generic_password(SESSION_SERVICE_V2, SESSION_ACCOUNT_V2);
        match generic_password(options) {
            Ok(mut raw) => {
                let result = decode_envelope(&raw)
                    .map(Box::new)
                    .map(SessionStoreLoad::Found);
                raw.zeroize();
                result
            }
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(SessionStoreLoad::NotFound),
            Err(error)
                if error.code() == ERR_SEC_INTERACTION_NOT_ALLOWED
                    || error.code() == ERR_SEC_AUTH_FAILED =>
            {
                Ok(SessionStoreLoad::InteractionRequired)
            }
            Err(error) => Err(keychain_error("read saved Apple ID session", error)),
        }
    }

    fn save(&self, envelope: &SessionEnvelope) -> Result<(), AppError> {
        let mut raw = serde_json::to_vec(envelope).map_err(|error| {
            AppError::storage(format!("Failed to encode auth session: {error}"))
        })?;
        let mut options =
            PasswordOptions::new_generic_password(SESSION_SERVICE_V2, SESSION_ACCOUNT_V2);
        options.set_access_synchronized(Some(false));
        options.set_label("IPA Shuttle Apple ID Session");
        options.set_description("IPA Shuttle saved Apple ID session");
        let result = set_generic_password_options(&raw, options)
            .map_err(|error| keychain_error("save Apple ID session", error));
        raw.zeroize();
        result
    }

    fn delete(&self) -> Result<(), AppError> {
        match delete_generic_password(SESSION_SERVICE_V2, SESSION_ACCOUNT_V2) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(error) => Err(keychain_error("remove saved Apple ID session", error)),
        }
    }
}

trait SessionMarkerStore: Send + Sync {
    fn exists(&self) -> Result<bool, AppError>;
    fn write(&self) -> Result<(), AppError>;
    fn delete(&self) -> Result<(), AppError>;
}

#[derive(Debug, Default)]
struct FileSessionMarkerStore;

impl SessionMarkerStore for FileSessionMarkerStore {
    fn exists(&self) -> Result<bool, AppError> {
        Ok(session_marker_path()?.is_file())
    }

    fn write(&self) -> Result<(), AppError> {
        storage::ensure_private_dir(&storage::app_support_dir()?)?;
        storage::atomic_write_private(
            &session_marker_path()?,
            format!("{{\"schemaVersion\":{SESSION_SCHEMA_VERSION}}}\n").as_bytes(),
        )
    }

    fn delete(&self) -> Result<(), AppError> {
        remove_marker_at(&session_marker_path()?)
    }
}

#[derive(Clone)]
pub struct AuthSessionManager {
    store: Arc<dyn SessionStore>,
    marker: Arc<dyn SessionMarkerStore>,
    runtime: Arc<Mutex<AuthRuntime>>,
}

impl Default for AuthSessionManager {
    fn default() -> Self {
        Self::new(Arc::new(MacKeychainSessionStore))
    }
}

impl AuthSessionManager {
    pub fn new(store: Arc<dyn SessionStore>) -> Self {
        Self {
            store,
            marker: Arc::new(FileSessionMarkerStore),
            runtime: Arc::new(Mutex::new(AuthRuntime::default())),
        }
    }

    #[cfg(test)]
    fn with_marker(store: Arc<dyn SessionStore>, marker: Arc<dyn SessionMarkerStore>) -> Self {
        Self {
            store,
            marker,
            runtime: Arc::new(Mutex::new(AuthRuntime::default())),
        }
    }

    pub fn begin_auth_operation(&self) -> Result<u64, AppError> {
        self.runtime
            .lock()
            .map(|mut runtime| {
                runtime.generation = runtime.generation.wrapping_add(1);
                runtime.generation
            })
            .map_err(|_| AppError::storage("Apple ID session lock poisoned"))
    }

    pub fn cancel_auth_operations(&self) -> Result<(), AppError> {
        self.begin_auth_operation().map(|_| ())
    }

    pub fn save_login_session(
        &self,
        raw: &str,
        remember: bool,
        operation: u64,
    ) -> Result<AppleAuthSession, AppError> {
        let session = parse_session_json(raw)?;
        let envelope = SessionEnvelope::new(session.clone());
        let validity = envelope.validity();
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| AppError::storage("Apple ID session lock poisoned"))?;
        ensure_current_operation(&runtime, operation)?;

        if remember {
            self.store.save(&envelope)?;
            self.marker.write()?;
        }

        runtime.cached = Some(CachedAuthSession {
            session: session.clone(),
            validity,
        });
        Ok(session)
    }

    pub fn load_saved_interactive(&self) -> Result<LoadSavedSessionResult, AppError> {
        let operation = self.begin_auth_operation()?;
        let loaded = self.store.load_interactive()?;
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| AppError::storage("Apple ID session lock poisoned"))?;
        ensure_current_operation(&runtime, operation)?;

        match loaded {
            SessionStoreLoad::Found(envelope) => {
                let envelope = *envelope;
                envelope.validate()?;
                let validity = envelope.validity();
                let session = envelope.session;
                runtime.cached = Some(CachedAuthSession {
                    session: session.clone(),
                    validity,
                });
                if validity == SessionValidity::Usable {
                    Ok(LoadSavedSessionResult::Loaded(session))
                } else {
                    Ok(LoadSavedSessionResult::Expired)
                }
            }
            SessionStoreLoad::NotFound => {
                runtime.cached = None;
                self.marker.delete()?;
                Ok(LoadSavedSessionResult::NotFound)
            }
            SessionStoreLoad::InteractionRequired => {
                Ok(LoadSavedSessionResult::InteractionRequired)
            }
        }
    }

    pub fn state(&self) -> Result<AuthSessionState, AppError> {
        let runtime = self
            .runtime
            .lock()
            .map_err(|_| AppError::storage("Apple ID session lock poisoned"))?;
        if let Some(current) = runtime.cached.as_ref() {
            let usable = current.validity == SessionValidity::Usable
                && has_download_session_material(&current.session);
            return Ok(AuthSessionState {
                state: if usable {
                    AuthState::SignedIn
                } else {
                    AuthState::SessionExpired
                },
                session: Some(current.session.clone()),
                source: SessionSource::Memory,
                has_in_memory_session: true,
                has_usable_session: usable,
                generation: runtime.generation,
            });
        }
        let generation = runtime.generation;
        drop(runtime);

        if self.marker.exists()? {
            Ok(AuthSessionState {
                state: AuthState::SavedSessionAvailable,
                session: None,
                source: SessionSource::Keychain,
                has_in_memory_session: false,
                has_usable_session: false,
                generation,
            })
        } else {
            Ok(AuthSessionState {
                state: AuthState::NotSignedIn,
                session: None,
                source: SessionSource::None,
                has_in_memory_session: false,
                has_usable_session: false,
                generation,
            })
        }
    }

    pub fn refresh_from_temp(
        &self,
        temp: &TempSessionFile,
        expected_generation: u64,
    ) -> Result<AppleAuthSession, AppError> {
        let mut raw = temp.read_raw()?;
        let session_result = self.refresh_from_raw(&raw, expected_generation);
        raw.zeroize();
        session_result
    }

    fn refresh_from_raw(
        &self,
        raw: &str,
        expected_generation: u64,
    ) -> Result<AppleAuthSession, AppError> {
        let session = parse_session_json(raw)?;
        let validity = session_validity(&session, None);
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| AppError::storage("Apple ID session lock poisoned"))?;
        ensure_current_operation(&runtime, expected_generation)?;
        runtime.cached = Some(CachedAuthSession {
            session: session.clone(),
            validity,
        });
        Ok(session)
    }

    pub fn mark_session_expired(&self) -> Result<(), AppError> {
        self.runtime
            .lock()
            .map(|mut runtime| {
                if let Some(session) = runtime.cached.as_mut() {
                    session.validity = SessionValidity::Expired;
                }
            })
            .map_err(|_| AppError::storage("Apple ID session lock poisoned"))
    }

    pub fn forget(&self) -> Result<(), AppError> {
        let should_delete_saved = self.marker.exists()?;
        {
            let mut runtime = self
                .runtime
                .lock()
                .map_err(|_| AppError::storage("Apple ID session lock poisoned"))?;
            runtime.generation = runtime.generation.wrapping_add(1);
            runtime.cached = None;
        }
        if should_delete_saved {
            self.store.delete()?;
        }
        self.marker.delete()
    }
}

#[derive(Debug, Clone)]
pub enum LoadSavedSessionResult {
    Loaded(AppleAuthSession),
    NotFound,
    InteractionRequired,
    Expired,
}

pub struct TempSessionFile {
    path: PathBuf,
}

impl TempSessionFile {
    pub fn new() -> Result<Self, AppError> {
        let dir = storage::app_support_dir()?.join("Temp");
        storage::ensure_private_dir(&dir)?;
        let path = dir.join(format!("auth-session-{}.json", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(|error| {
                AppError::storage(format!("Failed to create temp auth session: {error}"))
            })?;
        file.write_all(b"{}").map_err(|error| {
            AppError::storage(format!("Failed to initialize temp auth session: {error}"))
        })?;
        Ok(Self { path })
    }

    pub fn path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }

    pub fn read_raw(&self) -> Result<String, AppError> {
        validate_temp_session_path(&self.path)?;
        fs::read_to_string(&self.path).map_err(|error| {
            AppError::storage(format!("Failed to read temp auth session: {error}"))
        })
    }

    pub fn write_raw(&self, raw: &str) -> Result<(), AppError> {
        validate_temp_session_path(&self.path)?;
        let mut file = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&self.path)
            .map_err(|error| {
                AppError::storage(format!("Failed to open temp auth session: {error}"))
            })?;
        file.write_all(raw.as_bytes()).map_err(|error| {
            AppError::storage(format!("Failed to write temp auth session: {error}"))
        })?;
        file.sync_all().map_err(|error| {
            AppError::storage(format!("Failed to sync temp auth session: {error}"))
        })
    }
}

impl Drop for TempSessionFile {
    fn drop(&mut self) {
        if let Ok(metadata) = fs::metadata(&self.path)
            && let Ok(mut file) = OpenOptions::new().write(true).open(&self.path)
        {
            let _ = file.seek(SeekFrom::Start(0));
            let zeros = [0_u8; 8_192];
            let mut remaining = metadata.len();
            while remaining > 0 {
                let count = remaining.min(zeros.len() as u64) as usize;
                if file.write_all(&zeros[..count]).is_err() {
                    break;
                }
                remaining -= count as u64;
            }
            let _ = file.sync_data();
        }
        let _ = fs::remove_file(&self.path);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionSource {
    Memory,
    Keychain,
    None,
}

impl SessionSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::Keychain => "keychain",
            Self::None => "none",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuthSessionState {
    pub state: AuthState,
    pub session: Option<AppleAuthSession>,
    pub source: SessionSource,
    pub has_in_memory_session: bool,
    pub has_usable_session: bool,
    pub generation: u64,
}

impl SessionEnvelope {
    fn new(session: AppleAuthSession) -> Self {
        Self {
            schema_version: SESSION_SCHEMA_VERSION,
            account: session.email.clone(),
            saved_at: Utc::now().to_rfc3339(),
            expires_at: None,
            session,
        }
    }

    fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != SESSION_SCHEMA_VERSION
            || self.account.trim().is_empty()
            || self.account != self.session.email
        {
            return Err(AppError::auth_required(
                "Saved Apple ID session is incompatible. Sign in again.",
            ));
        }
        Ok(())
    }

    fn validity(&self) -> SessionValidity {
        session_validity(&self.session, self.expires_at.as_deref())
    }
}

pub fn parse_session_json(raw: &str) -> Result<AppleAuthSession, AppError> {
    let mut value: serde_json::Value = serde_json::from_str(raw).map_err(|error| {
        AppError::storage(format!("Failed to parse auth session JSON: {error}"))
    })?;
    if let Some(object) = value.as_object_mut() {
        object.remove("password");
        object.remove("verificationCode");
        object.remove("code");
    }
    let session = serde_json::from_value::<AppleAuthSession>(value)
        .map_err(|error| AppError::storage(format!("Invalid auth session JSON: {error}")))?;
    if session.email.trim().is_empty() || session.password_token.as_deref().unwrap_or("").is_empty()
    {
        return Err(AppError::auth_required(
            "Apple ID session is missing or expired.",
        ));
    }
    Ok(session)
}

pub fn write_session_temp(session: &AppleAuthSession) -> Result<TempSessionFile, AppError> {
    let mut raw = serde_json::to_string(session)
        .map_err(|error| AppError::storage(format!("Failed to encode auth session: {error}")))?;
    let temp = TempSessionFile::new()?;
    let result = temp.write_raw(&raw);
    raw.zeroize();
    result?;
    Ok(temp)
}

pub fn has_download_session_material(session: &AppleAuthSession) -> bool {
    !session.email.trim().is_empty()
        && !session.password_token.as_deref().unwrap_or("").is_empty()
        && !session
            .directory_services_identifier
            .as_deref()
            .unwrap_or("")
            .is_empty()
        && !session.store_front.as_deref().unwrap_or("").is_empty()
        && !session.cookies.is_empty()
}

fn decode_envelope(raw: &[u8]) -> Result<SessionEnvelope, AppError> {
    let envelope = serde_json::from_slice::<SessionEnvelope>(raw)
        .map_err(|error| AppError::storage(format!("Invalid saved Apple ID session: {error}")))?;
    envelope.validate()?;
    Ok(envelope)
}

fn session_validity(session: &AppleAuthSession, expires_at: Option<&str>) -> SessionValidity {
    if !has_download_session_material(session) {
        return SessionValidity::Expired;
    }
    if let Some(expires_at) = expires_at
        && DateTime::parse_from_rfc3339(expires_at)
            .map(|expires| expires <= Utc::now())
            .unwrap_or(true)
    {
        return SessionValidity::Expired;
    }
    SessionValidity::Usable
}

fn ensure_current_operation(runtime: &AuthRuntime, operation: u64) -> Result<(), AppError> {
    if runtime.generation == operation {
        Ok(())
    } else {
        Err(AppError::auth_required(
            "Apple ID operation was superseded. Try again.",
        ))
    }
}

fn keychain_error(action: &str, error: security_framework::base::Error) -> AppError {
    AppError::storage(format!("Could not {action}: OSStatus {}", error.code()))
}

fn session_marker_path() -> Result<PathBuf, AppError> {
    Ok(storage::app_support_dir()?.join(SESSION_MARKER_V2_FILE))
}

fn remove_marker_at(path: &Path) -> Result<(), AppError> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            AppError::storage(format!("Failed to remove Apple ID session marker: {error}"))
        })?;
    }
    Ok(())
}

fn validate_temp_session_path(path: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::storage(format!("Failed to inspect temp auth session: {error}"))
    })?;
    if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(AppError::storage(
            "Temporary auth session file is not a private regular file",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    #[derive(Default)]
    struct MemoryMarker {
        present: Mutex<bool>,
    }

    impl SessionMarkerStore for MemoryMarker {
        fn exists(&self) -> Result<bool, AppError> {
            self.present
                .lock()
                .map(|present| *present)
                .map_err(|_| AppError::storage("marker lock poisoned"))
        }

        fn write(&self) -> Result<(), AppError> {
            self.present
                .lock()
                .map(|mut present| *present = true)
                .map_err(|_| AppError::storage("marker lock poisoned"))
        }

        fn delete(&self) -> Result<(), AppError> {
            self.present
                .lock()
                .map(|mut present| *present = false)
                .map_err(|_| AppError::storage("marker lock poisoned"))
        }
    }

    #[derive(Default)]
    struct CountingStore {
        envelope: Mutex<Option<SessionEnvelope>>,
        interactive_loads: AtomicUsize,
        saves: AtomicUsize,
        deletes: AtomicUsize,
    }

    impl SessionStore for CountingStore {
        fn load_interactive(&self) -> Result<SessionStoreLoad, AppError> {
            self.interactive_loads.fetch_add(1, Ordering::SeqCst);
            self.load()
        }

        fn save(&self, envelope: &SessionEnvelope) -> Result<(), AppError> {
            self.saves.fetch_add(1, Ordering::SeqCst);
            self.envelope
                .lock()
                .map(|mut current| *current = Some(envelope.clone()))
                .map_err(|_| AppError::storage("store lock poisoned"))
        }

        fn delete(&self) -> Result<(), AppError> {
            self.deletes.fetch_add(1, Ordering::SeqCst);
            self.envelope
                .lock()
                .map(|mut current| *current = None)
                .map_err(|_| AppError::storage("store lock poisoned"))
        }
    }

    impl CountingStore {
        fn load(&self) -> Result<SessionStoreLoad, AppError> {
            self.envelope
                .lock()
                .map(|current| {
                    current
                        .clone()
                        .map(Box::new)
                        .map(SessionStoreLoad::Found)
                        .unwrap_or(SessionStoreLoad::NotFound)
                })
                .map_err(|_| AppError::storage("store lock poisoned"))
        }
    }

    fn usable_session() -> AppleAuthSession {
        AppleAuthSession {
            email: "person@example.com".to_string(),
            name: None,
            password_token: Some("token".to_string()),
            directory_services_identifier: Some("dsid".to_string()),
            store_front: Some("143441-1,29".to_string()),
            pod: None,
            cookies: vec![serde_json::json!({"url":"https://buy.itunes.apple.com"})],
        }
    }

    fn raw_usable_session() -> String {
        serde_json::to_string(&usable_session()).expect("encode fixture")
    }

    #[test]
    fn parses_session_json_and_drops_plain_password_and_code() {
        let session = parse_session_json(
            r#"{
              "email":"person@example.com",
              "password":"do-not-store",
              "verificationCode":"123456",
              "passwordToken":"token",
              "storeFront":"143441-1,29",
              "cookies":[]
            }"#,
        )
        .expect("session should parse");

        let encoded = serde_json::to_string(&session).expect("encode session");
        assert!(!encoded.contains("do-not-store"));
        assert!(!encoded.contains("123456"));
        assert!(!encoded.contains("\"password\""));
    }

    #[test]
    fn rejects_missing_or_expired_session_token() {
        let error = parse_session_json(r#"{"email":"person@example.com","cookies":[]}"#)
            .expect_err("missing token should be auth required");
        assert_eq!(error.code, "AUTH_REQUIRED");
    }

    #[test]
    fn requires_download_credentials_and_cookies_for_usable_session() {
        let mut session = usable_session();
        session.cookies.clear();
        assert!(!has_download_session_material(&session));
        session.cookies.push(serde_json::json!({
            "url": "https://buy.itunes.apple.com"
        }));
        assert!(has_download_session_material(&session));
    }

    #[test]
    fn login_saves_exactly_once_and_memory_only_never_persists() {
        let store = Arc::new(CountingStore::default());
        let manager =
            AuthSessionManager::with_marker(store.clone(), Arc::new(MemoryMarker::default()));
        let operation = manager.begin_auth_operation().expect("begin login");
        manager
            .save_login_session(&raw_usable_session(), true, operation)
            .expect("save login");
        assert_eq!(store.saves.load(Ordering::SeqCst), 1);

        let operation = manager.begin_auth_operation().expect("begin memory login");
        manager
            .save_login_session(&raw_usable_session(), false, operation)
            .expect("save memory login");
        assert_eq!(store.saves.load(Ordering::SeqCst), 1);
        assert_eq!(store.interactive_loads.load(Ordering::SeqCst), 0);
        assert_eq!(store.deletes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn use_saved_loads_once_and_repeated_session_snapshots_do_not_reload() {
        let store = Arc::new(CountingStore::default());
        *store.envelope.lock().expect("store lock") = Some(SessionEnvelope::new(usable_session()));
        let marker = Arc::new(MemoryMarker::default());
        marker.write().expect("write marker");
        let manager = AuthSessionManager::with_marker(store.clone(), marker);

        let loaded = manager.load_saved_interactive().expect("load saved");
        assert!(matches!(loaded, LoadSavedSessionResult::Loaded(_)));
        for _ in 0..10 {
            let state = manager.state().expect("download state");
            let raw = serde_json::to_string(state.session.as_ref().expect("cached session"))
                .expect("encode download session");
            manager
                .refresh_from_raw(&raw, state.generation)
                .expect("refresh in-memory download session");
        }
        assert_eq!(store.interactive_loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn automatic_status_checks_never_load_keychain() {
        let store = Arc::new(CountingStore::default());
        let manager =
            AuthSessionManager::with_marker(store.clone(), Arc::new(MemoryMarker::default()));

        for _ in 0..20 {
            let state = manager.state().expect("background auth status");
            assert!(!state.has_usable_session);
        }

        assert_eq!(store.interactive_loads.load(Ordering::SeqCst), 0);
        assert_eq!(store.saves.load(Ordering::SeqCst), 0);
        assert_eq!(store.deletes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn forget_deletes_one_v2_item_and_clears_memory() {
        let store = Arc::new(CountingStore::default());
        let marker = Arc::new(MemoryMarker::default());
        let manager = AuthSessionManager::with_marker(store.clone(), marker.clone());
        let operation = manager.begin_auth_operation().expect("begin login");
        manager
            .save_login_session(&raw_usable_session(), true, operation)
            .expect("save login");

        manager.forget().expect("forget session");
        assert_eq!(store.deletes.load(Ordering::SeqCst), 1);
        assert!(!manager.state().expect("state").has_in_memory_session);
        assert!(!marker.exists().expect("marker state"));
    }

    #[test]
    fn stale_auth_operation_cannot_restore_old_session() {
        let store = Arc::new(CountingStore::default());
        let manager =
            AuthSessionManager::with_marker(store.clone(), Arc::new(MemoryMarker::default()));
        let stale_operation = manager.begin_auth_operation().expect("begin stale login");
        let _new_operation = manager.begin_auth_operation().expect("begin new login");

        let error = manager
            .save_login_session(&raw_usable_session(), true, stale_operation)
            .expect_err("stale login must fail");
        assert_eq!(error.code, "AUTH_REQUIRED");
        assert_eq!(store.saves.load(Ordering::SeqCst), 0);
        assert!(!manager.state().expect("state").has_in_memory_session);
    }
}
