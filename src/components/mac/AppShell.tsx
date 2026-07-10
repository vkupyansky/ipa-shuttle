import type { ReactNode } from "react";
import { FolderOpen, LockKeyhole, RefreshCw, UserRound } from "lucide-react";
import { MacActivityLog } from "../activity-log/MacActivityLog";
import { DevicePreview } from "../device/DevicePreview";
import { MacButton } from "./MacButton";
import { MacSegmentedControl } from "./MacSegmentedControl";
import { MacStatusPill } from "./MacStatusPill";
import type { AuthSessionState, Device, LogEntry } from "../../lib/types";
import { hasUsableAppleSession } from "../../lib/auth";
import { useI18n } from "../../app/providers/LanguageProvider";
import { LanguageSwitcher } from "../../features/settings/LanguageSwitcher";

type Props = {
  activeStep: number;
  logs: LogEntry[];
  logOpen: boolean;
  sidebarDevice: Device | null;
  sidebarRole: "source" | "target";
  authStatus: AuthSessionState | null;
  authLoading: boolean;
  deviceRefreshing: boolean;
  onStepClick: (step: number) => void;
  onToggleLog: () => void;
  onRefreshDevice: () => void;
  onOpenLibrary: () => void;
  onOpenSignIn: () => void;
  onUseSavedSession: () => void;
  onForgetSession: () => void;
  onClearLogs: () => void;
  onLogsChanged: () => void;
  children: ReactNode;
};

export function AppShell({
  activeStep,
  logs,
  logOpen,
  sidebarDevice,
  sidebarRole,
  authStatus,
  authLoading,
  deviceRefreshing,
  onStepClick,
  onToggleLog,
  onRefreshDevice,
  onOpenLibrary,
  onOpenSignIn,
  onUseSavedSession,
  onForgetSession,
  onClearLogs,
  onLogsChanged,
  children
}: Props) {
  const { t } = useI18n();
  const steps = [{ label: t("step.apps") }, { label: t("step.install") }];

  return (
    <div className="appShell">
      <aside className="appSidebar">
        <div className="sidebarHeader">
          <strong>{t("app.name")}</strong>
          <LanguageSwitcher />
        </div>
        <DevicePreview device={sidebarDevice} role={sidebarRole} />
        <MacButton
          type="button"
          variant="secondary"
          className="sidebarLibraryButton"
          onClick={onRefreshDevice}
          disabled={deviceRefreshing}
          aria-busy={deviceRefreshing}
        >
          <RefreshCw className={deviceRefreshing ? "spin" : undefined} size={15} aria-hidden="true" />
          {t("device.refreshIphone")}
        </MacButton>
        <MacButton type="button" variant="secondary" className="sidebarLibraryButton" onClick={onOpenLibrary}>
          <FolderOpen size={15} aria-hidden="true" />
          {t("apps.openLibrary")}
        </MacButton>
        <SidebarAppleId
          authStatus={authStatus}
          authLoading={authLoading}
          onOpenSignIn={onOpenSignIn}
          onUseSavedSession={onUseSavedSession}
          onForgetSession={onForgetSession}
        />
      </aside>

      <section className="appWorkspace">
        <header className="appHeader">
          <h1>{steps[activeStep]?.label ?? t("app.name")}</h1>
          <MacSegmentedControl steps={steps} activeIndex={activeStep} onStepClick={onStepClick} />
        </header>
        <main className="appMain">{children}</main>
        <MacActivityLog
          open={logOpen}
          entries={logs}
          onToggle={onToggleLog}
          onClearLogs={onClearLogs}
          onActivityChanged={onLogsChanged}
        />
      </section>
    </div>
  );
}

function SidebarAppleId({
  authStatus,
  authLoading,
  onOpenSignIn,
  onUseSavedSession,
  onForgetSession
}: {
  authStatus: AuthSessionState | null;
  authLoading: boolean;
  onOpenSignIn: () => void;
  onUseSavedSession: () => void;
  onForgetSession: () => void;
}) {
  const { t } = useI18n();
  const signedIn = hasUsableAppleSession(authStatus);
  const canUseSaved = authStatus?.state === "savedSessionAvailable" || authStatus?.state === "savedSessionLocked";
  const title = authTitle(authStatus, t);

  return (
    <section className="sidebarAuth" aria-label={t("download.auth.appleId")}>
      <div className="sidebarAuth__header">
        <span className="sidebarAuth__icon" aria-hidden="true">
          {signedIn ? <UserRound size={16} /> : <LockKeyhole size={16} />}
        </span>
        <div>
          <p className="eyebrow">{t("download.auth.appleId")}</p>
          {signedIn ? (
            <strong>{authStatus?.account || t("auth.signedInTitle")}</strong>
          ) : (
            <strong>{title}</strong>
          )}
        </div>
      </div>
      {signedIn ? <MacStatusPill tone="success">{t("auth.signedInBadge")}</MacStatusPill> : null}
      <div className="sidebarAuth__actions">
        {canUseSaved ? (
          <MacButton type="button" variant="secondary" onClick={onUseSavedSession} disabled={authLoading}>
            {t("download.auth.useSaved")}
          </MacButton>
        ) : null}
        {!signedIn ? (
          <MacButton type="button" onClick={onOpenSignIn} disabled={authLoading}>
            {t("download.auth.signIn")}
          </MacButton>
        ) : null}
        {authStatus && authStatus.state !== "notSignedIn" ? (
          <MacButton type="button" variant="ghost" onClick={onForgetSession} disabled={authLoading}>
            {t("download.auth.forget")}
          </MacButton>
        ) : null}
      </div>
    </section>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function authTitle(status: AuthSessionState | null, t: Translate) {
  if (!status || status.state === "notSignedIn") {
    return t("auth.notSignedInTitle");
  }

  if (status.state === "savedSessionAvailable") {
    return t("auth.savedTitle");
  }

  if (status.state === "savedSessionLocked") {
    return t("auth.lockedTitle");
  }

  if (status.state === "sessionExpired") {
    return t("auth.expiredTitle");
  }

  return t("auth.notSignedInTitle");
}
