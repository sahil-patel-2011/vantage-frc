import { describe, expect, it } from "vitest";
import {
  VENDORS_RELATED_INCLUDE,
  classifyVendorsShell,
  formatVendorsMetric,
  shouldShowVendorsSummaryTiles,
  vendorsNextActions,
  vendorsRelatedLinks,
  vendorsShellCopy,
} from "./vendors-related";

describe("vendorsRelatedLinks", () => {
  it("builds Orders / Vendor Lead Times cross-links via hubHref / withOrgHref", () => {
    const links = vendorsRelatedLinks("org-1", {
      include: [...VENDORS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["orders", "vendor-lead-times"]);
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "vendor-lead-times")?.href).toBe(
      "/business?tab=vendor-lead-times&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = vendorsRelatedLinks("org-1", {
      active: "orders",
      include: ["vendor-lead-times", "inventory"],
    });
    expect(links.map((l) => l.id)).toEqual(["vendor-lead-times", "inventory"]);
    expect(links.find((l) => l.id === "inventory")?.href).toBe("/inventory?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(vendorsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("vendorsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = vendorsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "vendor-lead-times")).toBe(true);
  });

  it("setup with org points at Workspace + Orders / Vendor Lead Times", () => {
    const actions = vendorsNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "vendor-lead-times")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at add-vendor + Orders / Vendor Lead Times", () => {
    const actions = vendorsNextActions({
      orgId: "org-1",
      shell: "empty",
      vendorCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["add-vendor", "orders", "vendor-lead-times"]),
    );
    expect(actions[0]?.href).toBe("#vendors-add-vendor");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize contacts / Orders without DEMO counts", () => {
    const actions = vendorsNextActions({
      orgId: "org-1",
      shell: "ready",
      vendorCount: 2,
      preferredCount: 1,
      missingContactCount: 1,
    });
    expect(actions[0]?.id).toBe("fill-contacts");
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "vendor-lead-times")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyVendorsShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyVendorsShell({ loading: true })).toBe("loading");
    expect(classifyVendorsShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyVendorsShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe("error");
    expect(
      classifyVendorsShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyVendorsShell({
        loading: false,
        orgId: "o1",
        status: "live",
        vendorCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyVendorsShell({
        loading: false,
        orgId: "o1",
        status: "live",
        vendorCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("vendorsShellCopy + formatVendorsMetric", () => {
  it("refuses invented DEMO vendor metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = vendorsShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent/i);
    }
    expect(vendorsShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(vendorsShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides zeroed tiles", () => {
    expect(formatVendorsMetric(null, false)).toBe("…");
    expect(formatVendorsMetric(3, true)).toBe("3");
    expect(formatVendorsMetric(-1, true)).toBe("0");
    expect(shouldShowVendorsSummaryTiles(0)).toBe(false);
    expect(shouldShowVendorsSummaryTiles(1)).toBe(true);
  });
});
