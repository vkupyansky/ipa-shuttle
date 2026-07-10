import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IpaLibraryList } from "./IpaLibraryList";
import { renderWithI18n } from "../../test/renderWithI18n";
import type { LocalIpa } from "../../lib/types";

const downloaded: LocalIpa = {
  id: "ipa-downloaded",
  bundleId: "com.example.downloaded",
  appName: "Downloaded App",
  ipaPath: "/tmp/Downloaded.ipa",
  downloadedAt: "2026-07-09T00:00:00.000Z",
  iconPath: "/tmp/icon.png",
  status: "downloaded"
};

const missing: LocalIpa = {
  id: "ipa-missing",
  bundleId: "com.example.missing",
  appName: null,
  ipaPath: "/tmp/Missing.ipa",
  downloadedAt: "2026-07-09T00:00:00.000Z",
  status: "missing"
};

describe("IpaLibraryList", () => {
  it("renders an empty library state", () => {
    const { container } = renderWithI18n(
      <IpaLibraryList
        items={[]}
        query=""
        selectedIds={new Set()}
        statuses={{}}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onDeleteOne={vi.fn()}
      />
    );

    expect(screen.getByText("No IPA files in the local library")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search IPA library")).toBeInTheDocument();
    expect(container.querySelectorAll(".emptyState")).toHaveLength(1);
  });

  it("renders the shared empty library state in Russian", () => {
    window.localStorage.setItem("ipa-shuttle.language", "ru");

    const { container } = renderWithI18n(
      <IpaLibraryList
        items={[]}
        query=""
        selectedIds={new Set()}
        statuses={{}}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onDeleteOne={vi.fn()}
      />
    );

    expect(screen.getByText("В локальной библиотеке нет IPA")).toBeInTheDocument();
    expect(container.querySelectorAll(".emptyState")).toHaveLength(1);
  });

  it("renders downloaded and missing rows with correct actions", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onSelectAll = vi.fn();
    const onClearSelection = vi.fn();
    const onDeleteOne = vi.fn();
    const { container } = renderWithI18n(
      <IpaLibraryList
        items={[downloaded, missing]}
        query=""
        selectedIds={new Set(["ipa-missing"])}
        statuses={{ "ipa-downloaded": "installing" }}
        onQueryChange={vi.fn()}
        onToggle={onToggle}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
        onDeleteOne={onDeleteOne}
      />
    );

    expect(screen.getByText("Downloaded App")).toBeInTheDocument();
    expect(screen.getByTestId("sortable-list-header")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Size/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("com.example.missing")).toHaveLength(2);
    const missingStatus = screen.getByText("IPA file is missing");
    expect(missingStatus.closest(".statusCell")).toBeInTheDocument();
    expect(missingStatus.closest(".nameCell")).not.toBeInTheDocument();
    expect(container.querySelector('img[src="asset://%2Ftmp%2Ficon.png"]')).toBeInTheDocument();
    expect(container.querySelector(".statusCell svg")).not.toBeInTheDocument();
    expect(container.querySelector('input[type="checkbox"]')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(onSelectAll).toHaveBeenCalledWith(["ipa-downloaded", "ipa-missing"]);

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClearSelection).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Delete IPA for com.example.downloaded" }));
    expect(onDeleteOne).toHaveBeenCalledWith("ipa-downloaded");

    await user.click(screen.getByRole("button", { name: "Remove entry for com.example.missing" }));
    expect(onDeleteOne).toHaveBeenCalledWith("ipa-missing");

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) {
      throw new Error("Expected row checkbox");
    }
    await user.click(checkbox);
    expect(onToggle).toHaveBeenCalled();
  });

  it("sorts the library by application and status in both directions", async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(
      <IpaLibraryList
        items={[downloaded, missing]}
        query=""
        selectedIds={new Set(["ipa-downloaded"])}
        statuses={{}}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onDeleteOne={vi.fn()}
      />
    );
    const names = () =>
      [...container.querySelectorAll(".tableRow .nameCell strong")].map((node) => node.textContent);

    await user.click(screen.getByRole("button", { name: "Sort Application ascending" }));
    expect(names()).toEqual(["com.example.missing", "Downloaded App"]);
    await user.click(screen.getByRole("button", { name: "Sort Application descending" }));
    expect(names()).toEqual(["Downloaded App", "com.example.missing"]);

    await user.click(screen.getByRole("button", { name: "Sort Status ascending" }));
    expect(names()).toEqual(["Downloaded App", "com.example.missing"]);
    await user.click(screen.getByRole("button", { name: "Sort Status descending" }));
    expect(names()).toEqual(["com.example.missing", "Downloaded App"]);

    const selectedRow = [...container.querySelectorAll(".tableRow")].find((row) =>
      row.textContent?.includes("Downloaded App")
    );
    expect(selectedRow?.querySelector('input[type="checkbox"]')).toBeChecked();
  });

  it("only shows Remove entry for missing rows", () => {
    renderWithI18n(
      <IpaLibraryList
        items={[downloaded, missing]}
        query=""
        selectedIds={new Set()}
        statuses={{}}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onClearSelection={vi.fn()}
        onDeleteOne={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Remove entry for com.example.missing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove entry for com.example.downloaded" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete IPA for com.example.downloaded" })).toBeInTheDocument();
  });
});
