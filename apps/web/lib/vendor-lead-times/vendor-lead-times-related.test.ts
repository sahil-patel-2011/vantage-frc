import { describe, expect, it } from "vitest";
import {
  VENDOR_LEAD_TIMES_RELATED_INCLUDE,
  classifyVendorLeadTimesShell,
  formatVendorLeadTimesMetric,
  shouldShowVendorLeadTimesSummaryTiles,
  vendorLeadTimesNextActions,
  vendorLeadTimesRelatedLinks,
  vendorLeadTimesShellCopy,
} from "./vendor-lead-times-related";

describe("vendorLeadTimesRelatedLinks", () => {
  it("builds Orders / Spare Forecast / Vendors cross-links", () => {
    const links = vendorLeadTimesRelatedLinks("org-1", {
      include: [...VENDOR_LEAD_TIMES_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["orders", "spare-forecast", "vendors"]);
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "spare-forecast")?.href).toBe(
      "/build?tab=spare-forecast&orgId=org-1",
    );
    expect(links.find((l) => l.id === "vendors")?.href).toBe("/vendors?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = vendorLeadTimesRelatedLinks("org-1", {
      active: "orders",
      include: ["spare-forecast", "vendors"],
    });
    expect(links.map((l) => l.id)).toEqual(["spare-forecast", "vendors"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(vendorLeadTimesRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("vendorLeadTimesNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = vendorLeadTimesNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(true);
    expect(actions.some((a) => a.id === "vendors")).toBe(true);
  });

  it("setup with org points at Workspace + Orders / Spare Forecast / Vendors", () => {
    const actions = vendorLeadTimesNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(true);
    expect(actions.some((a) => a.id === "vendors")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at add-vendor + Orders / Spare Forecast / Vendors", () => {
    const actions = vendorLeadTimesNextActions({
      orgId: "org-1",
      shell: "empty",
      vendorCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["add-vendor", "orders", "spare-forecast", "vendors"]),
    );
    expect(actions[0]?.href).toBe("#vendor-lead-times-add-vendor");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize reorders / Orders without DEMO counts", () => {
    const actions = vendorLeadTimesNextActions({
      orgId: "org-1",
      shell: "ready",
      vendorCount: 2,
      openReorderCount: 1,
      overdueCount: 1,
    });
    expect(actions[0]?.id).toBe("reorders");
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(true);
    expect(actions.some((a) => a.id === "vendors")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyVendorLeadTimesShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyVendorLeadTimesShell({ loading: true })).toBe("loading");
    expect(classifyVendorLeadTimesShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyVendorLeadTimesShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyVendorLeadTimesShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyVendorLeadTimesShell({
        loading: false,
        orgId: "o1",
        status: "live",
        vendorCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyVendorLeadTimesShell({
        loading: false,
        orgId: "o1",
        status: "live",
        vendorCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("vendorLeadTimesShellCopy + formatVendorLeadTimesMetric", () => {
  it("refuses invented DEMO reorder metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = vendorLeadTimesShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent/i);
    }
    expect(vendorLeadTimesShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(vendorLeadTimesShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides zeroed tiles", () => {
    expect(formatVendorLeadTimesMetric(null, false)).toBe("…");
    expect(formatVendorLeadTimesMetric(3, true)).toBe("3");
    expect(formatVendorLeadTimesMetric(-1, true)).toBe("0");
    expect(shouldShowVendorLeadTimesSummaryTiles(0)).toBe(false);
    expect(shouldShowVendorLeadTimesSummaryTiles(1)).toBe(true);
  });
});
