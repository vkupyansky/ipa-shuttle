import { invoke } from "@tauri-apps/api/core";
import type {
  AppError,
  AppDataSizeBatchResult,
  AppIconResult,
  AppInfo,
  AuthFlowResult,
  AuthSessionState,
  Device,
  DeviceInfo,
  DownloadResult,
  EngineStatus,
  InstallResult,
  LocalIpa,
  LogEntry
} from "./types";

function normalizeError(error: unknown): AppError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<AppError>;
    if (typeof candidate.userMessage === "string" && typeof candidate.code === "string") {
      const normalized: AppError = {
        code: candidate.code,
        userMessage: candidate.userMessage
      };
      if (typeof candidate.technicalMessage === "string") {
        normalized.technicalMessage = candidate.technicalMessage;
      }
      return normalized;
    }
  }

  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as Partial<AppError>;
      if (typeof parsed.userMessage === "string" && typeof parsed.code === "string") {
        const normalized: AppError = {
          code: parsed.code,
          userMessage: parsed.userMessage
        };
        if (typeof parsed.technicalMessage === "string") {
          normalized.technicalMessage = parsed.technicalMessage;
        }
        return normalized;
      }
    } catch {
      return {
        code: "UNKNOWN",
        userMessage: error
      };
    }
  }

  return {
    code: "UNKNOWN",
    userMessage: "UNKNOWN"
  };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

export const api = {
  getEngineStatus: () => call<EngineStatus>("get_engine_status"),
  detectDevices: () => call<Device[]>("detect_devices"),
  getDeviceInfo: (deviceId?: string) => call<DeviceInfo>("get_device_info", { deviceId }),
  scanInstalledApps: (deviceId?: string) => call<AppInfo[]>("scan_installed_apps", { deviceId }),
  fetchAppDataSizes: (deviceId: string, bundleIds: string[], batchId: string) =>
    call<AppDataSizeBatchResult>("fetch_app_data_sizes", { deviceId, bundleIds, batchId }),
  cancelAppDataSizes: (batchId?: string) => call<unknown>("cancel_app_data_sizes", { batchId }),
  fetchAppIcons: (deviceId: string | undefined, bundleIds: string[], batchId: string) =>
    call<AppIconResult[]>("fetch_app_icons", { deviceId, bundleIds, batchId }),
  refetchAppIcon: (deviceId: string | undefined, bundleId: string, batchId?: string) =>
    call<AppIconResult>("refetch_app_icon", { deviceId, bundleId, batchId }),
  getAppleAuthStatus: () => call<AuthSessionState>("get_apple_auth_status"),
  startAppleLogin: (email: string, password: string, remember: boolean) =>
    call<AuthFlowResult>("start_apple_login", { email, password, remember }),
  submitAppleVerificationCode: (code: string) =>
    call<AuthFlowResult>("submit_apple_verification_code", { code }),
  cancelAppleLogin: () => call<AuthFlowResult>("cancel_apple_login"),
  useSavedAppleSession: () => call<AuthSessionState>("use_saved_apple_session"),
  forgetAppleSession: () => call<AuthSessionState>("forget_apple_session"),
  downloadIpa: (bundleId: string, appName?: string, sourceDeviceName?: string, visibleAuthState?: string) =>
    call<DownloadResult>("download_ipa", { bundleId, appName, sourceDeviceName, visibleAuthState }),
  listLocalIpas: () => call<LocalIpa[]>("list_local_ipas"),
  deleteLocalIpas: (ipaIds: string[]) => call<LocalIpa[]>("delete_local_ipas", { ipaIds }),
  installIpa: (deviceId: string, ipaId: string) => call<InstallResult>("install_ipa", { deviceId, ipaId }),
  openLibraryFolder: async () => {
    await call<unknown>("open_library_folder");
  },
  readActivityLog: () => call<LogEntry[]>("read_activity_log"),
  readActivityDiagnostics: () => call<string>("read_activity_diagnostics"),
  clearActivityLogs: () => call<unknown>("clear_activity_logs"),
  openLogsFolder: () => call<unknown>("open_logs_folder"),
  writeActivityEvent: (
    level: LogEntry["level"],
    taskName: string,
    message: string,
    technicalDetails?: string
  ) => call<unknown>("write_activity_event", { level, taskName, message, technicalDetails })
};
