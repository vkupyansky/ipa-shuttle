import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "./providers/LanguageProvider";
import { AppleAuthModal } from "../features/auth/AppleAuthModal";
import { AppShell } from "../components/mac/AppShell";
import { ErrorBanner } from "../components/mac/ErrorBanner";
import { MacButton } from "../components/mac/MacButton";
import { MacConfirmationDialog } from "../components/mac/MacConfirmationDialog";
import { api } from "../lib/api";
import { appleAuthBlockedReason, hasUsableAppleSession } from "../lib/auth";
import {
  clearLogsConfirmation,
  deleteIpasConfirmation,
  forgetAppleSessionConfirmation
} from "../lib/confirmationText";
import { toAppError } from "../lib/result";
import type {
  AppDownloadStatus,
  AppDataSizeResult,
  AppError,
  AppIconResult,
  AppInfo,
  AuthSessionState,
  Device,
  EngineStatus,
  ItemProgress,
  LocalIpa,
  LogEntry
} from "../lib/types";
import { AppsDownloadScreen } from "../features/download-ipa/AppsDownloadScreen";
import { useIpaLibraryStore } from "../features/ipa-library/useIpaLibraryStore";
import { TargetIPhoneScreen } from "../features/target-device/TargetIPhoneScreen";
import { deviceActivityMessages } from "../lib/activityLogI18n";

type PendingConfirmation =
  | {
      kind: "forgetSession";
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "clearLogs";
      message: string;
      confirmLabel: string;
    }
  | {
      kind: "deleteIpas";
      message: string;
      confirmLabel: string;
      ipaIds: string[];
      allMissing: boolean;
    };

