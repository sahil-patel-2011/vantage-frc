import { describe, expect, it } from "vitest";
import {
  SPARE_FORECAST_RELATED_INCLUDE,
  classifySpareForecastShell,
  formatSpareForecastMetric,
  spareForecastNextActions,
  spareForecastRelatedLinks,
  spareForecastShellCopy,
} from "./spare-forecast-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("spareForecastRelatedLinks", () => {
  it("builds Batteries / Orders / Subsystems cross-links", () => {
    const links = spareForecastRelatedLinks("org-1", {
      include: [...SPARE_FORECAST_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["batteries", "orders", "subsystems"]);
    expect(links.find((l) => l.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "subsystems")?.href).toBe("/subsystems?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = spareForecastRelatedLinks("org-1", {
      active: "orders",
      include: ["batteries", "subsystems"],
    });
    expect(links.map((l) => l.id)).toEqual(["batteries", "subsystems"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(spareForecastRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("spareForecastNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = spareForecastNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
  });

  it("setup with org points at Workspace + Batteries / Orders / Subsystems", () => {
    const actions = spareForecastNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at inventory + Subsystems / Batteries / Orders", () => {
    const actions = spareForecastNextActions({
      orgId: "org-1",
      shell: "empty",
      spareBinCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["inventory", "subsystems", "batteries", "orders"]),
    );
    expect(actions[0]?.href).toBe("/inventory?orgId=org-1");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("no-risk boards prioritize FMEA / Subsystems without DEMO counts", () => {
    const actions = spareForecastNextActions({
      orgId: "org-1",
      shell: "no_risk",
      spareBinCount: 3,
      forecastLineCount: 0,
    });
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("offseason ready boards skip a restock draft when remaining-season risk is unknown", () => {
    const actions = spareForecastNextActions({
      orgId: "org-1",
      shell: "ready",
      spareBinCount: 4,
      forecastLineCount: 2,
      criticalCount: 0,
      purchaseRequestCount: 0,
      seasonHorizon: "offseason",
    });
    expect(actions.some((a) => a.id === "draft")).toBe(false);
    expect(actions.some((a) => a.id === "fmea" || a.id === "orders")).toBe(true);
  });

  it("ready boards prioritize Orders / Batteries / Subsystems", () => {
    const actions = spareForecastNextActions({
      orgId: "org-1",
      shell: "ready",
      spareBinCount: 4,
      forecastLineCount: 2,
      criticalCount: 1,
      purchaseRequestCount: 0,
    });
    expect(actions[0]?.id).toBe("draft");
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifySpareForecastShell", () => {
  it("classifies loading / error / setup / empty / no_risk / ready without DEMO counts", () => {
    expect(classifySpareForecastShell({ loading: true })).toBe("loading");
    expect(classifySpareForecastShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifySpareForecastShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifySpareForecastShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifySpareForecastShell({
        loading: false,
        orgId: "o1",
        status: "live",
        spareBinCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifySpareForecastShell({
        loading: false,
        orgId: "o1",
        status: "live",
        spareBinCount: 2,
        forecastLineCount: 0,
      }),
    ).toBe("no_risk");
    expect(
      classifySpareForecastShell({
        loading: false,
        orgId: "o1",
        status: "live",
        spareBinCount: 2,
        forecastLineCount: 1,
      }),
    ).toBe("ready");
    // Offseason + logged FMEA lines is ready, never the no-risk empty state.
    expect(
      classifySpareForecastShell({
        loading: false,
        orgId: "o1",
        status: "live",
        spareBinCount: 2,
        forecastLineCount: 3,
      }),
    ).toBe("ready");
  });
});

describe("spareForecastShellCopy + formatSpareForecastMetric", () => {
  it("refuses invented DEMO spare counts in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready", "no_risk"] as const) {
      const copy = spareForecastShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(spareForecastShellCopy("empty").description);
    expectPlainCopy(spareForecastShellCopy("setup").description);
  });

  it("formats real counts only", () => {
    expect(formatSpareForecastMetric(null, false)).toBe("…");
    expect(formatSpareForecastMetric(null, true)).toBe("—");
    expect(formatSpareForecastMetric(3, true)).toBe("3");
    expect(formatSpareForecastMetric(-1, true)).toBe("0");
  });
});
