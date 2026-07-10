import { useState } from "react";
import { CheckCircle2, LockKeyhole, X } from "lucide-react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { api } from "../../lib/api";
import { toAppError } from "../../lib/result";
import type { AppError, AuthFlowResult, AuthSessionState } from "../../lib/types";
import { ErrorBanner } from "../../components/mac/ErrorBanner";
import { MacButton } from "../../components/mac/MacButton";
import { MacStatusPill } from "../../components/mac/MacStatusPill";

type AuthModalStep = "credentials" | "verification_code" | "success" | "error";

type Props = {
  onClose: () => void;
  onAuthStatus: (status: AuthSessionState) => void;
  onActivityChanged: () => void;
};

function errorFromResult(result: AuthFlowResult, fallbackMessage: string): AppError {
  return {
    code: result.errorCode || "AUTH_FAILED",
    userMessage: fallbackMessage
  };
}

export function AppleAuthModal({ onClose, onAuthStatus, onActivityChanged }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState<AuthModalStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [successAccount, setSuccessAccount] = useState<string | null>(null);

  async function finishSuccess(result: AuthFlowResult) {
    const status = await api.getAppleAuthStatus();
    onAuthStatus(status);
    setSuccessAccount(result.account || status.account || null);
    setStep("success");
  }

  async function startLogin() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.startAppleLogin(email, password, remember);
      setPassword("");

      if (result.state === "verificationRequired") {
        setStep("verification_code");
        setError(null);
        return;
      }

      if (result.state === "success" && result.signedIn) {
        await finishSuccess(result);
        return;
      }

      setStep("error");
      setError(errorFromResult(result, t("auth.modal.failed")));
    } catch (caught) {
      setPassword("");
      setStep("error");
      setError(toAppError(caught, t("auth.modal.failed"), "AUTH_FAILED"));
    } finally {
      setLoading(false);
      onActivityChanged();
    }
  }

  async function verifyCode() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.submitAppleVerificationCode(code);
      setCode("");

      if (result.state === "success" && result.signedIn) {
        await finishSuccess(result);
        return;
      }

      if (result.state === "verificationRequired") {
        setStep("verification_code");
        setError({
          code: "AUTH_CODE_REQUIRED",
          userMessage: t("auth.modal.enterCode")
        });
        return;
      }

      setStep("error");
      setError(errorFromResult(result, t("auth.modal.failed")));
    } catch (caught) {
      setCode("");
      setStep("error");
      setError(toAppError(caught, t("auth.modal.failed"), "AUTH_FAILED"));
    } finally {
      setLoading(false);
      onActivityChanged();
    }
  }

  async function closeModal() {
    setPassword("");
    setCode("");
    if (step === "verification_code") {
      try {
        await api.cancelAppleLogin();
      } catch {
        // The session may already have exited; closing the modal should still succeed.
      }
      onActivityChanged();
    }
    onClose();
  }

  return (
    <div className="modalOverlay" role="presentation">
      <section className="authModal" role="dialog" aria-modal="true" aria-labelledby="apple-auth-title">
        <div className="authModal__header">
          <div className="authModal__icon" aria-hidden="true">
            {step === "success" ? <CheckCircle2 size={24} /> : <LockKeyhole size={24} />}
          </div>
          <div>
            <p className="eyebrow">{t("download.auth.appleId")}</p>
            <h2 id="apple-auth-title">{t("auth.modal.title")}</h2>
          </div>
          <MacStatusPill tone={step === "success" ? "success" : step === "error" ? "danger" : "progress"}>
            {step === "credentials"
              ? t("auth.modal.credentials")
              : step === "verification_code"
                ? t("auth.modal.verification")
                : step === "success"
                  ? t("auth.signedInBadge")
                  : t("auth.modal.error")}
          </MacStatusPill>
          <button
            className="iconButton"
            type="button"
            onClick={() => void closeModal()}
            aria-label={t("auth.modal.closeLabel")}
            disabled={loading}
          >
            <X size={18} />
          </button>
        </div>

        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {step === "credentials" ? (
          <form
            className="authModal__form"
            onSubmit={(event) => {
              event.preventDefault();
              void startLogin();
            }}
          >
            <label>
              <span>{t("auth.modal.email")}</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              <span>{t("auth.modal.password")}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label className="authModal__checkbox">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              <span>{t("auth.modal.remember")}</span>
            </label>
            <p className="authModal__note">{t("auth.modal.note")}</p>
            <p className="authModal__note">{t("auth.modal.localSigningNote")}</p>
            <div className="authModal__actions">
              <MacButton type="button" variant="secondary" onClick={() => void closeModal()} disabled={loading}>
                {t("auth.modal.cancel")}
              </MacButton>
              <MacButton type="submit" disabled={loading}>
                {loading ? t("auth.modal.signingIn") : t("auth.modal.continue")}
              </MacButton>
            </div>
          </form>
        ) : null}

        {step === "verification_code" ? (
          <form
            className="authModal__form"
            onSubmit={(event) => {
              event.preventDefault();
              void verifyCode();
            }}
          >
            <label>
              <span>{t("auth.modal.code")}</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
              />
            </label>
            <div className="authModal__actions">
              <MacButton type="button" variant="secondary" onClick={() => void closeModal()} disabled={loading}>
                {t("auth.modal.cancel")}
              </MacButton>
              <MacButton type="submit" disabled={loading || code.length !== 6}>
                {loading ? t("auth.modal.verifying") : t("auth.modal.verify")}
              </MacButton>
            </div>
          </form>
        ) : null}

        {step === "success" ? (
          <div className="authModal__result">
            <strong>{successAccount || t("auth.modal.success")}</strong>
            <MacButton type="button" onClick={() => void closeModal()}>
              {t("auth.modal.done")}
            </MacButton>
          </div>
        ) : null}

        {step === "error" ? (
          <div className="authModal__actions">
            <MacButton type="button" variant="secondary" onClick={() => void closeModal()}>
              {t("auth.modal.close")}
            </MacButton>
            <MacButton
              type="button"
              onClick={() => {
                setPassword("");
                setCode("");
                setError(null);
                setStep("credentials");
              }}
            >
              {t("auth.modal.tryAgain")}
            </MacButton>
          </div>
        ) : null}
      </section>
    </div>
  );
}
