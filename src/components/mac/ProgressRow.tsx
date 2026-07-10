import { useI18n } from "../../app/providers/LanguageProvider";
import type { ItemProgress } from "../../lib/types";
import { MacStatusPill } from "./MacStatusPill";

type Props = {
  status: ItemProgress | "notDownloaded" | "missing";
};

export function ProgressRow({ status }: Props) {
  const { t } = useI18n();

  if (status === "downloading" || status === "installing") {
    return (
      <MacStatusPill tone="progress">
        {status === "downloading" ? t("progress.downloading") : t("progress.installing")}
      </MacStatusPill>
    );
  }

  if (status === "downloaded" || status === "installed") {
    return (
      <MacStatusPill tone="success">
        {status === "installed" ? t("progress.installed") : t("progress.downloaded")}
      </MacStatusPill>
    );
  }

  if (status === "missing") {
    return <MacStatusPill tone="danger">{t("progress.missing")}</MacStatusPill>;
  }

  if (status === "failed") {
    return <MacStatusPill tone="danger">{t("progress.failed")}</MacStatusPill>;
  }

  return <MacStatusPill tone="neutral">{status === "idle" ? t("progress.idle") : t("progress.notDownloaded")}</MacStatusPill>;
}
