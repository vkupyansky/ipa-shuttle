import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { renderWithI18n } from "../test/renderWithI18n";

const missingIpa = {
  id: "ipa-missing",
  bundleId: "com.example.missing",
  appName: "Missing App",
  ipaPath: "/tmp/Missing.ipa",
  downloadedAt: "2026-07-09T00:00:00.000Z",
  status: "missing"
};

const downloadedIpa = {
  id: "ipa-downloaded",
  bundleId: "com.example.app",
  appName: "Example App",
  ipaPath: "/tmp/Example.ipa",
  downloadedAt: "2026-07-10T00:00:00.000Z",
  status: "downloaded"
};

const scannedApp = {
  name: "Example App",
  bundleId: "com.example.app",
  source: "device",
  iconStatus: "fallback",
  dataSizeStatus: "notLoaded"
};

const sourceDevice = {
  udid: "000000000000000000000000",
  name: "Test iPhone",
  connected: true,
  trustStatus: "connected"
};

const oldDevice = {
  ...sourceDevice,
  name: "Old iPhone",
  model: "iPhone 14 Pro Max",
  iosVersion: "18.5",
  batteryPercent: 83
};

const newDevice = {
  udid: "111111111111111111111111",
  name: "New iPhone",
  model: "iPhone 16 Pro",
  iosVersion: "26.0",
  batteryPercent: 72,
  connected: true,
  trustStatus: "connected"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("App library mutations", () => {
  it("removes a missing IPA entry from the UI immediately while backend removes manifest entry", async () => {
    const user = userEvent.setup();
    const deleteResult = deferred<typeof missingIpa[]>();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "list_local_ipas") {
        return [missingIpa];
      }
      if (command === "read_activity_log") {
        return [];
      }
      if (command === "delete_local_ipas") {
        expect(args).toEqual({ ipaIds: ["ipa-missing"] });
        return deleteResult.promise;
      }
      return undefined;
    });

    renderWithI18n(<App />);

    await user.click(await screen.findByRole("button", { name: /Install/ }));
    expect(await screen.findByText("Missing App")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove entry for com.example.missing" }));
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toHaveTextContent("This will not delete apps from any iPhone");
    await user.click(within(confirmation).getByRole("button", { name: "Remove entry" }));

    await waitFor(() => {
      expect(screen.queryByText("Missing App")).not.toBeInTheDocument();
    });
    expect(screen.getByText("0 selected of 0 IPA")).toBeInTheDocument();

    deleteResult.resolve([]);
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_local_ipas", { ipaIds: ["ipa-missing"] });
    });
  });

  it("forgets a saved Apple ID session and updates the sidebar state", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      if (command === "get_apple_auth_status") {
        return { state: "savedSessionAvailable" };
      }
      if (command === "forget_apple_session") {
        return { state: "notSignedIn" };
      }
      return undefined;
    });

    renderWithI18n(<App />);

    await user.click(await screen.findByRole("button", { name: "Forget Apple ID session" }));
    const confirmation = screen.getByRole("alertdialog");
    await user.click(within(confirmation).getByRole("button", { name: "Forget Apple ID session" }));

    await waitFor(() => {
      expect(screen.getByText("Not signed in")).toBeInTheDocument();
      expect(screen.queryByText("Saved session available")).not.toBeInTheDocument();
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("forget_apple_session", undefined);
  });

  it("clears warning-filtered logs and ignores an older in-flight refresh", async () => {
    const user = userEvent.setup();
    const staleRead = deferred<{ timestamp: string; level: string; taskName: string; message: string }[]>();
    const warning = {
      timestamp: "2026-07-09T10:01:00.000Z",
      level: "warning",
      taskName: "Download",
      message: "Download blocked: Apple ID not signed in"
    };
    let logReadCount = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices" || command === "list_local_ipas") {
        return [];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "read_activity_log") {
        logReadCount += 1;
        return logReadCount === 1 ? [warning] : staleRead.promise;
      }
      if (command === "open_logs_folder" || command === "clear_activity_logs") {
        return undefined;
      }
      return undefined;
    });

    renderWithI18n(<App />);
    await user.click(await screen.findByRole("button", { name: /Activity Log/ }));
    await user.click(screen.getByRole("button", { name: "Warnings" }));
    expect(screen.getByText("Download blocked: Apple ID not signed in")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open logs folder" }));
    await waitFor(() => expect(logReadCount).toBe(2));

    await user.click(screen.getByRole("button", { name: "Clear logs" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear logs" }));

    expect(screen.getByText("No log events")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveClass("is-active");
    staleRead.resolve([warning]);
    await waitFor(() => {
      expect(screen.queryByText("Download blocked: Apple ID not signed in")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Activity Log" }));
    await user.click(screen.getByRole("button", { name: "Activity Log" }));
    expect(screen.getByText("No log events")).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("clear_activity_logs", undefined);
  });

  it("runs the download engine after successful Apple ID authentication", async () => {
    const user = userEvent.setup();
    let authenticated = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return authenticated
          ? { state: "signedIn", account: "person@example.com" }
          : { state: "notSignedIn" };
      }
      if (command === "start_apple_login") {
        expect(args).toEqual({
          email: "person@example.com",
          password: "temporary-password",
          remember: false
        });
        authenticated = true;
        return { state: "success", signedIn: true, account: "person@example.com" };
      }
      if (command === "scan_installed_apps") {
        return [scannedApp];
      }
      if (command === "fetch_app_icons" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      if (command === "download_ipa") {
        expect(args).toEqual({
          bundleId: "com.example.app",
          appName: "Example App",
          sourceDeviceName: "Test iPhone",
          visibleAuthState: "signedIn"
        });
        return { ok: true };
      }
      return undefined;
    });

    renderWithI18n(<App />);
    await user.click(await screen.findByRole("button", { name: "Sign in with Apple ID" }));
    expect(screen.getByRole("checkbox", { name: "Remember session in Keychain" })).not.toBeChecked();
    await user.type(screen.getByLabelText("Apple ID email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "temporary-password");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));

    expect(screen.getByText("Signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Download selected" }));

    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("download_ipa", {
        bundleId: "com.example.app",
        appName: "Example App",
        sourceDeviceName: "Test iPhone",
        visibleAuthState: "signedIn"
      });
    });
  });

  it("synchronizes download and delete across Apps and Install immediately", async () => {
    const user = userEvent.setup();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return { state: "signedIn", account: "person@example.com" };
      }
      if (command === "scan_installed_apps") {
        return [scannedApp];
      }
      if (command === "download_ipa") {
        return { ok: true, item: downloadedIpa };
      }
      if (command === "delete_local_ipas") {
        return [];
      }
      if (command === "fetch_app_icons" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Download selected" }));

    expect(await screen.findByText("0 selected of 1 IPA")).toBeInTheDocument();
    expect(screen.getByText("Example App")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Apps & IPA$/ }));
    expect(screen.getByText("Downloaded")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Install$/ }));
    await user.click(screen.getByRole("button", { name: "Delete IPA for com.example.app" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete selected IPA files" })
    );
    expect(await screen.findByText("0 selected of 0 IPA")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Apps & IPA$/ }));
    expect(screen.getByText("Not downloaded")).toBeInTheDocument();
  });

  it("synchronizes removal of a missing entry across both tabs", async () => {
    const user = userEvent.setup();
    const matchingMissingIpa = { ...missingIpa, bundleId: scannedApp.bundleId, appName: scannedApp.name };
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "scan_installed_apps") {
        return [scannedApp];
      }
      if (command === "list_local_ipas") {
        return [matchingMissingIpa];
      }
      if (command === "delete_local_ipas" || command === "fetch_app_icons" || command === "read_activity_log") {
        return [];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    expect(await screen.findByText("IPA file is missing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Install$/ }));
    await user.click(screen.getByRole("button", { name: "Remove entry for com.example.app" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove entry" }));
    expect(await screen.findByText("0 selected of 0 IPA")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Apps & IPA$/ }));
    expect(screen.getByText("Not downloaded")).toBeInTheDocument();
  });

  it("does not let a late scan response overwrite a downloaded library status", async () => {
    const user = userEvent.setup();
    const lateScan = deferred<(typeof scannedApp)[]>();
    let scanCount = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return { state: "signedIn", account: "person@example.com" };
      }
      if (command === "scan_installed_apps") {
        scanCount += 1;
        return scanCount === 1 ? [scannedApp] : lateScan.promise;
      }
      if (command === "download_ipa") {
        return { ok: true, item: downloadedIpa };
      }
      if (command === "fetch_app_icons" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    await screen.findByText("Example App");
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Download selected" }));
    expect(await screen.findByText("0 selected of 1 IPA")).toBeInTheDocument();

    lateScan.resolve([scannedApp]);
    await user.click(screen.getByRole("button", { name: /Apps & IPA$/ }));
    expect(await screen.findByText("Downloaded")).toBeInTheDocument();
  });

  it("shows the initial scan before data sizes and ignores a late size result after rescan", async () => {
    const user = userEvent.setup();
    const sizeBatch = deferred<{
      batchId: string;
      items: { bundleId: string; dynamicDiskUsageBytes: number; status: "loaded" }[];
      cancelled: boolean;
    }>();
    let scanCount = 0;
    let dataSizeBatchId = "";

    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "scan_installed_apps") {
        scanCount += 1;
        return [
          {
            ...scannedApp,
            name: scanCount === 1 ? "Example App" : "Fresh Scan App",
            staticDiskUsageBytes: scanCount === 1 ? 100 : 200
          }
        ];
      }
      if (command === "fetch_app_data_sizes") {
        dataSizeBatchId = (args as { batchId: string }).batchId;
        return sizeBatch.promise;
      }
      if (
        command === "cancel_app_data_sizes" ||
        command === "write_activity_event"
      ) {
        return undefined;
      }
      if (command === "fetch_app_icons" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    expect(await screen.findByText("Example App")).toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "fetch_app_data_sizes")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Load data sizes" }));
    expect(await screen.findByRole("button", { name: "Loading data sizes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    expect(await screen.findByText("Fresh Scan App")).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("cancel_app_data_sizes", { batchId: dataSizeBatchId });

    sizeBatch.resolve({
      batchId: dataSizeBatchId,
      items: [{ bundleId: scannedApp.bundleId, dynamicDiskUsageBytes: 900, status: "loaded" }],
      cancelled: false
    });
    await act(async () => Promise.resolve());

    const freshRow = screen.getByText("Fresh Scan App").closest(".tableRow");
    expect(freshRow).not.toBeNull();
    expect(within(freshRow as HTMLElement).getByText("—")).toBeInTheDocument();
  });

  it("cancels data size loading when refresh detects a disconnect", async () => {
    const user = userEvent.setup();
    const sizeBatch = deferred<{
      batchId: string;
      items: never[];
      cancelled: boolean;
    }>();
    let detectCount = 0;
    let dataSizeBatchId = "";

    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        detectCount += 1;
        return detectCount === 1 ? [sourceDevice] : [];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "scan_installed_apps") {
        return [{ ...scannedApp, staticDiskUsageBytes: 100 }];
      }
      if (command === "fetch_app_data_sizes") {
        dataSizeBatchId = (args as { batchId: string }).batchId;
        return sizeBatch.promise;
      }
      if (command === "cancel_app_data_sizes" || command === "write_activity_event") {
        return undefined;
      }
      if (command === "fetch_app_icons" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    await user.click(await screen.findByRole("button", { name: "Load data sizes" }));
    expect(await screen.findByRole("button", { name: "Loading data sizes" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Refresh iPhone" }));
    expect(await screen.findByText("Connect iPhone")).toBeInTheDocument();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("cancel_app_data_sizes", { batchId: dataSizeBatchId });

    sizeBatch.resolve({ batchId: dataSizeBatchId, items: [], cancelled: true });
    await act(async () => Promise.resolve());
    expect(screen.getByRole("button", { name: "Load data sizes" })).toBeDisabled();
  });

  it("merges a data size batch without resetting selection, search, or sort", async () => {
    const user = userEvent.setup();

    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "scan_installed_apps") {
        return [{ ...scannedApp, staticDiskUsageBytes: 1024 }];
      }
      if (command === "fetch_app_data_sizes") {
        const batchId = (args as { batchId: string }).batchId;
        return {
          batchId,
          items: [{ bundleId: scannedApp.bundleId, dynamicDiskUsageBytes: 2048, status: "loaded" }],
          cancelled: false
        };
      }
      if (command === "fetch_app_icons" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    const checkbox = await screen.findByRole("checkbox");
    await user.click(checkbox);
    await user.type(screen.getByPlaceholderText("Search apps or bundle IDs"), "Example");
    await user.click(screen.getByRole("button", { name: "Sort Size ascending" }));
    await user.click(screen.getByRole("button", { name: "Load data sizes" }));

    expect(await screen.findByText("3 KB")).toBeInTheDocument();
    expect(checkbox).toBeChecked();
    expect(screen.getByPlaceholderText("Search apps or bundle IDs")).toHaveValue("Example");
    expect(screen.getByRole("columnheader", { name: "Size" })).toHaveAttribute("aria-sort", "ascending");
  });

  it("reconciles a manually missing IPA when the window regains focus", async () => {
    const user = userEvent.setup();
    let fileMissing = false;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "scan_installed_apps") {
        return [scannedApp];
      }
      if (command === "list_local_ipas") {
        return [{ ...downloadedIpa, status: fileMissing ? "missing" : "downloaded" }];
      }
      if (command === "fetch_app_icons" || command === "read_activity_log") {
        return [];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Not signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    expect(await screen.findByText("Downloaded")).toBeInTheDocument();

    fileMissing = true;
    act(() => window.dispatchEvent(new Event("focus")));
    expect(await screen.findByText("IPA file is missing")).toBeInTheDocument();
  });

  it("updates the sidebar immediately when the real download rejects an expired session", async () => {
    const user = userEvent.setup();
    let downloadAttempted = false;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        return [sourceDevice];
      }
      if (command === "get_apple_auth_status") {
        return downloadAttempted
          ? { state: "sessionExpired", account: "person@example.com" }
          : { state: "signedIn", account: "person@example.com" };
      }
      if (command === "scan_installed_apps") {
        return [scannedApp];
      }
      if (command === "fetch_app_icons" || command === "list_local_ipas" || command === "read_activity_log") {
        return [];
      }
      if (command === "download_ipa") {
        downloadAttempted = true;
        throw { code: "AUTH_REQUIRED", userMessage: "Apple ID is not signed in." };
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Signed in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Scan apps" }));
    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Download selected" }));

    await waitFor(() => {
      expect(screen.getByText("Session expired")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Sign in with Apple ID again");
    });
    expect(screen.queryByText("Signed in")).not.toBeInTheDocument();
  });

  it("refreshes a disconnected sidebar to a connected iPhone without scanning apps or accepting a second click", async () => {
    const user = userEvent.setup();
    const refreshedDetection = deferred<(typeof newDevice)[]>();
    const events: {
      timestamp: string;
      level: "info" | "success" | "warning" | "error";
      taskName: string;
      message: string;
    }[] = [];
    let detectCount = 0;

    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        detectCount += 1;
        return detectCount === 1 ? [] : refreshedDetection.promise;
      }
      if (command === "get_device_info") {
        expect(args).toEqual({ deviceId: newDevice.udid });
        return newDevice;
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "list_local_ipas") {
        return [];
      }
      if (command === "write_activity_event") {
        const event = args as {
          level: "info" | "success" | "warning" | "error";
          taskName: string;
          message: string;
        };
        events.push({ timestamp: "2026-07-10T10:00:00.000Z", ...event });
        return undefined;
      }
      if (command === "read_activity_log") {
        return [...events];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Connect iPhone")).toBeInTheDocument();

    const refreshButton = screen.getByRole("button", { name: "Refresh iPhone" });
    await user.click(refreshButton);
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute("aria-busy", "true");
    await user.click(refreshButton);
    expect(detectCount).toBe(2);

    refreshedDetection.resolve([newDevice]);
    expect(await screen.findByText("New iPhone")).toBeInTheDocument();
    expect(screen.getByText("iPhone 16 Pro")).toBeInTheDocument();
    expect(screen.getByText("iOS 26.0")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(await screen.findByText("iPhone connected")).toBeInTheDocument();
    expect(refreshButton).toBeEnabled();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "scan_installed_apps")).toBe(false);
  });

  it("clears stale device metadata and battery when refresh detects a disconnect", async () => {
    const user = userEvent.setup();
    const events: {
      timestamp: string;
      level: "info" | "success" | "warning" | "error";
      taskName: string;
      message: string;
    }[] = [];
    let detectCount = 0;

    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        detectCount += 1;
        return detectCount === 1 ? [oldDevice] : [];
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "list_local_ipas") {
        return [];
      }
      if (command === "write_activity_event") {
        const event = args as {
          level: "info" | "success" | "warning" | "error";
          taskName: string;
          message: string;
        };
        events.push({ timestamp: "2026-07-10T10:01:00.000Z", ...event });
        return undefined;
      }
      if (command === "read_activity_log") {
        return [...events];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Old iPhone")).toBeInTheDocument();
    expect(screen.getByText("83%")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh iPhone" }));
    expect(await screen.findByText("Connect iPhone")).toBeInTheDocument();
    expect(screen.queryByText("Old iPhone")).not.toBeInTheDocument();
    expect(screen.queryByText("iPhone 14 Pro Max")).not.toBeInTheDocument();
    expect(screen.queryByText("83%")).not.toBeInTheDocument();
    expect(await screen.findByText("iPhone disconnected")).toBeInTheDocument();
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "scan_installed_apps")).toBe(false);
  });

  it("replaces the previous UDID and metadata when refresh finds another iPhone", async () => {
    const user = userEvent.setup();
    const events: {
      timestamp: string;
      level: "info" | "success" | "warning" | "error";
      taskName: string;
      message: string;
    }[] = [];
    const detectedNewDevice = {
      ...newDevice,
      name: null,
      model: null,
      iosVersion: null,
      batteryPercent: null
    };
    let detectCount = 0;

    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === "get_engine_status") {
        return { ready: true, missing: [] };
      }
      if (command === "detect_devices") {
        detectCount += 1;
        return detectCount === 1 ? [oldDevice] : [detectedNewDevice];
      }
      if (command === "get_device_info") {
        expect(args).toEqual({ deviceId: newDevice.udid });
        return newDevice;
      }
      if (command === "get_apple_auth_status") {
        return { state: "notSignedIn" };
      }
      if (command === "list_local_ipas") {
        return [];
      }
      if (command === "write_activity_event") {
        const event = args as {
          level: "info" | "success" | "warning" | "error";
          taskName: string;
          message: string;
        };
        events.push({ timestamp: "2026-07-10T10:02:00.000Z", ...event });
        return undefined;
      }
      if (command === "read_activity_log") {
        return [...events];
      }
      return undefined;
    });

    renderWithI18n(<App />);
    expect(await screen.findByText("Old iPhone")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh iPhone" }));
    expect(await screen.findByText("New iPhone")).toBeInTheDocument();
    expect(screen.getByText("111111...111111")).toBeInTheDocument();
    expect(screen.getByText("iPhone 16 Pro")).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.queryByText("Old iPhone")).not.toBeInTheDocument();
    expect(screen.queryByText("000000...000000")).not.toBeInTheDocument();
    expect(await screen.findByText("iPhone connection updated")).toBeInTheDocument();
  });
});
