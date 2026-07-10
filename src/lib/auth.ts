import type { AuthSessionState } from "./types";
import type { TranslationKey, TranslationValues } from "../i18n";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;

export function hasUsableAppleSession(status: AuthSessionState | null | undefined) {
  return status?.state === "signedIn";
}

export function appleAuthBlockedReason(status: AuthSessionState | null | undefined, t: Translate) {
  if (hasUsableAppleSession(status)) {
    return null;
  }

  if (status?.state === "savedSessionAvailable" || status?.state === "savedSessionLocked") {
    return t("download.block.useSaved");
  }

  if (status?.state === "sessionExpired") {
    return t("download.block.signInAgain");
  }

  return t("download.block.signIn");
}
