import type { TranslationKey, TranslationValues } from "../i18n";
import type { AppError } from "./types";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

const errorCodeKeys: Partial<Record<string, TranslationKey>> = {
  UNKNOWN: "app.error.generic",
  NO_DEVICE: "error.noDevice",
  DEVICE_NOT_TRUSTED: "error.deviceNotTrusted",
  ENGINE_MISSING: "error.engineMissing",
  AUTH_REQUIRED: "error.authRequired",
  AUTH_SESSION_EXPIRED: "download.block.signInAgain",
  AUTH_CREDENTIALS_REQUIRED: "auth.modal.credentialsRequired",
  AUTH_CODE_REQUIRED: "auth.modal.enterCode",
  AUTH_CODE_INVALID: "auth.modal.invalidCode",
  AUTH_CODE_EXPIRED: "auth.modal.expiredCode",
  AUTH_ACCOUNT_LOCKED: "auth.modal.accountLocked",
  AUTH_WRONG_CREDENTIALS: "auth.modal.wrongCredentials",
  AUTH_NETWORK: "auth.modal.networkError",
  AUTH_CANCELLED: "auth.modal.cancelled",
  AUTH_FAILED: "auth.modal.failed",
  APP_UNAVAILABLE: "error.appUnavailable",
  IPA_MISSING: "error.ipaMissing",
  INSTALL_FAILED: "error.installFailed",
  STORAGE_ERROR: "error.storage",
  PROCESS_FAILED: "error.processFailed",
  NO_SELECTION: "error.noAppSelection"
};

export function localizedErrorMessage(error: AppError, t: Translate) {
  const key = errorCodeKeys[error.code];
  return key ? t(key) : error.userMessage;
}
