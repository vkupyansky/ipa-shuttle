import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import en from "../src/i18n/locales/en.json" with { type: "json" };
import ru from "../src/i18n/locales/ru.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localeKeys = new Set(Object.keys(en));
const sourceExtensions = new Set([".ts", ".tsx"]);
const ignoredSourceParts = [
  `${path.sep}src${path.sep}i18n${path.sep}locales${path.sep}`,
  `${path.sep}src${path.sep}test${path.sep}`
];
const ignoredSourceSuffixes = [".test.ts", ".test.tsx", "vite-env.d.ts"];

const backendDisplayMessages = [
  "App started",
  "Checking connected iPhones",
  "No iPhone connected",
  "Checked connected iPhones",
  "Read iPhone device information",
  "iPhone detected:",
  "Scanning installed apps",
  "Scanned installed iPhone apps",
  "Loading app data sizes",
  "App data sizes loaded:",
  "App data size loading cancelled",
  "App data sizes could not be loaded",
  "Scan completed:",
  "App list displayed:",
  "App icons are unavailable, using fallback icons",
  "App icons loaded",
  "Checking Apple ID status",
  "Saved Apple ID session available",
  "Apple ID not signed in",
  "Using saved Apple ID session",
  "Forgot saved Apple ID session",
  "Apple ID signed in",
  "Started Apple ID sign-in",
  "Cancelled Apple ID sign-in",
  "Completed Apple ID sign-in",
  "Completed Apple ID verification",
  "Apple ID sign-in needs verification",
  "Download blocked: Apple ID not signed in",
  "Download blocked: no apps selected",
  "Downloading IPA:",
  "IPA downloaded:",
  "Apple no longer provides this app for this Apple ID",
  "Installing IPA:",
  "IPA installed:",
  "Installed IPA on target iPhone",
  "Internal engine timed out",
  "IPA download failed",
  "Icon refetch:",
  "Icon refetch failed:",
  "Opened IPA library folder",
  "Deleted"
];

const backendCoverageKeys = [
  "activity.appStarted",
  "activity.checkingIphones",
  "activity.noIphone",
  "activity.checkedIphones",
  "activity.readDeviceInfo",
  "activity.iphoneDetected",
  "activity.scanningApps",
  "activity.scannedIphoneApps",
  "activity.loadingDataSizes",
  "activity.dataSizesLoaded",
  "activity.dataSizesCancelled",
  "activity.dataSizesUnavailable",
  "activity.scanCompleted",
  "activity.appListDisplayed",
  "activity.iconsUnavailable",
  "activity.iconsLoaded",
  "activity.appleChecking",
  "activity.appleSavedAvailable",
  "activity.appleNotSignedIn",
  "activity.appleUseSaved",
  "activity.appleForgot",
  "activity.appleSignedIn",
  "activity.appleLoginStarted",
  "activity.appleLoginCancelled",
  "activity.appleLoginCompleted",
  "activity.appleVerificationCompleted",
  "activity.appleNeedsVerification",
  "activity.downloadBlockedAuth",
  "activity.downloadBlockedSelection",
  "activity.downloadingIpa",
  "activity.ipaDownloaded",
  "activity.appUnavailable",
  "activity.installingIpa",
  "activity.ipaInstalled",
  "activity.installedOnTarget",
  "activity.engineTimedOut",
  "activity.ipaDownloadFailed",
  "activity.iconRefetched",
  "activity.iconRefetchFailed",
  "activity.libraryOpened",
  "activity.libraryDeleted"
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "target", ".git"].includes(entry.name)) {
        return [];
      }
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function sortedKeys(messages) {
  return Object.keys(messages).sort();
}

function checkDictionaries() {
  const enKeys = sortedKeys(en);
  const ruKeys = sortedKeys(ru);
  const missingInRu = enKeys.filter((key) => !ruKeys.includes(key));
  const missingInEn = ruKeys.filter((key) => !enKeys.includes(key));

  if (missingInRu.length > 0 || missingInEn.length > 0) {
    return [
      ...missingInRu.map((key) => `Missing in ru: ${key}`),
      ...missingInEn.map((key) => `Missing in en: ${key}`)
    ];
  }
  return [];
}

function sourceFiles() {
  return walk(path.join(root, "src")).filter((file) => {
    const ext = path.extname(file);
    return (
      sourceExtensions.has(ext) &&
      !ignoredSourceParts.some((part) => file.includes(part)) &&
      !ignoredSourceSuffixes.some((suffix) => file.endsWith(suffix))
    );
  });
}

function collectUsedKeys() {
  const used = new Set();
  for (const file of sourceFiles()) {
    const raw = fs.readFileSync(file, "utf8");
    for (const key of localeKeys) {
      if (raw.includes(`"${key}"`) || raw.includes(`'${key}'`)) {
        used.add(key);
      }
    }
  }
  return used;
}

function auditUnusedKeys(usedKeys) {
  return [...localeKeys]
    .filter((key) => !usedKeys.has(key))
    .sort()
    .map((key) => `Unused translation key: ${key}`);
}

function auditJsxText() {
  const violations = [];
  const jsxTextPattern = />\s*([^<>{}\n]*[A-Za-zА-Яа-я][^<>{}\n]*)\s*</g;
  for (const file of sourceFiles().filter((source) => source.endsWith(".tsx"))) {
    const raw = fs.readFileSync(file, "utf8");
    let match;
    while ((match = jsxTextPattern.exec(raw))) {
      const text = match[1].replace(/\s+/g, " ").trim();
      if (!text || text === "IPA") {
        continue;
      }
      if (/[="?&|]/.test(text)) {
        continue;
      }
      const line = raw.slice(0, match.index).split("\n").length;
      violations.push(`${path.relative(root, file)}:${line}: hardcoded JSX text: ${text}`);
    }
  }
  return violations;
}

function auditBackendCoverage() {
  const missingKeys = backendCoverageKeys.filter((key) => !localeKeys.has(key));
  return missingKeys.map((key) => `Backend display message is missing locale key: ${key}`);
}

const dictionaryErrors = checkDictionaries();
const usedKeys = collectUsedKeys();
const unusedKeyErrors = auditUnusedKeys(usedKeys);
const jsxErrors = auditJsxText();
const backendErrors = auditBackendCoverage();
const errors = [...dictionaryErrors, ...unusedKeyErrors, ...jsxErrors, ...backendErrors];

if (errors.length > 0) {
  console.error("i18n audit failed.");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `i18n audit passed: ${localeKeys.size} keys, ${usedKeys.size} used, ${backendDisplayMessages.length} backend display patterns covered.`
);
