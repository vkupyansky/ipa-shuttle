import type { TranslationKey, TranslationValues } from "../i18n";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export function deleteIpasConfirmation(allMissing: boolean, t: Translate) {
  return allMissing ? t("confirm.removeMissingEntries") : t("confirm.deleteIpas");
}

export function clearLogsConfirmation(t: Translate) {
  return t("confirm.clearLogs");
}

export function forgetAppleSessionConfirmation(t: Translate) {
  return t("confirm.forgetSession");
}
