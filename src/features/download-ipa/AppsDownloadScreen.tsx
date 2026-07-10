import { Database, LoaderCircle, ScanLine } from "lucide-react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { hasUsableAppleSession } from "../../lib/auth";
import type { AppDownloadStatus, AppInfo, AuthSessionState } from "../../lib/types";
import { AppList } from "../../components/apps/AppList";
import { MacButton } from "../../components/mac/MacButton";

type Props = {
  apps: AppInfo[];
  authStatus: AuthSessionState | null;
  scanning: boolean;
  dataSizesLoading: boolean;
  canLoadDataSizes: boolean;
  appCount: number;
  lastScanAt: string | null;
  query: string;
  selectedBundleIds: Set<string>;
  statuses: Record<string, AppDownloadStatus>;
  downloading: boolean;
  downloadBlockedReason: string | null;
  onScanApps: () => void;
  onLoadDataSizes: () => void;
  onQueryChange: (query: string) => void;
  onToggleApp: (bundleId: string) => void;
  onSelectVisibleApps: (bundleIds: string[]) => void;
  onClearAppSelection: () => void;
  onIconRenderError: (bundleId: string, renderUrl: string) => void;
  onDownloadSelected: () => void;
};

export function AppsDownloadScreen({
  apps,
  authStatus,
  scanning,
  dataSizesLoading,
  canLoadDataSizes,
  appCount,
  lastScanAt,
  query,
  selectedBundleIds,
  statuses,
  downloading,
  downloadBlockedReason,
  onScanApps,
  onLoadDataSizes,
  onQueryChange,
  onToggleApp,
  onSelectVisibleApps,
  onClearAppSelection,
  onIconRenderError,
  onDownloadSelected
}: Props) {
  const { t } = useI18n();
  const scanDisabled = scanning;
  const lastScanText = t("apps.lastScan", { time: formatScanTime(lastScanAt, t) });

  return (
    <div className="screenStack compactScreen">
      <AppList
        apps={apps}
        query={query}
        selectedBundleIds={selectedBundleIds}
        statuses={statuses}
        emptyTitle={apps.length === 0 ? t("download.empty.title") : t("apps.noAppsFound")}
        toolbarLeading={
          <div className="workflowTools">
            <MacButton type="button" onClick={onScanApps} disabled={scanDisabled}>
              <ScanLine size={15} aria-hidden="true" />
              {scanning ? t("apps.scanning") : t("apps.scanApps")}
            </MacButton>
            <MacButton
              type="button"
              variant="secondary"
              onClick={onLoadDataSizes}
              disabled={!canLoadDataSizes || scanning || dataSizesLoading}
              aria-busy={dataSizesLoading}
            >
              {dataSizesLoading ? (
                <LoaderCircle className="spin" size={15} aria-hidden="true" />
              ) : (
                <Database size={15} aria-hidden="true" />
              )}
              {dataSizesLoading ? t("apps.loadingDataSizes") : t("apps.loadDataSizes")}
            </MacButton>
          </div>
        }
        dataSizesLoading={dataSizesLoading}
        onQueryChange={onQueryChange}
        onToggle={onToggleApp}
        onSelectVisible={onSelectVisibleApps}
        onClearSelection={onClearAppSelection}
        onIconRenderError={onIconRenderError}
      />
      <div className="actionBar">
        <div>
          <strong>{t("download.selectedOfTotal", { selected: selectedBundleIds.size, total: appCount })}</strong>
          {downloadBlockedReason ? <p className="actionHint">{downloadBlockedReason}</p> : null}
          <p className="actionHint">{lastScanText}</p>
        </div>
        <div className="actionBar__buttons">
          <MacButton
            type="button"
            disabled={selectedBundleIds.size === 0 || downloading || !hasUsableAppleSession(authStatus)}
            onClick={onDownloadSelected}
          >
            {downloading ? t("download.downloadingSelected") : t("download.downloadSelected")}
          </MacButton>
        </div>
      </div>
    </div>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function formatScanTime(value: string | null, t: Translate) {
  if (!value) {
    return t("apps.neverScanned");
  }
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