export default function App() {
  const { t } = useI18n();
  const normalizeError = useCallback(
    (caught: unknown) => toAppError(caught, t("app.error.generic")),
    [t]
  );
  const [activeStep, setActiveStep] = useState(0);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const {
    items: ipas,
    reconcile: reconcileLibraryStore,
    replace: replaceLibrary,
    upsert: upsertLibraryItem,
    remove: removeLibraryItems
  } = useIpaLibraryStore();
  const [authStatus, setAuthStatus] = useState<AuthSessionState | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [dataSizesLoading, setDataSizesLoading] = useState(false);
  const [deviceRefreshing, setDeviceRefreshing] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [query, setQuery] = useState("");
  const [ipaQuery, setIpaQuery] = useState("");
  const [selectedBundleIds, setSelectedBundleIds] = useState<Set<string>>(new Set());
  const [selectedIpaIds, setSelectedIpaIds] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, "downloading" | "failed">>({});
  const [installStatuses, setInstallStatuses] = useState<Record<string, ItemProgress | "missing">>({});
  const activeIconBatchRef = useRef<string | null>(null);
  const activeDataSizeBatchRef = useRef<string | null>(null);
  const dataSizeGenerationRef = useRef(0);
  const scanGenerationRef = useRef(0);
  const iconRenderRetryRef = useRef<Set<string>>(new Set());
  const logRefreshGenerationRef = useRef(0);
  const logClearInProgressRef = useRef(false);
  const deviceRefreshGenerationRef = useRef(0);
  const deviceRefreshInProgressRef = useRef(false);

  const pruneLibraryDependentState = useCallback((nextItems: LocalIpa[]) => {
    const availableIds = new Set(nextItems.map((ipa) => ipa.id));
    setSelectedIpaIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setInstallStatuses((current) => {
      const entries = Object.entries(current).filter(([id]) => availableIds.has(id));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, []);

  const reconcileLibrary = useCallback(async () => {
    const result = await reconcileLibraryStore();
    if (result.applied) {
      pruneLibraryDependentState(result.items);
    }
    return result.items;
  }, [pruneLibraryDependentState, reconcileLibraryStore]);

  const sourceDevice = devices[0] ?? null;
  const targetDevice = useMemo(() => {
    const differentDevice = devices.find((device) => device.udid !== sourceDevice?.udid);
    return differentDevice ?? devices[0] ?? null;
  }, [devices, sourceDevice?.udid]);

  const appStatuses = useMemo<Record<string, AppDownloadStatus>>(() => {
    const libraryStatuses = new Map<string, "downloaded" | "missing">();
    for (const ipa of ipas) {
      const current = libraryStatuses.get(ipa.bundleId);
      if (ipa.status === "downloaded" || current !== "downloaded") {
        libraryStatuses.set(ipa.bundleId, ipa.status);
      }
    }

    return Object.fromEntries(
      apps.map((app) => {
        const progress = downloadProgress[app.bundleId];
        const libraryStatus = libraryStatuses.get(app.bundleId);
        const status =
          progress === "downloading"
            ? progress
            : libraryStatus ?? (progress === "failed" ? progress : "notDownloaded");
        return [app.bundleId, status];
      })
    );
  }, [apps, downloadProgress, ipas]);

  const authBlockedReason = appleAuthBlockedReason(authStatus, t);
  const downloadBlockedReason = downloading
    ? null
    : authBlockedReason ?? (selectedBundleIds.size === 0 ? t("download.block.selectApp") : null);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialState() {
      try {
        const deviceGeneration = deviceRefreshGenerationRef.current;
        const status = await api.getEngineStatus();
        if (cancelled) {
          return;
        }
        setEngineStatus(status);

        if (!status.ready) {
          return;
        }

        const logGeneration = logRefreshGenerationRef.current;
        const [detectedDevices, auth, activity] = await Promise.all([
          api.detectDevices(),
          api.getAppleAuthStatus(),
          api.readActivityLog()
        ]);
        await reconcileLibrary();

        if (!cancelled) {
          if (deviceRefreshGenerationRef.current === deviceGeneration) {
            setDevices(detectedDevices);
          }
          setAuthStatus(auth);
          if (!logClearInProgressRef.current && logRefreshGenerationRef.current === logGeneration) {
            setLogs(activity);
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(normalizeError(caught));
        }
      }
    }

    void loadInitialState();
    return () => {
      cancelled = true;
    };
  }, [normalizeError, reconcileLibrary]);

  useEffect(() => {
    if (!engineStatus?.ready) {
      return;
    }

    function reconcileOnFocus() {
      void reconcileLibrary().catch((caught: unknown) => {
        setError(normalizeError(caught));
      });
    }

    window.addEventListener("focus", reconcileOnFocus);
    return () => window.removeEventListener("focus", reconcileOnFocus);
  }, [engineStatus?.ready, normalizeError, reconcileLibrary]);

  useEffect(() => {
    return () => {
      const batchId = activeDataSizeBatchRef.current;
      activeDataSizeBatchRef.current = null;
      dataSizeGenerationRef.current += 1;
      if (batchId) {
        void api.cancelAppDataSizes(batchId).catch(() => undefined);
      }
    };
  }, []);

  const refreshLogs = useCallback(async () => {
    if (logClearInProgressRef.current) {
      return;
    }

    const generation = logRefreshGenerationRef.current;
    try {
      const activity = await api.readActivityLog();
      if (!logClearInProgressRef.current && logRefreshGenerationRef.current === generation) {
        setLogs(activity);
      }
    } catch {
      if (!logClearInProgressRef.current && logRefreshGenerationRef.current === generation) {
        setLogs([]);
      }
    }
  }, []);

  const cancelDataSizeLoad = useCallback(async () => {
    const batchId = activeDataSizeBatchRef.current;
    activeDataSizeBatchRef.current = null;
    dataSizeGenerationRef.current += 1;
    setDataSizesLoading(false);
    setApps((current) =>
      current.map((app) =>
        app.dataSizeStatus === "loading"
          ? {
              ...app,
              dynamicDiskUsageBytes: null,
              totalDiskUsageBytes: null,
              dataSizeStatus: "notLoaded"
            }
          : app
      )
    );
    if (batchId) {
      await api.cancelAppDataSizes(batchId).catch(() => undefined);
    }
  }, []);

  async function refreshIphone() {
    if (deviceRefreshInProgressRef.current) {
      return;
    }

    deviceRefreshInProgressRef.current = true;
    setDeviceRefreshing(true);
    setError(null);
    const deviceGeneration = deviceRefreshGenerationRef.current + 1;
    deviceRefreshGenerationRef.current = deviceGeneration;
    const hadConnectedDevice = devices.some((device) => device.connected);
    const previousSourceUdid = sourceDevice?.udid ?? null;
    let detectedDevices: Device[] | null = null;

    try {
      detectedDevices = await api.detectDevices();
      if (detectedDevices.length === 0) {
        await cancelDataSizeLoad();
        if (deviceRefreshGenerationRef.current === deviceGeneration) {
          setDevices([]);
        }
        await api
          .writeActivityEvent("success", "iPhone", deviceActivityMessages.disconnected)
          .catch(() => undefined);
        await refreshLogs();
        return;
      }

      const detectedSource = detectedDevices[0];
      if (previousSourceUdid && detectedSource?.udid !== previousSourceUdid) {
        await cancelDataSizeLoad();
      }
      const visibleDevice =
        activeStep === 1
          ? (detectedDevices.find((device) => device.udid !== detectedSource?.udid) ?? detectedSource)
          : detectedSource;
      let refreshedDevices = detectedDevices;

      if (visibleDevice?.trustStatus === "connected") {
        const deviceInfo = await api.getDeviceInfo(visibleDevice.udid);
        refreshedDevices = detectedDevices.map((device) =>
          device.udid === visibleDevice.udid ? { ...device, ...deviceInfo } : device
        );
      }

      if (deviceRefreshGenerationRef.current === deviceGeneration) {
        setDevices(refreshedDevices);
      }
      await api
        .writeActivityEvent(
          "success",
          "iPhone",
          hadConnectedDevice ? deviceActivityMessages.updated : deviceActivityMessages.connected
        )
        .catch(() => undefined);
      await refreshLogs();
    } catch (caught) {
      const normalized = normalizeError(caught);
      if (deviceRefreshGenerationRef.current === deviceGeneration) {
        if (normalized.code === "NO_DEVICE" || detectedDevices?.length === 0) {
          await cancelDataSizeLoad();
          setDevices([]);
        } else if (detectedDevices) {
          setDevices(detectedDevices);
        }
      }
      setError(normalized);
      await api
        .writeActivityEvent(
          "error",
          "iPhone",
          deviceActivityMessages.refreshFailed,
          normalized.technicalMessage
        )
        .catch(() => undefined);
      await refreshLogs();
    } finally {
      deviceRefreshInProgressRef.current = false;
      setDeviceRefreshing(false);
    }
  }

  async function handleUseSavedAppleSession() {
    setAuthLoading(true);
    setError(null);
    try {
      setAuthStatus(await api.useSavedAppleSession());
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setAuthLoading(false);
      void refreshLogs();
    }
  }

  function forgetAppleSession() {
    setPendingConfirmation({
      kind: "forgetSession",
      message: forgetAppleSessionConfirmation(t),
      confirmLabel: t("download.auth.forget")
    });
  }

  async function performForgetAppleSession() {
    setAuthLoading(true);
    setError(null);
    try {
      setAuthStatus(await api.forgetAppleSession());
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setAuthLoading(false);
      void refreshLogs();
    }
  }

  async function scanApps() {
    const scanGeneration = scanGenerationRef.current + 1;
    scanGenerationRef.current = scanGeneration;
    activeIconBatchRef.current = null;
    await cancelDataSizeLoad();
    setScanning(true);
    setError(null);
    try {
      let device = sourceDevice;
      if (!device || device.trustStatus !== "connected") {
        const detected = await api.detectDevices();
        if (scanGenerationRef.current !== scanGeneration) {
          return;
        }
        setDevices(detected);
        device = detected[0] ?? null;
      }

      if (!device) {
        setError({ code: "NO_DEVICE", userMessage: t("error.noDevice") });
        return;
      }

      const scanned = await api.scanInstalledApps(device.udid);
      if (scanGenerationRef.current !== scanGeneration) {
        return;
      }
      setApps(scanned);
      setLastScanAt(new Date().toISOString());
      setSelectedBundleIds(new Set());
      iconRenderRetryRef.current.clear();
      void fetchIcons(scanned, device.udid);
    } catch (caught) {
      if (scanGenerationRef.current === scanGeneration) {
        setError(normalizeError(caught));
      }
    } finally {
      if (scanGenerationRef.current === scanGeneration) {
        setScanning(false);
      }
      void refreshLogs();
    }
  }

  async function loadDataSizes() {
    if (dataSizesLoading) {
      return;
    }
    const device = sourceDevice;
    if (!device || device.trustStatus !== "connected" || apps.length === 0) {
      setError({ code: "NO_DEVICE", userMessage: t("error.noDevice") });
      return;
    }

    const batchId = crypto.randomUUID();
    const generation = dataSizeGenerationRef.current + 1;
    const scanGeneration = scanGenerationRef.current;
    dataSizeGenerationRef.current = generation;
    activeDataSizeBatchRef.current = batchId;
    setDataSizesLoading(true);
    setError(null);
    setWarning(null);
    setApps((current) =>
      current.map((app) => ({
        ...app,
        dynamicDiskUsageBytes: null,
        totalDiskUsageBytes: null,
        dataSizeStatus: "loading"
      }))
    );

    try {
      const result = await api.fetchAppDataSizes(
        device.udid,
        apps.map((app) => app.bundleId),
        batchId
      );
      if (
        result.cancelled ||
        result.batchId !== activeDataSizeBatchRef.current ||
        dataSizeGenerationRef.current !== generation ||
        scanGenerationRef.current !== scanGeneration
      ) {
        return;
      }
      mergeDataSizeResults(result.items);
    } catch {
      if (
        activeDataSizeBatchRef.current !== batchId ||
        dataSizeGenerationRef.current !== generation ||
        scanGenerationRef.current !== scanGeneration
      ) {
        return;
      }
      setWarning(t("warning.dataSizesUnavailable"));
      setApps((current) =>
        current.map((app) =>
          app.dataSizeStatus === "loading" ? { ...app, dataSizeStatus: "unavailable" } : app
        )
      );
    } finally {
      if (
        activeDataSizeBatchRef.current === batchId &&
        dataSizeGenerationRef.current === generation
      ) {
        activeDataSizeBatchRef.current = null;
        setDataSizesLoading(false);
      }
      void refreshLogs();
    }
  }

  function mergeDataSizeResults(results: AppDataSizeResult[]) {
    const byBundleId = new Map(results.map((result) => [result.bundleId, result]));
    setApps((current) =>
      current.map((app) => {
        const result = byBundleId.get(app.bundleId);
        if (!result) {
          return app.dataSizeStatus === "loading"
            ? { ...app, dataSizeStatus: "unavailable" }
            : app;
        }
        const dynamicUsage = result.dynamicDiskUsageBytes ?? null;
        const totalUsage =
          app.staticDiskUsageBytes != null && dynamicUsage != null
            ? app.staticDiskUsageBytes + dynamicUsage
            : null;
        return {
          ...app,
          dynamicDiskUsageBytes: dynamicUsage,
          totalDiskUsageBytes: totalUsage,
          dataSizeStatus: result.status
        };
      })
    );
  }

  async function fetchIcons(scannedApps: AppInfo[], deviceId: string) {
    const batchId = crypto.randomUUID();
    activeIconBatchRef.current = batchId;
    setWarning(null);
    setApps((current) =>
      current.map((app) =>
        app.iconPath
          ? app
          : {
              ...app,
              iconStatus: "loading",
              iconError: null
            }
      )
    );

    const unlisten = await listen<AppIconResult>(
      "app-icon-result",
      (event) => {
        if (event.payload.batchId !== activeIconBatchRef.current) {
          return;
        }
        mergeIconResult(event.payload);
      }
    );

    try {
      const icons = await api.fetchAppIcons(
        deviceId,
        scannedApps.map((app) => app.bundleId),
        batchId
      );
      icons.forEach(mergeIconResult);
      if (icons.some((icon) => icon.status === "failed" || icon.status === "fallback")) {
        setWarning(t("warning.iconsUnavailable"));
      }
    } catch {
      setWarning(t("warning.iconsUnavailable"));
      setApps((current) =>
        current.map((app) =>
          app.iconStatus === "loading"
            ? {
                ...app,
                iconStatus: "fallback",
                iconError: t("warning.iconsUnavailable")
              }
            : app
        )
      );
    } finally {
      unlisten();
      if (activeIconBatchRef.current === batchId) {
        activeIconBatchRef.current = null;
      }
      void refreshLogs();
    }
  }

  function mergeIconResult(icon: AppIconResult) {
    const iconStatus = icon.status;
    const hasRealIcon = iconStatus === "cached" || iconStatus === "loaded";
    setApps((current) =>
      current.map((app) =>
        app.bundleId === icon.bundleId
          ? {
              ...app,
              iconPath: hasRealIcon ? icon.iconPath ?? null : null,
              iconUpdatedAt: hasRealIcon ? icon.iconUpdatedAt ?? null : null,
              iconCacheVersion: hasRealIcon ? icon.iconCacheVersion ?? null : null,
              iconStatus,
              iconError: icon.iconError ?? null
            }
          : app
      )
    );
  }

  async function handleIconRenderError(bundleId: string, renderUrl: string) {
    const renderUrlType = renderUrl.includes(":") ? renderUrl.split(":")[0] : "unknown";
    void api.writeActivityEvent(
      "warning",
      t("activity.iconsTask"),
      t("activity.iconRenderFailed", { bundleId }),
      `bundleId: ${bundleId}\nrenderUrlType: ${renderUrlType}`
    );

    if (iconRenderRetryRef.current.has(bundleId)) {
      setApps((current) =>
        current.map((app) =>
          app.bundleId === bundleId
            ? {
                ...app,
                iconPath: null,
                iconUpdatedAt: null,
                iconCacheVersion: null,
                iconStatus: "failed",
                iconError: t("warning.iconRenderFailed")
              }
            : app
        )
      );
      void refreshLogs();
      return;
    }

    iconRenderRetryRef.current.add(bundleId);
    setApps((current) =>
      current.map((app) =>
        app.bundleId === bundleId
          ? {
              ...app,
              iconPath: null,
              iconUpdatedAt: null,
              iconCacheVersion: null,
              iconStatus: "loading",
              iconError: null
            }
          : app
      )
    );

    try {
      const result = await api.refetchAppIcon(sourceDevice?.udid, bundleId, activeIconBatchRef.current ?? undefined);
      mergeIconResult(result);
      if (!result.ok) {
        setWarning(t("warning.iconsUnavailable"));
      }
    } catch {
      setApps((current) =>
        current.map((app) =>
          app.bundleId === bundleId
            ? {
                ...app,
                iconPath: null,
                iconUpdatedAt: null,
                iconCacheVersion: null,
                iconStatus: "failed",
                iconError: t("warning.iconRenderFailed")
              }
            : app
        )
      );
      setWarning(t("warning.iconsUnavailable"));
    } finally {
      void refreshLogs();
    }
  }

  async function downloadSelected() {
    if (!hasUsableAppleSession(authStatus)) {
      setError({
        code: "AUTH_REQUIRED",
        userMessage: appleAuthBlockedReason(authStatus, t) ?? t("error.authRequired")
      });
      return;
    }
    const visibleAuthState = authStatus?.state ?? "notSignedIn";

    const selectedApps = apps.filter((app) => selectedBundleIds.has(app.bundleId));
    if (selectedApps.length === 0) {
      setError({ code: "NO_SELECTION", userMessage: t("error.noAppSelection") });
      void api.writeActivityEvent("warning", t("activity.downloadTask"), t("activity.downloadBlockedSelection"));
      return;
    }

    setDownloading(true);
    setError(null);
    let failed = false;

    for (const appInfo of selectedApps) {
      setDownloadProgress((current) => ({ ...current, [appInfo.bundleId]: "downloading" }));
      try {
        const result = await api.downloadIpa(
          appInfo.bundleId,
          appInfo.name,
          sourceDevice?.name ?? undefined,
          visibleAuthState
        );
        if (result.item) {
          upsertLibraryItem(result.item);
        } else {
          await reconcileLibrary();
        }
        setDownloadProgress((current) => omitRecordKey(current, appInfo.bundleId));
      } catch (caught) {
        failed = true;
        setDownloadProgress((current) => ({ ...current, [appInfo.bundleId]: "failed" }));
        const normalized = normalizeError(caught);
        if (normalized.code === "AUTH_REQUIRED") {
          try {
            const latestAuth = await api.getAppleAuthStatus();
            setAuthStatus(latestAuth);
            setError({
              ...normalized,
              code: latestAuth.state === "sessionExpired" ? "AUTH_SESSION_EXPIRED" : normalized.code,
              userMessage: appleAuthBlockedReason(latestAuth, t) ?? normalized.userMessage
            });
          } catch {
            setAuthStatus({ state: "sessionExpired" });
            setError({
              ...normalized,
              code: "AUTH_SESSION_EXPIRED",
              userMessage: t("download.block.signInAgain")
            });
          }
          break;
        }
        setError(normalized);
      }
    }

    setDownloading(false);
    setSelectedIpaIds(new Set());
    if (!failed) {
      setActiveStep(1);
    }
    void refreshLogs();
  }

  async function installSelected() {
    if (!targetDevice) {
      setError({ code: "NO_DEVICE", userMessage: t("error.noDevice") });
      return;
    }

    const selected = ipas.filter((ipa) => selectedIpaIds.has(ipa.id));
    if (selected.length === 0) {
      setError({ code: "NO_SELECTION", userMessage: t("error.noIpaSelection") });
      return;
    }
    if (selected.some((ipa) => ipa.status === "missing")) {
      setError({ code: "IPA_MISSING", userMessage: t("error.ipaMissing") });
      return;
    }

    setInstalling(true);
    setError(null);

    for (const ipa of selected) {
      setInstallStatuses((current) => ({ ...current, [ipa.id]: "installing" }));
      try {
        await api.installIpa(targetDevice.udid, ipa.id);
        setInstallStatuses((current) => ({ ...current, [ipa.id]: "installed" }));
      } catch (caught) {
        setInstallStatuses((current) => ({ ...current, [ipa.id]: "failed" }));
        setError(normalizeError(caught));
      }
    }

    setInstalling(false);
    void refreshLogs();
  }

  function toggleApp(bundleId: string) {
    setSelectedBundleIds((current) => {
      const next = new Set(current);
      if (next.has(bundleId)) {
        next.delete(bundleId);
      } else {
        next.add(bundleId);
      }
      return next;
    });
  }

  function toggleIpa(ipaId: string) {
    setSelectedIpaIds((current) => {
      const next = new Set(current);
      if (next.has(ipaId)) {
        next.delete(ipaId);
      } else {
        next.add(ipaId);
      }
      return next;
    });
  }

  function selectVisibleApps(bundleIds: string[]) {
    setSelectedBundleIds((current) => {
      const next = new Set(current);
      bundleIds.forEach((bundleId) => next.add(bundleId));
      return next;
    });
  }

  function clearAppSelection() {
    setSelectedBundleIds(new Set());
  }

  function selectAllIpas(ipaIds: string[]) {
    setSelectedIpaIds(new Set(ipaIds));
  }

  function clearIpaSelection() {
    setSelectedIpaIds(new Set());
  }

  function deleteIpasFromLibrary(ipaIds: string[]) {
    if (ipaIds.length === 0) {
      return;
    }

    const selected = ipas.filter((ipa) => ipaIds.includes(ipa.id));
    const allMissing = selected.length > 0 && selected.every((ipa) => ipa.status === "missing");
    setPendingConfirmation({
      kind: "deleteIpas",
      message: deleteIpasConfirmation(allMissing, t),
      confirmLabel:
        allMissing && ipaIds.length === 1
          ? t("library.removeEntry")
          : allMissing
            ? t("target.removeEntries")
            : t("target.deleteSelected"),
      ipaIds,
      allMissing
    });
  }

  async function performDeleteIpasFromLibrary(ipaIds: string[]) {
    setError(null);
    const previousIpas = ipas;
    const previousSelectedIpaIds = selectedIpaIds;
    const previousDownloadProgress = downloadProgress;
    const previousInstallStatuses = installStatuses;
    const removedIds = new Set(ipaIds);
    const removedBundleIds = new Set(
      ipas.filter((ipa) => removedIds.has(ipa.id)).map((ipa) => ipa.bundleId)
    );
    removeLibraryItems(removedIds);
    setSelectedIpaIds((current) => new Set([...current].filter((id) => !removedIds.has(id))));
    setInstallStatuses((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id)))
    );
    setDownloadProgress((current) =>
      Object.fromEntries(Object.entries(current).filter(([bundleId]) => !removedBundleIds.has(bundleId)))
    );

    try {
      const updated = await api.deleteLocalIpas(ipaIds);
      replaceLibrary(updated);
    } catch (caught) {
      replaceLibrary(previousIpas);
      setSelectedIpaIds(previousSelectedIpaIds);
      setDownloadProgress(previousDownloadProgress);
      setInstallStatuses(previousInstallStatuses);
      setError(normalizeError(caught));
    } finally {
      void refreshLogs();
    }
  }

  function deleteSelectedIpasFromLibrary() {
    deleteIpasFromLibrary([...selectedIpaIds]);
  }

  function clearLogs() {
    setPendingConfirmation({
      kind: "clearLogs",
      message: clearLogsConfirmation(t),
      confirmLabel: t("log.clearLogs")
    });
  }

  async function performClearLogs() {
    setError(null);
    const previousLogs = logs;
    logClearInProgressRef.current = true;
    logRefreshGenerationRef.current += 1;
    setLogs([]);
    try {
      await api.clearActivityLogs();
    } catch (caught) {
      setLogs(previousLogs);
      setError(normalizeError(caught));
    } finally {
      logRefreshGenerationRef.current += 1;
      logClearInProgressRef.current = false;
    }
  }

  function confirmPendingAction() {
    const confirmation = pendingConfirmation;
    if (!confirmation) {
      return;
    }

    setPendingConfirmation(null);
    if (confirmation.kind === "forgetSession") {
      void performForgetAppleSession();
      return;
    }
    if (confirmation.kind === "clearLogs") {
      void performClearLogs();
      return;
    }
    void performDeleteIpasFromLibrary(confirmation.ipaIds);
  }

  async function openLibrary() {
    setError(null);
    try {
      await api.openLibraryFolder();
      await reconcileLibrary();
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      void refreshLogs();
    }
  }

  if (engineStatus && !engineStatus.ready) {
    return (
      <div className="setupShell">
        <section className="setupPanel">
          <AlertTriangle size={34} aria-hidden="true" />
          <h1>{t("app.name")}</h1>
          <p>{t("setup.missingEngine")}</p>
          <div className="missingList">
            {engineStatus.missing.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <MacButton
            type="button"
            onClick={() => {
              void api
                .getEngineStatus()
                .then(setEngineStatus)
                .catch((caught: unknown) => setError(normalizeError(caught)));
            }}
          >
            {t("setup.checkAgain")}
          </MacButton>
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </section>
      </div>
    );
  }

  return (
      <AppShell
      activeStep={activeStep}
      logs={logs}
      logOpen={logOpen}
      sidebarDevice={activeStep === 1 ? targetDevice : sourceDevice}
      sidebarRole={activeStep === 1 ? "target" : "source"}
      authStatus={authStatus}
      authLoading={authLoading}
      deviceRefreshing={deviceRefreshing}
      onStepClick={setActiveStep}
      onToggleLog={() => setLogOpen((open) => !open)}
      onRefreshDevice={() => {
        void refreshIphone();
      }}
      onOpenLibrary={() => {
        void openLibrary();
      }}
      onOpenSignIn={() => setAuthModalOpen(true)}
      onUseSavedSession={() => {
        void handleUseSavedAppleSession();
      }}
      onForgetSession={() => {
        void forgetAppleSession();
      }}
      onClearLogs={() => {
        void clearLogs();
      }}
      onLogsChanged={() => {
        void refreshLogs();
      }}
    >
      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {warning ? (
        <div className="warningBanner" role="status">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>{warning}</span>
          <button className="iconButton" type="button" onClick={() => setWarning(null)} aria-label={t("app.warning.dismiss")}>
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      {activeStep === 0 ? (
        <AppsDownloadScreen
          apps={apps}
          authStatus={authStatus}
          scanning={scanning}
          dataSizesLoading={dataSizesLoading}
          canLoadDataSizes={Boolean(sourceDevice && sourceDevice.trustStatus === "connected" && apps.length > 0)}
          appCount={apps.length}
          lastScanAt={lastScanAt}
          query={query}
          selectedBundleIds={selectedBundleIds}
          statuses={appStatuses}
          downloading={downloading}
          downloadBlockedReason={downloadBlockedReason}
          onScanApps={() => {
            void scanApps();
          }}
          onLoadDataSizes={() => {
            void loadDataSizes();
          }}
          onQueryChange={setQuery}
          onToggleApp={toggleApp}
          onSelectVisibleApps={selectVisibleApps}
          onClearAppSelection={clearAppSelection}
          onIconRenderError={(bundleId, renderUrl) => {
            void handleIconRenderError(bundleId, renderUrl);
          }}
          onDownloadSelected={() => {
            void downloadSelected();
          }}
        />
      ) : null}
      {activeStep === 1 ? (
        <TargetIPhoneScreen
          device={targetDevice}
          ipas={ipas}
          installing={installing}
          selectedIds={selectedIpaIds}
          statuses={installStatuses}
          query={ipaQuery}
          onQueryChange={setIpaQuery}
          onToggleIpa={toggleIpa}
          onSelectAllIpas={selectAllIpas}
          onClearIpaSelection={clearIpaSelection}
          onDeleteIpa={(ipaId) => {
            void deleteIpasFromLibrary([ipaId]);
          }}
          onDeleteSelectedIpas={() => {
            void deleteSelectedIpasFromLibrary();
          }}
          onInstallSelected={() => {
            void installSelected();
          }}
        />
      ) : null}
      {authModalOpen ? (
        <AppleAuthModal
          onClose={() => setAuthModalOpen(false)}
          onAuthStatus={setAuthStatus}
          onActivityChanged={() => {
            void refreshLogs();
          }}
        />
      ) : null}
      {pendingConfirmation ? (
        <MacConfirmationDialog
          message={pendingConfirmation.message}
          confirmLabel={pendingConfirmation.confirmLabel}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={confirmPendingAction}
        />
      ) : null}
    </AppShell>
  );
}

function omitRecordKey(
  record: Record<string, "downloading" | "failed">,
  key: string
): Record<string, "downloading" | "failed"> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}
