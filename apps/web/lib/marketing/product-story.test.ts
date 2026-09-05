import { describe, expect, it } from "vitest";
import { PRODUCT_HUBS, PRODUCT_WORKSPACES, hubPrimaryTabs } from "../nav/hubs";
import {
  MARKETING_DEFINITION,
  MARKETING_HUBS,
  MARKETING_WORKSPACES,
  marketingWorkspacesForHub,
} from "./product-story";

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

describe("MARKETING_WORKSPACES", () => {
  /*
   * The site used to retype the nav, and drifted into advertising a drawer the
   * app had already replaced. These names are the ones a visitor will look for
   * after they sign in, so they have to be the product's own.
   */
  it("names the shipped workspaces, in shipped order", () => {
    expect(MARKETING_WORKSPACES.map((workspace) => workspace.title)).toEqual(
      PRODUCT_WORKSPACES.map((workspace) => workspace.label),
    );
    expect(MARKETING_WORKSPACES.map((workspace) => workspace.id)).toEqual(
      PRODUCT_WORKSPACES.map((workspace) => workspace.id),
    );
  });

  it("describes each workspace without fabricated scores", () => {
    const blob = MARKETING_WORKSPACES.map((workspace) => workspace.copy).join(" ");
    expect(blob).not.toMatch(/\bDEMO\b|win rate|invented EPA/i);
    expect(MARKETING_WORKSPACES.every((workspace) => workspace.copy.length > 0)).toBe(true);
  });

  it("routes every hub to at least one workspace so /features can say where it lives", () => {
    for (const hub of MARKETING_HUBS) {
      const opensFrom = marketingWorkspacesForHub(hub.id);
      expect(opensFrom.length, `no workspace opens ${hub.id}`).toBeGreaterThan(0);
      expect(opensFrom.every((name) => PRODUCT_WORKSPACES.some((w) => w.label === name))).toBe(true);
    }
    // Competition is reachable from two, which is the one case the copy must not flatten.
    expect(marketingWorkspacesForHub("competition")).toEqual(["Scout", "Compete"]);
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
