import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SortState } from "../../lib/sort";
import { renderWithI18n } from "../../test/renderWithI18n";
import { SortableListHeader } from "./SortableListHeader";

function HeaderHarness() {
  const [sort, setSort] = useState<SortState | null>(null);

  return (
    <div role="table">
      <SortableListHeader
        layout="apps"
        columns={[
          { id: "name", label: "Application" },
          { id: "size", label: "Size" },
          { id: "status", label: "Status" }
        ]}
        sort={sort}
        onSortChange={setSort}
      />
    </div>
  );
}

describe("SortableListHeader", () => {
  it("supports keyboard activation and exposes ascending/descending state", async () => {
    const user = userEvent.setup();
    renderWithI18n(<HeaderHarness />);

    const applicationHeader = screen.getByRole("columnheader", { name: "Application" });
    expect(applicationHeader).toHaveAttribute("aria-sort", "none");

    await user.tab();
    expect(screen.getByRole("button", { name: "Sort Application ascending" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(applicationHeader).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("button", { name: "Sort Application descending" })).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(applicationHeader).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("button", { name: "Sort Application ascending" })).toBeInTheDocument();
  });
});
