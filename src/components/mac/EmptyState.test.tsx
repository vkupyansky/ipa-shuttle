import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithI18n } from "../../test/renderWithI18n";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the shared empty-state structure", () => {
    const { container } = renderWithI18n(<EmptyState title="Empty title">Empty body</EmptyState>);

    expect(screen.getByText("Empty title")).toBeInTheDocument();
    expect(screen.getByText("Empty body")).toBeInTheDocument();
    expect(container.querySelectorAll(".emptyState")).toHaveLength(1);
  });
});
