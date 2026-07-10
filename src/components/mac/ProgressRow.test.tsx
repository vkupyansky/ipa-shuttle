import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./EmptyState";
import { ErrorBanner } from "./ErrorBanner";
import { ProgressRow } from "./ProgressRow";
import { renderWithI18n } from "../../test/renderWithI18n";

describe("mac utility components", () => {
  it.each([
    ["notDownloaded", "Not downloaded"],
    ["idle", "Ready"],
    ["downloading", "Downloading"],
    ["downloaded", "Downloaded"],
    ["installing", "Installing"],
    ["installed", "Installed"],
    ["failed", "Error"],
    ["missing", "IPA file is missing"]
  ] as const)("renders progress status %s", (status, label) => {
    const { container } = renderWithI18n(<ProgressRow status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("renders empty state body and dismissible errors", () => {
    renderWithI18n(
      <>
        <EmptyState title="Empty title">Empty body</EmptyState>
        <ErrorBanner error={{ code: "TEST", userMessage: "Readable error" }} onDismiss={() => undefined} />
      </>
    );

    expect(screen.getByText("Empty title")).toBeInTheDocument();
    expect(screen.getByText("Empty body")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Readable error");
    expect(screen.getByRole("button", { name: "Dismiss error" })).toBeInTheDocument();
  });

  it("does not render an error banner without an error", () => {
    renderWithI18n(<ErrorBanner error={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
