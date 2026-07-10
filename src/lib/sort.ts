import type { AppDownloadStatus, ItemProgress, LocalIpa } from "./types";

export type SortColumn = "name" | "size" | "status";
export type SortDirection = "asc" | "desc";

export type SortState = {
  column: SortColumn;
  direction: SortDirection;
};

type SortValue = string | number | null | undefined;
type SortAccessors<T> = Partial<Record<SortColumn, (item: T) => SortValue>>;
type SortableStatus = AppDownloadStatus | ItemProgress | LocalIpa["status"];

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

const statusOrder: Record<SortableStatus, number> = {
  idle: 0,
  notDownloaded: 0,
  downloading: 1,
  installing: 1,
  downloaded: 2,
  installed: 2,
  missing: 3,
  failed: 4
};

export function nextSortState(current: SortState | null, column: SortColumn): SortState {
  if (!current || current.column !== column) {
    return { column, direction: "asc" };
  }

  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc"
  };
}

export function sortList<T>(
  items: readonly T[],
  sort: SortState | null,
  accessors: SortAccessors<T>
): T[] {
  if (!sort) {
    return [...items];
  }

  const accessor = accessors[sort.column];
  if (!accessor) {
    return [...items];
  }

  return items
    .map((item, index) => ({ item, index, value: accessor(item) }))
    .sort((left, right) => {
      const leftValue = left.value;
      const rightValue = right.value;
      const leftKnown = isKnown(leftValue);
      const rightKnown = isKnown(rightValue);

      if (!leftKnown || !rightKnown) {
        if (!leftKnown && !rightKnown) {
          return left.index - right.index;
        }
        return leftKnown ? -1 : 1;
      }

      const result = compareValues(leftValue, rightValue);
      if (result === 0) {
        return left.index - right.index;
      }
      return sort.direction === "asc" ? result : -result;
    })
    .map(({ item }) => item);
}

export function statusSortValue(status: SortableStatus) {
  return statusOrder[status];
}

function isKnown(value: SortValue): value is string | number {
  return value !== null && value !== undefined && (typeof value !== "number" || Number.isFinite(value));
}

function compareValues(left: Exclude<SortValue, null | undefined>, right: Exclude<SortValue, null | undefined>) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return collator.compare(String(left), String(right));
}
