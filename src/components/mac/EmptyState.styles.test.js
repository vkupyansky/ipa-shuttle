import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("EmptyState styles", () => {
  it("fills and centers the available list area without a dashed border", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const emptyStateRule = css.match(/\.emptyState\s*\{(?<declarations>[^}]*)\}/)?.groups?.declarations;

    expect(emptyStateRule).toBeDefined();
    expect(emptyStateRule).toContain("flex: 1 1 auto");
    expect(emptyStateRule).toContain("place-items: center");
    expect(emptyStateRule).toContain("place-content: center");
    expect(emptyStateRule).not.toContain("border");
    expect(emptyStateRule).not.toContain("dashed");
  });
});
