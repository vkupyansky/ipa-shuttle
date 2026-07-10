import { useMemo, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Search } from "lucide-react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { initials } from "../../lib/format";
import { sortList, statusSortValue, type SortState } from "../../lib/sort";
import type { AppDownloadStatus, AppInfo } from "../../lib/types";
import { EmptyState } from "../mac/EmptyState";
import { MacButton } from "../mac/MacButton";
import { ProgressRow } from "../mac/ProgressRow";
import { SortableListHeader } from "../mac/SortableListHeader";

type Props = {
  apps: AppInfo[];
  query: string;
  selectedBundleIds: Set<string>;
  statuses: Record<string, AppDownloadStatus>;
  emptyTitle?: string;
  toolbarLeading?: ReactNode;
  dataSizesLoading?: boolean;
  onQueryChange: (query: string) => void;
  onToggle: (bundleId: string) => void;
  onSelectVisible: (bundleIds: string[]) => void;
  onClearSelection: () => void;
  onIconRenderError: (bundleId: string, renderUrl: string) => void;
};

export function AppList({
  apps,
  query,
  selectedBundleIds,
  statuses,
  emptyTitle,
  toolbarLeading,
  dataSizesLoading = false,
  onQueryChange,
  onToggle,
  onSelectVisible,
  onClearSelection,
  onIconRenderError
}: Props) {
  const { t } = useI18n();
  const [sort, setSort] = useState<SortState | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleApps = useMemo(() => {
    const filtered = apps.filter((app) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        app.name.toLowerCase().includes(normalizedQuery) ||
        app.bundleId.toLowerCase().includes(normalizedQuery)
      );
    });

    return sortList(filtered, sort, {
      name: (app) => app.name,
      size: (app) => {
        const size = app.totalDiskUsageBytes;
        return size && size > 0 ? size : null;
      },
      status: (app) => statusSortValue(statuses[app.bundleId] ?? "notDownloaded")
    });
  }, [apps, normalizedQuery, sort, statuses]);

  return (
    <section className="listSurface">
      <div className="toolbar">
        {toolbarLeading}
        <label className="searchField">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("apps.search")}
          />
        </label>
        <div className="toolbar__actions">
          <MacButton
            type="button"
            variant="secondary"
            onClick={() => onSelectVisible(visibleApps.map((app) => app.bundleId))}
            disabled={visibleApps.length === 0}
          >
            {t("apps.selectAllVisible")}
          </MacButton>
          <MacButton type="button" variant="ghost" onClick={onClearSelection} disabled={selectedBundleIds.size === 0}>
            {t("apps.clearSelection")}
          </MacButton>
        </div>
      </div>

      {visibleApps.length === 0 ? (
        <EmptyState title={emptyTitle ?? t("apps.noAppsFound")} />
      ) : (
        <div className="tableList" role="table" aria-label={t("apps.tableLabel")}>
          <SortableListHeader
            layout="apps"
            columns={[
              { id: "name", label: t("listHeader.application") },
              { id: "size", label: t("listHeader.size") },
              { id: "status", label: t("listHeader.status") }
            ]}
            sort={sort}
            onSortChange={setSort}
          />
          {visibleApps.map((app) => (
            <div className="tableRow tableRow--apps" role="row" key={app.bundleId}>
              <span className="checkboxCell">
                <input
                  type="checkbox"
                  checked={selectedBundleIds.has(app.bundleId)}
                  onChange={() => onToggle(app.bundleId)}
                />
              </span>
              <AppIcon app={app} onRenderError={onIconRenderError} />
              <span className="nameCell">
                <strong title={app.name}>{app.name}</strong>
                <small>{app.bundleId}</small>
                {app.version ? <small>{t("apps.version", { version: app.version })}</small> : null}
              </span>
              <span className="sizeCell" title={sizeTitle(app, t)}>
                {displayTotalSize(app, dataSizesLoading, t)}
              </span>
              <span className="statusCell">
                <ProgressRow status={statuses[app.bundleId] ?? "notDownloaded"} />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AppIcon({
  app,
  onRenderError
}: {
  app: AppInfo;
  onRenderError: (bundleId: string, renderUrl: string) => void;
}) {
  if (app.iconPath && (app.iconStatus === "cached" || app.iconStatus === "loaded")) {
    const renderUrl = convertFileSrc(app.iconPath);
    return (
      <span className="appIconCell">
        <img
          src={renderUrl}
          alt=""
          onError={() => {
            onRenderError(app.bundleId, renderUrl);
          }}
        />
      </span>
    );
  }

  if (app.iconStatus === "loading") {
    return <span className="appIconCell appIconCell--skeleton" aria-hidden="true" />;
  }

  return (
    <span className="appIconCell appIconCell--fallback" aria-hidden="true">
      {initials(app.name || app.bundleId)}
    </span>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];

function formatBytes(value: number | null | undefined, t: Translate) {
  if (!value || value <= 0) {
    return t("apps.sizeUnknown");
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex <= 1 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function displayTotalSize(app: AppInfo, dataSizesLoading: boolean, t: Translate) {
  if (app.dataSizeStatus === "loaded") {
    return formatBytes(app.totalDiskUsageBytes, t);
  }
  if (dataSizesLoading && app.dataSizeStatus === "loading") {
    return t("apps.sizeLoading");
  }
  if (app.dataSizeStatus === "unavailable") {
    return t("apps.sizeUnknown");
  }
  return t("apps.sizeNotLoaded");
}

function sizeTitle(app: AppInfo, t: Translate) {
  const dynamicSize =
    app.dataSizeStatus === "loaded"
      ? formatBytes(app.dynamicDiskUsageBytes, t)
      : app.dataSizeStatus === "loading"
        ? t("apps.sizeLoading")
        : t("apps.sizeNotLoaded");
  const totalSize =
    app.dataSizeStatus === "loaded"
      ? formatBytes(app.totalDiskUsageBytes, t)
      : app.dataSizeStatus === "loading"
        ? t("apps.sizeLoading")
        : t("apps.sizeNotLoaded");
  return [
    t("apps.size.app", { size: formatBytes(app.staticDiskUsageBytes, t) }),
    t("apps.size.data", { size: dynamicSize }),
    t("apps.size.total", { size: totalSize })
  ].join("\n");
}
