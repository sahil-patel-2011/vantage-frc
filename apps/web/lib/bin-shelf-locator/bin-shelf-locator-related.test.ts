import { describe, expect, it } from "vitest";
import {
  BIN_SHELF_LOCATOR_RELATED_INCLUDE,
  binShelfLocatorNextActions,
  binShelfLocatorRelatedLinks,
  binShelfLocatorShellCopy,
  classifyBinShelfLocatorShell,
  formatBinShelfLocatorMetric,
  shouldShowBinShelfLocatorSummaryTiles,
} from "./bin-shelf-locator-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("binShelfLocatorRelatedLinks", () => {
  it("builds Spares / CAD cross-links", () => {
    const links = binShelfLocatorRelatedLinks("org-1", {
      include: [...BIN_SHELF_LOCATOR_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["spare-forecast", "spare-robot-kit", "cad"]);
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    expect(JSON.stringify(binShelfLocatorRelatedLinks("org-1"))).not.toMatch(/DEMO/i);
  });
});

describe("binShelfLocatorNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = binShelfLocatorNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("ready boards prioritize find without DEMO metrics", () => {
    const actions = binShelfLocatorNextActions({
      orgId: "org-1",
      shell: "ready",
      locationCount: 3,
      itemCount: 5,
    });
    expect(actions[0]?.href).toBe("#bin-shelf-find");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyBinShelfLocatorShell + helpers", () => {
  it("classifies shells and hides zero tiles", () => {
    expect(classifyBinShelfLocatorShell({ loading: true })).toBe("loading");
    expect(
      classifyBinShelfLocatorShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        locationCount: 0,
      }),
    ).toBe("empty");
    expect(formatBinShelfLocatorMetric(2, true)).toBe("2");
    expect(shouldShowBinShelfLocatorSummaryTiles(0)).toBe(false);
  });

  it("copy never invents DEMO inventory pins", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = binShelfLocatorShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
