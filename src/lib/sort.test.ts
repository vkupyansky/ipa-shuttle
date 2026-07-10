import { describe, expect, it } from "vitest";
import { nextSortState, sortList, statusSortValue, type SortState } from "./sort";

type Item = {
  id: string;
  name: string;
  size?: number | null;
  status: "notDownloaded" | "downloaded" | "failed";
};

const items: Item[] = [
  { id: "bravo", name: "Bravo", size: 200, status: "downloaded" },
  { id: "unknown", name: "Unknown", size: null, status: "notDownloaded" },
  { id: "alpha", name: "Alpha", size: 100, status: "failed" }
];

const accessors = {
  name: (item: Item) => item.name,
  size: (item: Item) => item.size,
  status: (item: Item) => statusSortValue(item.status)
};

function ids(sort: SortState) {
  return sortList(items, sort, accessors).map((item) => item.id);
}

describe("shared list sorting", () => {
  it("starts a new column ascending and toggles it descending", () => {
    const ascending = nextSortState(null, "name");
    expect(ascending).toEqual({ column: "name", direction: "asc" });
    expect(nextSortState(ascending, "name")).toEqual({ column: "name", direction: "desc" });
    expect(nextSortState({ column: "size", direction: "desc" }, "status")).toEqual({
      column: "status",
      direction: "asc"
    });
  });

  it("sorts names in both directions", () => {
    expect(ids({ column: "name", direction: "asc" })).toEqual(["alpha", "bravo", "unknown"]);
    expect(ids({ column: "name", direction: "desc" })).toEqual(["unknown", "bravo", "alpha"]);
  });

  it("sorts sizes in both directions and always keeps unknown values last", () => {
    expect(ids({ column: "size", direction: "asc" })).toEqual(["alpha", "bravo", "unknown"]);
    expect(ids({ column: "size", direction: "desc" })).toEqual(["bravo", "alpha", "unknown"]);
  });

  it("uses the shared logical status order in both directions", () => {
    expect(ids({ column: "status", direction: "asc" })).toEqual(["unknown", "bravo", "alpha"]);
    expect(ids({ column: "status", direction: "desc" })).toEqual(["alpha", "bravo", "unknown"]);
  });

  it("preserves input order for equal values and unsupported sorting", () => {
    const equalItems: Item[] = [
      { id: "first", name: "Same", size: 100, status: "downloaded" },
      { id: "second", name: "Same", size: 200, status: "notDownloaded" }
    ];
    expect(sortList(equalItems, { column: "name", direction: "asc" }, accessors).map((item) => item.id)).toEqual([
      "first",
      "second"
    ]);
    expect(sortList(items, { column: "size", direction: "asc" }, { name: accessors.name })).toEqual(items);
    expect(sortList(items, null, accessors)).toEqual(items);
  });
});
