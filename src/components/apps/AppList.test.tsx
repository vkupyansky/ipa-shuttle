import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppList } from "./AppList";
import { renderWithI18n } from "../../test/renderWithI18n";
import type { AppInfo } from "../../lib/types";

const exampleApp: AppInfo = {
  name: "Example",
  bundleId: "com.example.app",
  source: "device",
  iconStatus: "loading",
  version: "1.0",
  staticDiskUsageBytes: 1024,
  dynamicDiskUsageBytes: 2048,
  totalDiskUsageBytes: 3072,
  dataSizeStatus: "loaded"
};

const alphaApp: AppInfo = {
  name: "Alpha",
  bundleId: "com.alpha.app",
  source: "device",
  iconStatus: "fallback",
  totalDiskUsageBytes: 5 * 1024 * 1024,
  dataSizeStatus: "loaded"
};

const zeroApp: AppInfo = {
  name: "Zero",
  bundleId: "com.zero.app",
  source: "device",
  iconStatus: "loaded",
  iconPath: "/tmp/zero.png",
  totalDiskUsageBytes: 0,
  dataSizeStatus: "unavailable"
};

const apps: AppInfo[] = [exampleApp, alphaApp, zeroApp];

function AppListHarness() {
  const [currentApps, setApps] = useState([
    {
      ...exampleApp,
      dynamicDiskUsageBytes: null,
      totalDiskUsageBytes: null,
      dataSizeStatus: "notLoaded" as const
    },
    alphaApp,
    zeroApp
  ]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setApps([
            alphaApp,
            {
              ...exampleApp,
              iconPath: "/tmp/example.png",
              iconStatus: "loaded"
            },
            zeroApp
          ])
        }
      >
        Simulate background update
      </button>
      <AppList
        apps={currentApps}
        query={query}
        selectedBundleIds={selected}
        statuses={{}}
        onQueryChange={setQuery}
        onToggle={(bundleId) =>
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(bundleId)) {
              next.delete(bundleId);
            } else {
              next.add(bundleId);
            }
            return next;
          })
        }
        onSelectVisible={(bundleIds) => setSelected(new Set(bundleIds))}
        onClearSelection={() => setSelected(new Set())}
        onIconRenderError={vi.fn()}
      />
    </>
  );
}

describe("AppList", () => {
  it("keeps selection, search, and sort when background size and icon state update", async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(<AppListHarness />);

    const exampleRow = [...container.querySelectorAll(".tableRow")].find((row) =>
      row.textContent?.includes("com.example.app")
    );
    const checkbox = exampleRow?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox).toBeInTheDocument();

    if (!checkbox) {
      throw new Error("Expected app checkbox to render");
    }

    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Sort Size ascending" }));
    expect(exampleRow?.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeChecked();

    await user.type(screen.getByPlaceholderText("Search apps or bundle IDs"), "Example");
    expect(exampleRow?.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Simulate background update" }));
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')).toBeChecked();
    expect(screen.getByPlaceholderText("Search apps or bundle IDs")).toHaveValue("Example");
    expect(screen.getByRole("columnheader", { name: "Size" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByText("3 KB")).toBeInTheDocument();
  });

  it("searches, sorts, selects visible apps, and clears selection", async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    const onSelectVisible = vi.fn();
    const onClearSelection = vi.fn();

    renderWithI18n(
      <AppList
        apps={apps}
        query="alpha"
        selectedBundleIds={new Set(["com.example.app"])}
        statuses={{ "com.alpha.app": "failed", "com.example.app": "downloaded" }}
        onQueryChange={onQueryChange}
        onToggle={vi.fn()}
        onSelectVisible={onSelectVisible}
        onClearSelection={onClearSelection}
        onIconRenderError={vi.fn()}
      />
    );

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Example")).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search apps or bundle IDs"), "x");
    expect(onQueryChange).toHaveBeenCalled();

    expect(screen.getByTestId("sortable-list-header")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Application" })).toHaveAttribute("aria-sort", "none");
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(onSelectVisible).toHaveBeenCalledWith(["com.alpha.app"]);

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClearSelection).toHaveBeenCalled();
  });

  it("sorts apps by application, size, and status in both directions", async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(
      <AppList
        apps={apps}
        query=""
        selectedBundleIds={new Set()}
        statuses={{ "com.alpha.app": "failed", "com.example.app": "downloaded" }}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectVisible={vi.fn()}
        onClearSelection={vi.fn()}
        onIconRenderError={vi.fn()}
      />
    );
    const names = () =>
      [...container.querySelectorAll(".tableRow .nameCell strong")].map((node) => node.textContent);

    await user.click(screen.getByRole("button", { name: "Sort Application ascending" }));
    expect(names()).toEqual(["Alpha", "Example", "Zero"]);
    await user.click(screen.getByRole("button", { name: "Sort Application descending" }));
    expect(names()).toEqual(["Zero", "Example", "Alpha"]);

    await user.click(screen.getByRole("button", { name: "Sort Size ascending" }));
    expect(names()).toEqual(["Example", "Alpha", "Zero"]);
    await user.click(screen.getByRole("button", { name: "Sort Size descending" }));
    expect(names()).toEqual(["Alpha", "Example", "Zero"]);

    await user.click(screen.getByRole("button", { name: "Sort Status ascending" }));
    expect(names()).toEqual(["Zero", "Example", "Alpha"]);
    await user.click(screen.getByRole("button", { name: "Sort Status descending" }));
    expect(names()).toEqual(["Alpha", "Example", "Zero"]);
  });

  it("renders no results, fallback initials, icon image, size tooltips, and render errors", async () => {
    const user = userEvent.setup();
    const onIconRenderError = vi.fn();
    const { rerender, container } = renderWithI18n(
      <AppList
        apps={apps}
        query=""
        selectedBundleIds={new Set()}
        statuses={{}}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectVisible={vi.fn()}
        onClearSelection={vi.fn()}
        onIconRenderError={onIconRenderError}
      />
    );

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("Size unknown")).toBeInTheDocument();
    expect(screen.getByText("Version 1.0")).toBeInTheDocument();
    const image = container.querySelector<HTMLImageElement>('img[src="asset://%2Ftmp%2Fzero.png"]');
    if (!image) {
      throw new Error("Expected converted local icon image");
    }
    image.dispatchEvent(new Event("error"));
    expect(onIconRenderError).toHaveBeenCalledWith("com.zero.app", "asset://%2Ftmp%2Fzero.png");
    expect(container.querySelector(".statusCell svg")).not.toBeInTheDocument();
    expect(container.querySelector('input[type="checkbox"]')).toBeInTheDocument();

    rerender(
      <AppList
        apps={apps}
        query="missing"
        selectedBundleIds={new Set()}
        statuses={{}}
        onQueryChange={vi.fn()}
        onToggle={vi.fn()}
        onSelectVisible={vi.fn()}
        onClearSelection={vi.fn()}
        onIconRenderError={vi.fn()}
      />
    );

    expect(screen.getByText("No apps found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
  });
});
