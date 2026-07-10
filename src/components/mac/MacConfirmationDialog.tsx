import { useEffect, useRef } from "react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { MacButton } from "./MacButton";

type Props = {
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function MacConfirmationDialog({ message, confirmLabel, onCancel, onConfirm }: Props) {
  const { t } = useI18n();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <section className="confirmationDialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title">
        <h2 id="confirmation-title">{t("confirm.title")}</h2>
        <p>{message}</p>
        <div className="confirmationDialog__actions">
          <MacButton ref={cancelButtonRef} type="button" variant="secondary" onClick={onCancel}>
            {t("confirm.cancel")}
          </MacButton>
          <MacButton type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </MacButton>
        </div>
      </section>
    </div>
  );
}
