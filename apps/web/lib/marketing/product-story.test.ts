import { describe, expect, it } from "vitest";
import { PRODUCT_HUBS, hubPrimaryTabs } from "../nav/hubs";
import { MARKETING_DEFINITION, MARKETING_HUBS, MARKETING_JOBS } from "./product-story";

describe("MARKETING_DEFINITION", () => {
  it("names FRC and refuses invented metrics", () => {
    expect(MARKETING_DEFINITION.headline).toMatch(/FRC/i);
    expect(MARKETING_DEFINITION.lead).toMatch(/operations software/i);
    expect(MARKETING_DEFINITION.lead).toMatch(/scouting/i);
    expect(`${MARKETING_DEFINITION.headline} ${MARKETING_DEFINITION.lead}`).not.toMatch(
      /\bDEMO\b|win rate|invented EPA/i,
    );
  });
});

describe("MARKETING_JOBS", () => {
  it("covers scout, compete, build, and season ops without fabricated scores", () => {
    expect(MARKETING_JOBS.map((job) => job.title)).toEqual([
      "Scout",
      "Compete",
      "Build",
      "Run the season",
    ]);
    const blob = MARKETING_JOBS.map((job) => job.copy).join(" ");
    expect(blob).not.toMatch(/\bDEMO\b|win rate|invented EPA/i);
  });
});

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
