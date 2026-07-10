import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppsDownloadScreen } from "./AppsDownloadScreen";
import { renderWithI18n } from "../../test/renderWithI18n";
import type { AppInfo, AuthSessionState } from "../../lib/types";

const apps: AppInfo[] = [
  {
    name: "Example",
    bundleId: "com.example.app",
    source: "device",
    iconStatus: "fallback",
    dataSizeStatus: "notLoaded"
  }
];

const baseProps = {
  apps,
  scanning: false,
  dataSizesLoading: false,
  canLoadDataSizes: true,
  appCount: apps.length,
  lastScanAt: "2026-07-09T12:00:00.000Z",
  query: "",
  selectedBundleIds: new Set<string>(),
  statuses: {},
  downloading: false,
  onScanApps: vi.fn(),
  onLoadDataSizes: vi.fn(),
  onQueryChange: vi.fn(),
  onToggleApp: vi.fn(),
  onSelectVisibleApps: vi.fn(),
  onClearAppSelection: vi.fn(),
  onIconRenderError: vi.fn(),
  onDownloadSelected: vi.fn()
};

describe("AppsDownloadScreen", () => {
  it("renders checking and empty states", () => {
    renderWithI18n(
      <AppsDownloadScreen
        {...baseProps}
        apps={[]}
        authStatus={null}
        downloadBlockedReason="Select at least one app"
      />
    );

    expect(screen.getByText("No apps scanned")).toBeInTheDocument();
    expect(screen.queryByText("Apple ID")).not.toBeInTheDocument();
  });

  it("renders the shared empty state in Russian", () => {
    window.localStorage.setItem("ipa-shuttle.language", "ru");

    const { container } = renderWithI18n(
      <AppsDownloadScreen
        {...baseProps}
        apps={[]}
        authStatus={null}
        downloadBlockedReason="Выберите хотя бы одно приложение"
      />
    );

    expect(screen.getByText("Приложения не сканировались")).toBeInTheDocument();
    expect(container.querySelectorAll(".emptyState")).toHaveLength(1);
  });

  it("shows a clear disabled reason without rendering an Apple ID bar", () => {
    const authStatus: AuthSessionState = { state: "notSignedIn" };

    renderWithI18n(
      <AppsDownloadScreen
        {...baseProps}
        authStatus={authStatus}
        selectedBundleIds={new Set(["com.example.app"])}
        downloadBlockedReason="Sign in with Apple ID first"
      />
    );

    expect(screen.getByText("Sign in with Apple ID first")).toBeInTheDocument();
    expect(screen.queryByText("Not signed in")).not.toBeInTheDocument();
    expect(screen.getByText("1 selected of 1 apps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download selected" })).toBeDisabled();
  });

  it("enables download when Apple ID state is signed in and attempts download", async () => {
    const user = userEvent.setup();
    const onDownloadSelected = vi.fn();
    const authStatus: AuthSessionState = {
      state: "signedIn",
      account: "person@example.com"
    };

    renderWithI18n(
      <AppsDownloadScreen
        {...baseProps}
        authStatus={authStatus}
        selectedBundleIds={new Set(["com.example.app"])}
        downloadBlockedReason={null}
        onDownloadSelected={onDownloadSelected}
      />
    );

    const button = screen.getByRole("button", { name: "Download selected" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onDownloadSelected).toHaveBeenCalled();
  });

  it("blocks download when only a saved session marker is available", () => {
    renderWithI18n(
      <AppsDownloadScreen
        {...baseProps}
        authStatus={{ state: "savedSessionAvailable" }}
        selectedBundleIds={new Set(["com.example.app"])}
        downloadBlockedReason="Use saved Apple ID session first"
      />
    );

    expect(screen.getByRole("button", { name: "Scan apps" })).toBeInTheDocument();
    expect(screen.getByText("Use saved Apple ID session first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download selected" })).toBeDisabled();
  });

  it("loads data sizes only after the explicit user action", async () => {
    const user = userEvent.setup();
    const onLoadDataSizes = vi.fn();

    const { rerender } = renderWithI18n(
      <AppsDownloadScreen
        {...baseProps}
        authStatus={{ state: "notSignedIn" }}
        downloadBlockedReason="Select at least one app"
        onLoadDataSizes={onLoadDataSizes}
      />
    );

    const loadButton = screen.getByRole("button", { name: "Load data sizes" });
    expect(loadButton).toBeEnabled();
    expect(onLoadDataSizes).not.toHaveBeenCalled();
    await user.click(loadButton);
    expect(onLoadDataSizes).toHaveBeenCalledOnce();

    rerender(
      <AppsDownloadScreen
        {...baseProps}
        authStatus={{ state: "notSignedIn" }}
        downloadBlockedReason="Select at least one app"
        dataSizesLoading
        onLoadDataSizes={onLoadDataSizes}
      />
    );
    expect(screen.getByRole("button", { name: "Loading data sizes" })).toBeDisabled();
  });
});
