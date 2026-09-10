import { describe, expect, it } from "vitest";
import { resolveGrid, widgetLockReason } from "../../app/dashboard/dashboard-canvas";
import { WIDGET_CATALOG } from "./catalog";

describe("dashboard canvas helpers", () => {
  it("collapses the board to one column on a phone-width canvas", () => {
    expect(resolveGrid(360).cols).toBe(1);
    expect(resolveGrid(500).cols).toBe(2);
    expect(resolveGrid(1200).cols).toBeGreaterThanOrEqual(3);
  });

  it("names the role gate in words, not an empty lock", () => {
    const locked = WIDGET_CATALOG.find((entry) => (entry.roles ?? []).length > 0);
    expect(locked, "catalog should include at least one role-gated widget").toBeTruthy();
    if (!locked) return;
    const reason = widgetLockReason(locked);
    expect(reason).toMatch(/only/i);
    expect(reason).not.toMatch(/undefined/);
  });
});
