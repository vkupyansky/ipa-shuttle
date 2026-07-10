import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { languageLabel, languages, translate, type Language, type TranslationKey, type TranslationValues } from "../../i18n";
import { readStoredLanguage, writeStoredLanguage } from "../../lib/storage";

type LanguageContextValue = {
  language: Language;
  languages: typeof languages;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  languageLabel: (language: Language) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => readStoredLanguage());

  const value = useMemo<LanguageContextValue>(() => {
    function setLanguage(nextLanguage: Language) {
      writeStoredLanguage(nextLanguage);
      setLanguageState(nextLanguage);
    }

    return {
      language,
      languages,
      setLanguage,
      t: (key, values) => translate(language, key, values),
      languageLabel
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useI18n must be used inside LanguageProvider");
  }
  return context;
}
