use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub ready: bool,
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub udid: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub ios_version: Option<String>,
    pub battery_percent: Option<u8>,
    pub connected: bool,
    pub trust_status: DeviceTrustStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub udid: String,
    pub name: Option<String>,
    pub model: Option<String>,
    pub ios_version: Option<String>,
    pub battery_percent: Option<u8>,
    pub connected: bool,
    pub trust_status: DeviceTrustStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceTrustStatus {
    Connected,
    NotTrusted,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub bundle_id: String,
    pub source: AppSource,
    pub version: Option<String>,
    pub static_disk_usage_bytes: Option<u64>,
    pub dynamic_disk_usage_bytes: Option<u64>,
    pub total_disk_usage_bytes: Option<u64>,
    pub data_size_status: AppDataSizeStatus,
    pub icon_path: Option<String>,
    pub icon_updated_at: Option<String>,
    pub icon_cache_version: Option<u32>,
    pub icon_status: AppIconStatus,
    pub icon_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppDataSizeStatus {
    NotLoaded,
    Loaded,
    Unavailable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataSizeResult {
    pub bundle_id: String,
    pub dynamic_disk_usage_bytes: Option<u64>,
    pub status: AppDataSizeStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDataSizeBatchResult {
    pub batch_id: String,
    pub items: Vec<AppDataSizeResult>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIconResult {
    pub batch_id: Option<String>,
    pub bundle_id: String,
    pub icon_path: Option<String>,
    pub icon_updated_at: Option<String>,
    pub icon_cache_version: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_size: Option<u64>,
    pub cache_invalid: bool,
    pub render_failed: bool,
    pub status: AppIconStatus,
    pub icon_error: Option<String>,
    pub technical_details: Option<String>,
    pub ok: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppIconStatus {
    Cached,
    Loading,
    Loaded,
    Fallback,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppSource {
    Device,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionState {
    pub state: AuthState,
    pub account: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthState {
    NotSignedIn,
    SignedIn,
    SavedSessionAvailable,
    SavedSessionLocked,
    SessionExpired,
}

impl AuthState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotSignedIn => "notSignedIn",
            Self::SignedIn => "signedIn",
            Self::SavedSessionAvailable => "savedSessionAvailable",
            Self::SavedSessionLocked => "savedSessionLocked",
            Self::SessionExpired => "sessionExpired",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthFlowResult {
    pub state: AuthFlowState,
    pub signed_in: bool,
    pub account: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthFlowState {
    VerificationRequired,
    Success,
    Error,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub items: Vec<ManifestItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManifestItem {
    pub id: String,
    pub bundle_id: String,
    pub app_name: Option<String>,
    pub ipa_path: String,
    pub downloaded_at: String,
    pub source_device_name: Option<String>,
    pub icon_path: Option<String>,
    pub icon_updated_at: Option<String>,
    pub icon_cache_version: Option<u32>,
    pub status: ManifestItemStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ManifestItemStatus {
    Downloaded,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalIpa {
    pub id: String,
    pub bundle_id: String,
    pub app_name: Option<String>,
    pub ipa_path: String,
    pub downloaded_at: String,
    pub icon_path: Option<String>,
    pub icon_updated_at: Option<String>,
    pub icon_cache_version: Option<u32>,
    pub status: LocalIpaStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalIpaStatus {
    Downloaded,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub ok: bool,
    pub item: Option<LocalIpa>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub ok: bool,
    pub ipa_id: String,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: LogLevel,
    pub task_name: String,
    pub message: String,
    pub duration_ms: Option<u128>,
    pub technical_details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone)]
pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub success: bool,
    pub timed_out: bool,
}
