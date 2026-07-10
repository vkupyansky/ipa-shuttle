import en from "./locales/en.json";
import ru from "./locales/ru.json";

export const languages = ["en", "ru"] as const;
export type Language = (typeof languages)[number];
export type TranslationKey = keyof typeof en;
export type TranslationValues = Record<string, string | number>;

const dictionaries: Record<Language, typeof en> = {
  en,
  ru
};

export function isLanguage(value: string | null | undefined): value is Language {
  return value === "en" || value === "ru";
}

export function detectDefaultLanguage() {
  const locale = navigator.language || "";
  return locale.toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function translate(language: Language, key: TranslationKey, values?: TranslationValues) {
  const template = dictionaries[language][key];
  if (!values) {
    return template;
  }

  return Object.entries(values).reduce((message, [name, value]) => {
    return message.replaceAll(`{${name}}`, String(value));
  }, template);
}

export function languageLabel(language: Language) {
  return language.toUpperCase();
}
