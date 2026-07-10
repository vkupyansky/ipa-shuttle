type DeviceTrustStatus = "connected" | "notTrusted";

export type Device = {
  udid: string;
  name?: string | null;
  model?: string | null;
  iosVersion?: string | null;
  batteryPercent?: number | null;
  connected: boolean;
  trustStatus: DeviceTrustStatus;
};

export type DeviceInfo = Device;

export type AppInfo = {
  name: string;
  bundleId: string;
  source: "device";
  version?: string | null;
  staticDiskUsageBytes?: number | null;
  dynamicDiskUsageBytes?: number | null;
  totalDiskUsageBytes?: number | null;
  dataSizeStatus: AppDataSizeStatus;
  iconPath?: string | null;
  iconUpdatedAt?: string | null;
  iconCacheVersion?: number | null;
  iconStatus: AppIconStatus;
  iconError?: string | null;
};

type AppDataSizeStatus = "notLoaded" | "loading" | "loaded" | "unavailable";

export type AppDataSizeResult = {
  bundleId: string;
  dynamicDiskUsageBytes?: number | null;
  status: AppDataSizeStatus;
};

export type AppDataSizeBatchResult = {
  batchId: string;
  items: AppDataSizeResult[];
  cancelled: boolean;
};

type AppIconStatus = "cached" | "loading" | "loaded" | "fallback" | "failed";

export type AppIconResult = {
  batchId?: string | null;
  bundleId: string;
  iconPath?: string | null;
  iconUpdatedAt?: string | null;
  iconCacheVersion?: number | null;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  cacheInvalid: boolean;
  renderFailed: boolean;
  status: AppIconStatus;
  iconError?: string | null;
  technicalDetails?: string | null;
  ok: boolean;
};

export type AuthSessionState = {
  state: AuthState;
  account?: string | null;
};

type AuthState =
  | "notSignedIn"
  | "signedIn"
  | "savedSessionAvailable"
  | "savedSessionLocked"
  | "sessionExpired";

type AuthFlowState = "verificationRequired" | "success" | "error";

export type AuthFlowResult = {
  state: AuthFlowState;
  signedIn: boolean;
  account?: string | null;
  errorCode?: string | null;
};

type LocalIpaStatus = "downloaded" | "missing";

export type AppDownloadStatus = "notDownloaded" | "downloading" | "downloaded" | "missing" | "failed";

export type LocalIpa = {
  id: string;
  bundleId: string;
  appName?: string | null;
  ipaPath: string;
  downloadedAt: string;
  iconPath?: string | null;
  iconUpdatedAt?: string | null;
  iconCacheVersion?: number | null;
  status: LocalIpaStatus;
};

export type DownloadResult = {
  ok: boolean;
  item?: LocalIpa | null;
};

export type InstallResult = {
  ok: boolean;
  ipaId: string;
  bundleId?: string | null;
};

export type LogEntry = {
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  taskName: string;
  message: string;
  durationMs?: number | null;
  technicalDetails?: string | null;
};

export type EngineStatus = {
  ready: boolean;
  missing: string[];
};

export type AppError = {
  code: string;
  userMessage: string;
  technicalMessage?: string;
};

export type ItemProgress = "idle" | "downloading" | "downloaded" | "installing" | "installed" | "failed";
