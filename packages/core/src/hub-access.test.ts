import { describe, expect, it } from "vitest";
import { sponsorsUiAllowed } from "./hub-access";

describe("sponsorsUiAllowed", () => {
  it("treats null/undefined as allowed (legacy orgs)", () => {
    expect(sponsorsUiAllowed({ sponsorsAllowed: null })).toBe(true);
    expect(sponsorsUiAllowed({ sponsorsAllowed: undefined as unknown as null })).toBe(true);
  });

  it("hides sponsor Soft-UI when funding profile sets false", () => {
    expect(sponsorsUiAllowed({ sponsorsAllowed: false })).toBe(false);
    expect(sponsorsUiAllowed({ sponsorsAllowed: true })).toBe(true);
  });
});
