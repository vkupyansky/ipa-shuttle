import { ChevronDown, ChevronUp, Copy, FolderOpen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../app/providers/LanguageProvider";
import { api } from "../../lib/api";
import { localizeLogEntry } from "../../lib/activityLogI18n";
import type { LogEntry } from "../../lib/types";
import { MacButton } from "../mac/MacButton";

type Props = {
  open: boolean;
  entries: LogEntry[];
  onToggle: () => void;
  onClearLogs: () => void;
  onActivityChanged: () => void;
};

type LogFilter = "all" | "errors" | "warnings";
const SUMMARY_OPERATION_WINDOW_MS = 5_000;

export function MacActivityLog({ open, entries, onToggle, onClearLogs, onActivityChanged }: Props) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<LogFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const userVisibleEntries = useMemo(() => entries.filter((entry) => !isRoutineIconEvent(entry)), [entries]);

  const visibleEntries = useMemo(() => {
    const filtered = userVisibleEntries.filter((entry) => {
      if (filter === "errors") {
        return entry.level === "error";
      }
      if (filter === "warnings") {
        return entry.level === "warning";
      }
      return true;
    });

    return filtered.slice(-200).reverse().map((entry) => localizeLogEntry(entry, t));
  }, [filter, t, userVisibleEntries]);

  const latestImportantEntry = useMemo(() => {
    const recentEntries = recentSummaryEntries(userVisibleEntries);
    const latest = (["error", "warning", "success", "info"] as const)
      .map((level) => [...recentEntries].reverse().find((entry) => entry.level === level))
      .find(Boolean) ?? null;
    return latest ? localizeLogEntry(latest, t) : null;
  }, [t, userVisibleEntries]);

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(await api.readActivityDiagnostics());
    onActivityChanged();
  }

  async function openLogsFolder() {
    await api.openLogsFolder();
    onActivityChanged();
  }

  function toggleDetails(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function clearLogs() {
    setFilter("all");
    setExpanded(new Set());
    onClearLogs();
  }

  return (
    <aside className={`activityLog ${open ? "activityLog--open" : ""}`}>
      <button className="activityLog__toggle" type="button" onClick={onToggle}>
        <span>{t("log.title")}</span>
        {!open && latestImportantEntry ? (
          <span className={`activityLog__latest activityLog__latest--${latestImportantEntry.level}`}>
            {latestImportantEntry.message}
          </span>
        ) : null}
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open ? (
        <div className="activityLog__content">
          <div className="activityLog__toolbar">
            <div className="segmentedControl" role="tablist" aria-label={t("log.filterLabel")}>
              <button className={filter === "all" ? "is-active" : ""} type="button" onClick={() => setFilter("all")}>
                {t("log.all")}
              </button>
              <button
                className={filter === "errors" ? "is-active" : ""}
                type="button"
                onClick={() => setFilter("errors")}
              >
                {t("log.errors")}
              </button>
              <button
                className={filter === "warnings" ? "is-active" : ""}
                type="button"
                onClick={() => setFilter("warnings")}
              >
                {t("log.warnings")}
              </button>
            </div>
            <div className="activityLog__tools">
              <MacButton type="button" variant="secondary" onClick={() => void copyDiagnostics()}>
                <Copy size={15} />
                {t("log.copyDiagnostics")}
              </MacButton>
              <MacButton type="button" variant="secondary" onClick={() => void openLogsFolder()}>
                <FolderOpen size={15} />
                {t("log.openFolder")}
              </MacButton>
              <MacButton type="button" variant="danger" onClick={clearLogs}>
                <Trash2 size={15} />
                {t("log.clearLogs")}
              </MacButton>
            </div>
          </div>
          <p className="activityLog__retention">{t("log.retention")}</p>

          {visibleEntries.length === 0 ? (
            <span className="activityLog__empty">
              {userVisibleEntries.length === 0 ? t("log.empty") : t("log.noMatches")}
            </span>
          ) : (
            <div className="activityTimeline">
              {visibleEntries.map((entry) => {
                const key = `${entry.timestamp}-${entry.taskName}-${entry.message}`;
                const isExpanded = expanded.has(key);
                const hasDetails = Boolean(entry.technicalDetails);
                return (
                  <div className={`activityLog__entry activityLog__entry--${entry.level}`} key={key}>
                    <button
                      className="activityLog__entryMain"
                      type="button"
                      onClick={() => hasDetails && toggleDetails(key)}
                      disabled={!hasDetails}
                    >
                      <span className="activityLog__dot" aria-hidden="true" />
                      <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                      <span className="activityLog__task">{entry.taskName}</span>
                      <span className="activityLog__message">{entry.message}</span>
                      {entry.durationMs ? <span className="activityLog__duration">{entry.durationMs} ms</span> : null}
                      {hasDetails ? (
                        <span className="activityLog__detailsToggle">
                          {isExpanded ? t("log.hideDetails") : t("log.details")}
                        </span>
                      ) : null}
                    </button>
                    {isExpanded && entry.technicalDetails ? (
                      <pre className="activityLog__details">{entry.technicalDetails}</pre>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}

function isRoutineIconEvent(entry: LogEntry) {
  return (
    entry.taskName === "App Icons" &&
    (entry.message === "Loading cached icons" ||
      entry.message === "Fetching app icons" ||
      entry.message.startsWith("App icons loaded:"))
  );
}

function recentSummaryEntries(entries: LogEntry[]) {
  const latestTimestamp = Math.max(...entries.map(function parseTimestamp(entry) {
    return Date.parse(entry.timestamp);
  }));
  if (!Number.isFinite(latestTimestamp)) {
    return entries.slice(-1);
  }
  return entries.filter(function isWithinOperationWindow(entry) {
    const age = latestTimestamp - Date.parse(entry.timestamp);
    return age <= SUMMARY_OPERATION_WINDOW_MS;
  });
}
