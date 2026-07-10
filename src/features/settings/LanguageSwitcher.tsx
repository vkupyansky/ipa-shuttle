import { useI18n } from "../../app/providers/LanguageProvider";

export function LanguageSwitcher() {
  const { language, languages, setLanguage, t } = useI18n();

  return (
    <div className="languageSwitcher" aria-label={t("sidebar.language")}>
      <div className="languageSwitcher__control">
        {languages.map((candidate) => (
          <button
            key={candidate}
            className={candidate === language ? "is-active" : ""}
            type="button"
            aria-label={candidate === "en" ? t("language.english") : t("language.russian")}
            title={candidate === "en" ? t("language.english") : t("language.russian")}
            onClick={() => setLanguage(candidate)}
          >
            <span aria-hidden="true">{languageFlag(candidate)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function languageFlag(language: "en" | "ru") {
  return language === "ru" ? "🇷🇺" : "🇺🇸";
}
