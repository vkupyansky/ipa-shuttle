import { convertFileSrc } from "@tauri-apps/api/core";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { initials } from "../../lib/format";
import { sortList, statusSortValue, type SortState } from "../../lib/sort";
import type { ItemProgress, LocalIpa } from "../../lib/types";
import { EmptyState } from "../mac/EmptyState";
import { MacButton } from "../mac/MacButton";
import { ProgressRow } from "../mac/ProgressRow";
import { SortableListHeader } from "../mac/SortableListHeader";

type Props = {
  items: LocalIpa[];
  query: string;
  selectedIds: Set<string>;
  statuses: Record<string, ItemProgress | "missing">;
  onQueryChange: (query: string) => void;
  onToggle: (ipaId: string) => void;
  onSelectAll: (ipaIds: string[]) => void;
  onClearSelection: () => void;
  onDeleteOne: (ipaId: string) => void;
};

export function IpaLibraryList({
  items,
  query,
  selectedIds,
  statuses,
  onQueryChange,
  onToggle,
  onSelectAll,
  onClearSelection,
  onDeleteOne
}: Props) {
  const { t } = useI18n();
  const [sort, setSort] = useState<SortState | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => {
      if (!normalizedQuery) {
        return true;
      }
      return (
        (item.appName || item.bundleId).toLowerCase().includes(normalizedQuery) ||
        item.bundleId.toLowerCase().includes(normalizedQuery)
      );
    });

    return sortList(filtered, sort, {
      name: (item) => item.appName || item.bundleId,
      status: (item) => statusSortValue(statuses[item.id] ?? item.status)
    });
  }, [items, normalizedQuery, sort, statuses]);

  return (
    <section className="listSurface">
      <div className="toolbar">
        <label className="searchField">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("library.search")}
          />
        </label>
        <div className="toolbar__actions">
          <MacButton
            type="button"
            variant="secondary"
            onClick={() => onSelectAll(visibleItems.map((item) => item.id))}
            disabled={visibleItems.length === 0}
          >
            {t("library.selectAll")}
          </MacButton>
          <MacButton type="button" variant="ghost" onClick={onClearSelection} disabled={selectedIds.size === 0}>
            {t("apps.clearSelection")}
          </MacButton>
        </div>
      </div>
      {visibleItems.length === 0 ? (
        <EmptyState title={items.length === 0 ? t("library.empty") : t("library.noIpasFound")} />
      ) : (
        <div className="tableList" role="table" aria-label={t("library.tableLabel")}>
          <SortableListHeader
            layout="library"
            columns={[
              { id: "name", label: t("listHeader.application") },
              { id: "status", label: t("listHeader.status") }
            ]}
            sort={sort}
            onSortChange={setSort}
          />
          {visibleItems.map((item) => {
          const missing = item.status === "missing";
          return (
            <div className={`tableRow tableRow--library ${missing ? "tableRow--warning" : ""}`} role="row" key={item.id}>
              <span className="checkboxCell">
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => onToggle(item.id)}
                />
              </span>
              <IpaIcon item={item} />
              <span className="nameCell">
                <strong>{item.appName || item.bundleId}</strong>
                <small>{item.bundleId}</small>
              </span>
              <span className="statusCell">
                <ProgressRow status={missing ? "missing" : statuses[item.id] ?? "downloaded"} />
              </span>
              <span className="rowActionCell">
                <button
                  className="rowTextButton"
                  type="button"
                  onClick={() => onDeleteOne(item.id)}
                  aria-label={
                    missing
                      ? t("library.removeEntryLabel", { bundleId: item.bundleId })
                      : t("library.deleteLabel", { bundleId: item.bundleId })
                  }
                  title={missing ? t("library.removeEntry") : t("library.deleteIpa")}
                >
                  {missing ? t("library.removeEntry") : t("library.deleteIpa")}
                </button>
              </span>
            </div>
          );
          })}
        </div>
      )}
    </section>
  );
}

function IpaIcon({ item }: { item: LocalIpa }) {
  if (item.iconPath) {
    return (
      <span className="appIconCell">
        <img src={convertFileSrc(item.iconPath)} alt="" />
      </span>
    );
  }

  return (
    <span className="appIconCell appIconCell--fallback" aria-hidden="true">
      {initials(item.appName || item.bundleId)}
    </span>
  );
}
