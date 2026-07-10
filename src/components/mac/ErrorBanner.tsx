import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { localizedErrorMessage } from "../../lib/localizedError";
import type { AppError } from "../../lib/types";

type Props = {
  error: AppError | null;
  onDismiss?: () => void;
};

export function ErrorBanner({ error, onDismiss }: Props) {
  const { t } = useI18n();

  if (!error) {
    return null;
  }

  return (
    <div className="errorBanner" role="alert">
      <AlertTriangle aria-hidden="true" size={18} />
      <span>{localizedErrorMessage(error, t)}</span>
      {onDismiss ? (
        <button className="iconButton" type="button" onClick={onDismiss} aria-label={t("app.error.dismiss")}>
          <X aria-hidden="true" size={16} />
        </button>
      ) : null}
    </div>
  );
}
