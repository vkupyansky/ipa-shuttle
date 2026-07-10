import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { renderWithI18n } from "../../test/renderWithI18n";

describe("AppShell", () => {
  it("renders compact header navigation and language switcher", async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    const onToggleLog = vi.fn();
    const onRefreshDevice = vi.fn();
    const onOpenLibrary = vi.fn();

    renderWithI18n(
      <AppShell
        activeStep={0}
        logs={[]}
        logOpen={false}
        sidebarDevice={null}
        sidebarRole="source"
        authStatus={{ state: "notSignedIn" }}
        authLoading={false}
        deviceRefreshing={false}
        onStepClick={onStepClick}
        onToggleLog={onToggleLog}
        onRefreshDevice={onRefreshDevice}
        onOpenLibrary={onOpenLibrary}
        onOpenSignIn={vi.fn()}
        onUseSavedSession={vi.fn()}
        onForgetSession={vi.fn()}
        onClearLogs={vi.fn()}
        onLogsChanged={vi.fn()}
      >
        <span>Workspace child</span>
      </AppShell>
    );

    expect(screen.getByText("IPA Shuttle")).toBeInTheDocument();
    expect(screen.getByText("Workspace child")).toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "Refresh iPhone" });
    const openLibraryButton = screen.getByRole("button", { name: "Open Library" });
    expect(refreshButton).toBeInTheDocument();
    expect(openLibraryButton).toBeInTheDocument();
    expect(refreshButton.compareDocumentPosition(openLibraryButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with Apple ID" })).toBeInTheDocument();
    expect(screen.queryByText("IPA Shuttle", { selector: ".appHeader__mark" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Activity Log/i }));
    await user.click(screen.getByRole("button", { name: /Install/i }));
    await user.click(screen.getByRole("button", { name: "Refresh iPhone" }));
    await user.click(screen.getByRole("button", { name: "Open Library" }));
    await user.click(screen.getByRole("button", { name: "Русский" }));

    expect(onToggleLog).toHaveBeenCalled();
    expect(onStepClick).toHaveBeenCalledWith(1);
    expect(onRefreshDevice).toHaveBeenCalledOnce();
    expect(onOpenLibrary).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Русский" })).toHaveClass("is-active");
    expect(screen.queryByText("EN")).not.toBeInTheDocument();
    expect(screen.queryByText("RU")).not.toBeInTheDocument();
  });

  it("does not show Signed in for saved session markers", () => {
    renderWithI18n(
      <AppShell
        activeStep={0}
        logs={[]}
        logOpen={false}
        sidebarDevice={null}
        sidebarRole="source"
        authStatus={{ state: "savedSessionAvailable" }}
        authLoading={false}
        deviceRefreshing={false}
        onStepClick={vi.fn()}
        onToggleLog={vi.fn()}
        onRefreshDevice={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenSignIn={vi.fn()}
        onUseSavedSession={vi.fn()}
        onForgetSession={vi.fn()}
        onClearLogs={vi.fn()}
        onLogsChanged={vi.fn()}
      >
        <span>Workspace child</span>
      </AppShell>
    );

    expect(screen.getByText("Saved session available")).toBeInTheDocument();
    expect(screen.queryByText("Signed in")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use saved session" })).toBeInTheDocument();
  });

  it("disables Refresh iPhone and spins its icon while refreshing", () => {
    renderWithI18n(
      <AppShell
        activeStep={0}
        logs={[]}
        logOpen={false}
        sidebarDevice={null}
        sidebarRole="source"
        authStatus={{ state: "notSignedIn" }}
        authLoading={false}
        deviceRefreshing
        onStepClick={vi.fn()}
        onToggleLog={vi.fn()}
        onRefreshDevice={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenSignIn={vi.fn()}
        onUseSavedSession={vi.fn()}
        onForgetSession={vi.fn()}
        onClearLogs={vi.fn()}
        onLogsChanged={vi.fn()}
      >
        <span>Workspace child</span>
      </AppShell>
    );

    const refreshButton = screen.getByRole("button", { name: "Refresh iPhone" });
    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveAttribute("aria-busy", "true");
    expect(refreshButton.querySelector(".spin")).toBeInTheDocument();
  });
});
