import { describe, expect, it } from "vitest";
import {
  CONTROL_MAP_RELATED_INCLUDE,
  classifyControlMapShell,
  controlMapNextActions,
  controlMapRelatedLinks,
  controlMapShellCopy,
  formatControlMapMetric,
} from "./control-map-related";

describe("controlMapRelatedLinks", () => {
  it("builds Subsystems / FMEA / Practice cross-links", () => {
    const links = controlMapRelatedLinks("org-1", { include: [...CONTROL_MAP_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["subsystems", "fmea", "practice"]);
    expect(links.find((l) => l.id === "subsystems")?.href).toBe("/subsystems?orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "practice")?.href).toBe("/team?tab=practice&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = controlMapRelatedLinks("org-1", {
      active: "practice",
      include: ["subsystems", "fmea"],
    });
    expect(links.map((l) => l.id)).toEqual(["subsystems", "fmea"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(controlMapRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("controlMapNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = controlMapNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "practice")).toBe(true);
  });

  it("setup with org points at Workspace + Subsystems / FMEA / Practice", () => {
    const actions = controlMapNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "practice")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at add-binding + Subsystems / FMEA", () => {
    const actions = controlMapNextActions({
      orgId: "org-1",
      shell: "empty",
      bindingCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["add-binding", "subsystems", "fmea"]),
    );
    expect(actions[0]?.href).toBe("#control-map-form");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize Subsystems / FMEA without DEMO bindings", () => {
    const actions = controlMapNextActions({
      orgId: "org-1",
      shell: "ready",
      bindingCount: 4,
      driverCount: 2,
      operatorCount: 2,
    });
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("surfaces missing driver or operator maps", () => {
    const driverGap = controlMapNextActions({
      orgId: "org-1",
      shell: "ready",
      bindingCount: 2,
      driverCount: 0,
      operatorCount: 2,
    });
    expect(driverGap[0]?.id).toBe("driver");

    const operatorGap = controlMapNextActions({
      orgId: "org-1",
      shell: "ready",
      bindingCount: 2,
      driverCount: 2,
      operatorCount: 0,
    });
    expect(operatorGap[0]?.id).toBe("operator");
  });
});

describe("classifyControlMapShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO bindings", () => {
    expect(classifyControlMapShell({ loading: true })).toBe("loading");
    expect(classifyControlMapShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyControlMapShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyControlMapShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyControlMapShell({
        loading: false,
        orgId: "o1",
        status: "ready",
        bindingCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyControlMapShell({
        loading: false,
        orgId: "o1",
        status: "ready",
        bindingCount: 3,
      }),
    ).toBe("ready");
  });
});

describe("controlMapShellCopy + formatControlMapMetric", () => {
  it("refuses invented DEMO bindings in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = controlMapShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|recorded|binding/i);
    }
    expect(controlMapShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(controlMapShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only", () => {
    expect(formatControlMapMetric(null, false)).toBe("…");
    expect(formatControlMapMetric(3, true)).toBe("3");
    expect(formatControlMapMetric(-1, true)).toBe("0");
  });
});
