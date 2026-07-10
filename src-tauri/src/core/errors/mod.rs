use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[error("{user_message}")]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub user_message: String,
    pub technical_message: String,
}

impl AppError {
    pub fn new(
        code: impl Into<String>,
        user_message: impl Into<String>,
        technical_message: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            user_message: user_message.into(),
            technical_message: technical_message.into(),
        }
    }

    pub fn no_device(details: impl Into<String>) -> Self {
        Self::new("NO_DEVICE", "No iPhone connected.", details)
    }

    pub fn not_trusted(details: impl Into<String>) -> Self {
        Self::new(
            "DEVICE_NOT_TRUSTED",
            "Unlock iPhone and tap Trust This Computer.",
            details,
        )
    }

    pub fn engine_missing(missing: &[String]) -> Self {
        Self::new(
            "ENGINE_MISSING",
            "Required internal engine is missing from the app bundle.",
            format!("Missing engine binaries: {}", missing.join(", ")),
        )
    }

    pub fn auth_required(details: impl Into<String>) -> Self {
        Self::new("AUTH_REQUIRED", "Apple ID is not signed in.", details)
    }

    pub fn app_unavailable(details: impl Into<String>) -> Self {
        Self::new(
            "APP_UNAVAILABLE",
            "Apple no longer provides this app for this Apple ID.",
            details,
        )
    }

    pub fn ipa_missing(details: impl Into<String>) -> Self {
        Self::new(
            "IPA_MISSING",
            "IPA file is missing from local library.",
            details,
        )
    }

    pub fn install_failed(details: impl Into<String>) -> Self {
        Self::new(
            "INSTALL_FAILED",
            "Installation failed. The target iPhone may need the same Apple ID.",
            details,
        )
    }

    pub fn storage(details: impl Into<String>) -> Self {
        Self::new(
            "STORAGE_ERROR",
            "IPA Shuttle could not access its local library.",
            details,
        )
    }

    pub fn process_failed(user_message: impl Into<String>, details: impl Into<String>) -> Self {
        Self::new("PROCESS_FAILED", user_message, details)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::storage(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_human_readable_error_codes_and_messages() {
        let no_device = AppError::no_device("none");
        assert_eq!(no_device.code, "NO_DEVICE");
        assert_eq!(no_device.user_message, "No iPhone connected.");

        let unavailable = AppError::app_unavailable("gone");
        assert_eq!(unavailable.code, "APP_UNAVAILABLE");
        assert_eq!(
            unavailable.user_message,
            "Apple no longer provides this app for this Apple ID."
        );

        let install_failed = AppError::install_failed("failed");
        assert_eq!(install_failed.code, "INSTALL_FAILED");
        assert!(install_failed.user_message.contains("same Apple ID"));
    }
}
