import { ArrowDown, ArrowUp } from "lucide-react";
import { useI18n } from "../../app/providers/LanguageProvider";
import {
  nextSortState,
  type SortColumn,
  type SortDirection,
  type SortState
} from "../../lib/sort";

type SortableListHeaderColumn = {
  id: SortColumn;
  label: string;
};

type Props = {
  columns: readonly SortableListHeaderColumn[];
  layout: "apps" | "library";
  sort: SortState | null;
  onSortChange: (sort: SortState) => void;
};

export function SortableListHeader({ columns, layout, sort, onSortChange }: Props) {
  const { t } = useI18n();

  return (
    <div
      className={`sortableListHeader sortableListHeader--${layout}`}
      role="row"
      data-testid="sortable-list-header"
    >
      {columns.map((column) => {
        const active = sort?.column === column.id;
        const next = nextSortState(sort, column.id);
        const activeDirection: SortDirection | null = active ? sort.direction : null;
        const actionLabel = t(
          next.direction === "asc" ? "listHeader.sortAscending" : "listHeader.sortDescending",
          { column: column.label }
        );

        return (
          <span
            className={`sortableListHeader__column sortableListHeader__column--${column.id}${active ? " sortableListHeader__column--active" : ""}`}
            role="columnheader"
            aria-sort={activeDirection ? (activeDirection === "asc" ? "ascending" : "descending") : "none"}
            key={column.id}
          >
            <button
              type="button"
              className="sortableListHeader__button"
              onClick={() => onSortChange(next)}
              aria-label={actionLabel}
              title={actionLabel}
            >
              <span>{column.label}</span>
              {active ? (
                activeDirection === "asc" ? (
                  <ArrowUp size={12} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <ArrowDown size={12} strokeWidth={2.2} aria-hidden="true" />
                )
              ) : null}
            </button>
          </span>
        );
      })}
    </div>
  );
}
