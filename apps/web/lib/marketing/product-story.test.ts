import { describe, expect, it } from "vitest";
import { NAV_HUBS, hubPrimaryTabs } from "../nav/hubs";
import { MARKETING_HUBS } from "./product-story";

describe("MARKETING_HUBS", () => {
  it("lists exactly the primary workspaces, with their routes and tab labels", () => {
    // Same set as the island and the All panel. Order is the story's own —
    // Team and Build first because that is a student's week — so compare as sets.
    expect([...MARKETING_HUBS.map((hub) => hub.id)].sort()).toEqual(
      NAV_HUBS.map((hub) => hub.id).sort(),
    );

    for (const hub of MARKETING_HUBS) {
      const product = NAV_HUBS.find((entry) => entry.id === hub.id);
      expect(product, `missing product hub ${hub.id}`).toBeDefined();
      if (!product) continue;
      expect(hub.route).toBe(product.href);
      expect([...hub.modules]).toEqual(hubPrimaryTabs(product).map((tab) => tab.label));
    }
  });

  it("never sells a hidden hub as a place to go", () => {
    expect(MARKETING_HUBS.map((hub) => hub.id)).not.toContain("ai");
    expect(MARKETING_HUBS.map((hub) => hub.id)).not.toContain("media");
  });
});
