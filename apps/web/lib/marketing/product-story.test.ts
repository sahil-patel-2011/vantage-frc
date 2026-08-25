import { describe, expect, it } from "vitest";
import { PRODUCT_HUBS, hubPrimaryTabs } from "../nav/hubs";
import { MARKETING_HUBS } from "./product-story";

describe("MARKETING_HUBS", () => {
  it("matches the product hub ids, routes, and primary tab labels", () => {
    expect(MARKETING_HUBS.map((hub) => hub.id)).toEqual(PRODUCT_HUBS.map((hub) => hub.id));

    for (const hub of MARKETING_HUBS) {
      const product = PRODUCT_HUBS.find((entry) => entry.id === hub.id);
      expect(product, `missing product hub ${hub.id}`).toBeDefined();
      if (!product) continue;
      expect(hub.route).toBe(product.href);
      expect([...hub.modules]).toEqual(hubPrimaryTabs(product).map((tab) => tab.label));
    }
  });
});
