import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { MacActivityLog } from "./MacActivityLog";
import { renderWithI18n } from "../../test/renderWithI18n";
import type { LogEntry } from "../../lib/types";

const entries: LogEntry[] = [
  {
    timestamp: "2026-07-09T10:00:00.000Z",
    level: "success",
    taskName: "Scan",
    message: "Scan completed: 1 apps found",
    durationMs: 42
  },
  {
    timestamp: "2026-07-09T10:01:00.000Z",
    level: "warning",
    taskName: "Download",
    message: "Download blocked: Apple ID not signed in",
    technicalDetails: "stderr: auth required"
  },
  {
    timestamp: "2026-07-09T10:02:00.000Z",
    level: "error",
    taskName: "Install",
    message: "Installation failed"
  }
];

function ActivityHarness() {
  const [open, setOpen] = useState(false);
  return (
    <MacActivityLog
      open={open}
      entries={entries}
      onToggle={() => setOpen((current) => !current)}
      onClearLogs={vi.fn()}
      onActivityChanged={vi.fn()}
    />
  );
}

function ClearLogsHarness() {
  const [open, setOpen] = useState(true);
  const [currentEntries, setCurrentEntries] = useState(entries);
  return (
    <MacActivityLog
      open={open}
      entries={currentEntries}
      onToggle={() => setOpen((current) => !current)}
      onClearLogs={() => setCurrentEntries([])}
      onActivityChanged={vi.fn()}
    />
  );
}

describe("MacActivityLog", () => {
  it("toggles from collapsed summary to expanded timeline", async () => {
    const user = userEvent.setup();

    renderWithI18n(<ActivityHarness />);

    expect(screen.getByText("Activity Log")).toBeInTheDocument();
    expect(screen.getByText("Installation failed")).toBeInTheDocument();
    expect(screen.queryByText("Install: Installation failed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Activity Log/i }));

    expect(screen.getByText("Logs are kept for 7 days. Files rotate at 5 MB, keeping 3 archives.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy diagnostics" })).toBeInTheDocument();
  });

  it("does not let an old error replace the latest operation summary", () => {
    renderWithI18n(
      <MacActivityLog
        open={false}
        entries={[
          { timestamp: "2026-07-09T10:00:00.000Z", level: "error", taskName: "Download", message: "Old failure" },
          {
            timestamp: "2026-07-09T10:10:00.000Z",
            level: "success",
            taskName: "Download",
            message: "IPA downloaded: Authenticator"
          }
        ]}
        onToggle={vi.fn()}
        onClearLogs={vi.fn()}
        onActivityChanged={vi.fn()}
      />
    );

    expect(screen.getByText("IPA downloaded: Authenticator")).toBeInTheDocument();
    expect(screen.queryByText("Old failure")).not.toBeInTheDocument();
  });

  it("filters warnings, expands details, copies diagnostics, and opens logs folder", async () => {
    const user = userEvent.setup();
    const onActivityChanged = vi.fn();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "read_activity_diagnostics") {
        return "diagnostics";
      }
      return undefined;
    });

    renderWithI18n(
      <MacActivityLog
        open
        entries={entries}
        onToggle={vi.fn()}
        onClearLogs={vi.fn()}
        onActivityChanged={onActivityChanged}
      />
    );

    await user.click(screen.getByRole("button", { name: "Warnings" }));
    expect(screen.getByText("Download blocked: Apple ID not signed in")).toBeInTheDocument();
    expect(screen.queryByText("Installation failed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Details/i }));
    expect(screen.getByText("stderr: auth required")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Hide details/i }));
    expect(screen.queryByText("stderr: auth required")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy diagnostics" }));
    expect(writeText).toHaveBeenCalledWith("diagnostics");

    await user.click(screen.getByRole("button", { name: "Open logs folder" }));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("open_logs_folder", undefined);
    expect(onActivityChanged).toHaveBeenCalled();
  });

  it("shows empty state after filtering when no entries match", async () => {
    const user = userEvent.setup();
    const firstEntry = entries[0];

    renderWithI18n(
      <MacActivityLog
        open
        entries={firstEntry ? [firstEntry] : []}
        onToggle={vi.fn()}
        onClearLogs={vi.fn()}
        onActivityChanged={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Errors" }));
    expect(screen.getByText("No matching activity")).toBeInTheDocument();
  });

  it("shows no log events and uses the shared clear logs button", async () => {
    const onClearLogs = vi.fn();

    renderWithI18n(
      <MacActivityLog
        open
        entries={[]}
        onToggle={vi.fn()}
        onClearLogs={onClearLogs}
        onActivityChanged={vi.fn()}
      />
    );

    const clearButton = screen.getByRole("button", { name: "Clear logs" });
    expect(screen.getByText("No log events")).toBeInTheDocument();
    expect(clearButton).toHaveClass("button", "button--danger");

    await userEvent.click(clearButton);
    expect(onClearLogs).toHaveBeenCalled();
  });

  it("clears visible entries and collapsed summary immediately", async () => {
    const user = userEvent.setup();
    renderWithI18n(<ClearLogsHarness />);

    await user.click(screen.getByRole("button", { name: "Warnings" }));
    expect(screen.getByText("Download blocked: Apple ID not signed in")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear logs" }));
    expect(screen.getByText("No log events")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveClass("is-active");
    expect(screen.queryByText("Download blocked: Apple ID not signed in")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activity Log" }));
    expect(screen.queryByText("Installation failed")).not.toBeInTheDocument();
  });

  it("hides routine icon pipeline events and keeps long Russian messages available", () => {
    window.localStorage.setItem("ipa-shuttle.language", "ru");
    const longMessage =
      "Очень длинное сообщение журнала должно занимать доступную ширину и переноситься на несколько строк без многоточия.";
    const { container } = renderWithI18n(
      <MacActivityLog
        open
        entries={[
          { timestamp: "2026-07-09T10:00:00.000Z", level: "info", taskName: "App Icons", message: "Loading cached icons" },
          { timestamp: "2026-07-09T10:01:00.000Z", level: "warning", taskName: "Download", message: longMessage }
        ]}
        onToggle={vi.fn()}
        onClearLogs={vi.fn()}
        onActivityChanged={vi.fn()}
      />
    );

    expect(screen.getByText(longMessage)).toBeInTheDocument();
    expect(screen.queryByText("Загрузка иконок из кэша")).not.toBeInTheDocument();
    expect(container.querySelector(".activityLog__message")).toHaveTextContent(longMessage);
  });

  it("localizes current backend activity messages in Russian", () => {
    window.localStorage.setItem("ipa-shuttle.language", "ru");

    renderWithI18n(
      <MacActivityLog
        open
        entries={[
          {
            timestamp: "2026-07-09T10:00:00.000Z",
            level: "success",
            taskName: "Apple ID",
            message: "Completed Apple ID verification"
          }
        ]}
        onToggle={vi.fn()}
        onClearLogs={vi.fn()}
        onActivityChanged={vi.fn()}
      />
    );

    expect(screen.getByText("Проверка Apple ID завершена")).toBeInTheDocument();
  });
});
