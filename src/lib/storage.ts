import { detectDefaultLanguage, isLanguage, type Language } from "../i18n";

const languageKey = "ipa-shuttle.language";

export function readStoredLanguage(): Language {
  const stored = window.localStorage.getItem(languageKey);
  return isLanguage(stored) ? stored : detectDefaultLanguage();
}

export function writeStoredLanguage(language: Language) {
  window.localStorage.setItem(languageKey, language);
}
