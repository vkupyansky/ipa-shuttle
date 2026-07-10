import type { TranslationKey, TranslationValues } from "../i18n";
import type { LogEntry } from "./types";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export const deviceActivityMessages = {
  connected: "iPhone connected",
  disconnected: "iPhone disconnected",
  updated: "iPhone connection updated",
  refreshFailed: "Could not refresh iPhone connection"
} as const;

const taskKeys: Partial<Record<string, TranslationKey>> = {
  Application: "activity.task.Application",
  iPhone: "activity.task.iPhone",
  Apps: "activity.task.Apps",
  "App Icons": "activity.iconsTask",
  "Apple ID": "activity.task.Apple ID",
  Download: "activity.downloadTask",
  Install: "activity.task.Install",
  "IPA Library": "activity.task.IPA Library",
  "Internal Engine": "activity.task.Internal Engine"
};

const exactMessageKeys: Partial<Record<string, TranslationKey>> = {
  "App started": "activity.appStarted",
  "Checking connected iPhones": "activity.checkingIphones",
  [deviceActivityMessages.connected]: "activity.iphoneConnected",
  [deviceActivityMessages.disconnected]: "activity.iphoneDisconnected",
  [deviceActivityMessages.updated]: "activity.iphoneConnectionUpdated",
  [deviceActivityMessages.refreshFailed]: "activity.iphoneRefreshFailed",
  "No iPhone connected": "activity.noIphone",
  "Checked connected iPhones": "activity.checkedIphones",
  "Read iPhone device information": "activity.readDeviceInfo",
  "Scanning installed apps": "activity.scanningApps",
  "Scanned installed iPhone apps": "activity.scannedIphoneApps",
  "Loading app data sizes": "activity.loadingDataSizes",
  "App data size loading cancelled": "activity.dataSizesCancelled",
  "App data sizes could not be loaded": "activity.dataSizesUnavailable",
  "App icons loaded": "activity.iconsLoaded",
  "App icons are unavailable, using fallback icons": "activity.iconsUnavailable",
  "Checking Apple ID status": "activity.appleChecking",
  "Saved Apple ID session available": "activity.appleSavedAvailable",
  "Saved Apple ID session locked": "auth.lockedTitle",
  "Apple ID session expired": "auth.expiredTitle",
  "Apple ID not signed in": "activity.appleNotSignedIn",
  "Using saved Apple ID session": "activity.appleUseSaved",
  "Forgot saved Apple ID session": "activity.appleForgot",
  "Apple ID signed in": "activity.appleSignedIn",
  "Started Apple ID sign-in": "activity.appleLoginStarted",
  "Cancelled Apple ID sign-in": "activity.appleLoginCancelled",
  "Completed Apple ID sign-in": "activity.appleLoginCompleted",
  "Completed Apple ID verification": "activity.appleVerificationCompleted",
  "Apple ID sign-in needs verification": "activity.appleNeedsVerification",
  "Download blocked: Apple ID not signed in": "activity.downloadBlockedAuth",
  "Download blocked: no apps selected": "activity.downloadBlockedSelection",
  "Apple no longer provides this app for this Apple ID": "activity.appUnavailable",
  "Opened IPA library folder": "activity.libraryOpened",
  "Installed IPA on target iPhone": "activity.installedOnTarget",
  "Internal engine timed out": "activity.engineTimedOut",
  "IPA download failed": "activity.ipaDownloadFailed"
};

export function localizeLogEntry(entry: LogEntry, t: Translate) {
  const taskKey = taskKeys[entry.taskName];
  const taskName = taskKey ? t(taskKey) : entry.taskName;
  return {
    ...entry,
    taskName,
    message: localizeMessage(entry.message, t)
  };
}

function localizeMessage(message: string, t: Translate) {
  const exactKey = exactMessageKeys[message];
  if (exactKey) {
    return t(exactKey);
  }

  const iphoneDetected = message.match(/^iPhone detected: (.+)$/);
  if (iphoneDetected?.[1]) {
    return t("activity.iphoneDetected", { name: iphoneDetected[1] });
  }

  const scanCompleted = message.match(/^Scan completed: (\d+) apps found$/);
  if (scanCompleted?.[1]) {
    return t("activity.scanCompleted", { count: scanCompleted[1] });
  }

  const appListDisplayed = message.match(/^App list displayed: (\d+) apps$/);
  if (appListDisplayed?.[1]) {
    return t("activity.appListDisplayed", { count: appListDisplayed[1] });
  }

  const dataSizesLoaded = message.match(/^App data sizes loaded: (\d+) apps$/);
  if (dataSizesLoaded?.[1]) {
    return t("activity.dataSizesLoaded", { count: dataSizesLoaded[1] });
  }

  const downloading = message.match(/^Downloading IPA: (.+)$/);
  if (downloading?.[1]) {
    return t("activity.downloadingIpa", { name: downloading[1] });
  }

  const downloaded = message.match(/^IPA downloaded: (.+)$/);
  if (downloaded?.[1]) {
    return t("activity.ipaDownloaded", { name: downloaded[1] });
  }

  const installing = message.match(/^Installing IPA: (.+)$/);
  if (installing?.[1]) {
    return t("activity.installingIpa", { name: installing[1] });
  }

  const installed = message.match(/^IPA installed: (.+)$/);
  if (installed?.[1]) {
    return t("activity.ipaInstalled", { name: installed[1] });
  }

  const iconRefetched = message.match(/^Icon refetch: (.+)$/);
  if (iconRefetched?.[1]) {
    return t("activity.iconRefetched", { bundleId: iconRefetched[1] });
  }

  const iconRefetchFailed = message.match(/^Icon refetch failed: (.+)$/);
  if (iconRefetchFailed?.[1]) {
    return t("activity.iconRefetchFailed", { bundleId: iconRefetchFailed[1] });
  }

  const deleted = message.match(/^Deleted (\d+) IPA library items?$/);
  if (deleted?.[1]) {
    return t("activity.libraryDeleted", { count: deleted[1] });
  }

  return message;
}
