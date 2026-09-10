import { describe, expect, it } from "vitest";
import { isPrimaryControl, PRIMARY_CONTROL_SELECTOR } from "./primary-control";

describe("primary control (R4)", () => {
  it("names every legacy and canonical primary class", () => {
    expect(PRIMARY_CONTROL_SELECTOR).toContain(".is-primary");
    expect(PRIMARY_CONTROL_SELECTOR).toContain(".app-button.primary");
    expect(PRIMARY_CONTROL_SELECTOR).toContain(".primary-action");
  });

  it("recognises Button variant=primary, .app-button.primary, and .primary-action", () => {
    expect(isPrimaryControl("is-primary")).toBe(true);
    expect(isPrimaryControl("app-button primary")).toBe(true);
    expect(isPrimaryControl("primary-action")).toBe(true);
    expect(isPrimaryControl("app-button secondary")).toBe(false);
    expect(isPrimaryControl("ghost")).toBe(false);
  });
});
