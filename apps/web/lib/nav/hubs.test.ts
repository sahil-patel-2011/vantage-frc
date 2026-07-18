import { describe, expect, it } from "vitest";
import { hubById, hubHref, isHubTab, PRODUCT_HUBS } from "./hubs";

describe("product hubs", () => {
  it("defines the five shipping hubs", () => {
    expect(PRODUCT_HUBS.map((hub) => hub.id)).toEqual([
      "competition", "team", "business", "build", "ai",
    ]);
  });
  it("validates tabs and builds deep links", () => {
    const competition = hubById("competition");
    expect(isHubTab(competition, "scouting")).toBe(true);
    expect(isHubTab(competition, "pit")).toBe(false);
    expect(hubHref("/business", "orders", "org-1")).toBe("/business?tab=orders&orgId=org-1");
  });
});
