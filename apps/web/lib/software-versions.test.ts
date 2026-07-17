import { describe, expect, it } from "vitest";
import { parseSoftwareVersionAction, summarizeVersions, validateComponent, versionStatus } from "./software-versions";

describe("versionStatus", () => {
  it("is ok when installed matches target", () => {
    expect(versionStatus("2026.1.1", "2026.1.1")).toBe("ok");
  });
  it("is update_available when they differ", () => {
    expect(versionStatus("2026.1.1", "2026.2.0")).toBe("update_available");
  });
  it("is unknown when there is no target", () => {
    expect(versionStatus("2026.1.1", null)).toBe("unknown");
    expect(versionStatus("2026.1.1", "")).toBe("unknown");
  });
  it("ignores surrounding whitespace", () => {
    expect(versionStatus(" 2026.1.1 ", "2026.1.1")).toBe("ok");
  });
});

describe("validateComponent", () => {
  it("requires a component name and installed version", () => {
    expect(validateComponent({ category: "library", installedVersion: "1.0" }).ok).toBe(false);
    expect(validateComponent({ component: "WPILib", category: "library" }).ok).toBe(false);
  });
  it("rejects an invalid category", () => {
    expect(validateComponent({ component: "WPILib", category: "nope", installedVersion: "1.0" }).ok).toBe(false);
  });
  it("accepts a component with no target", () => {
    const result = validateComponent({ component: "WPILib", category: "library", installedVersion: "2026.1.1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.targetVersion).toBeNull();
  });
});

describe("summarizeVersions", () => {
  it("counts ok / update-available / unknown", () => {
    const summary = summarizeVersions([
      { installedVersion: "2026.1.1", targetVersion: "2026.1.1" },
      { installedVersion: "24.3.0", targetVersion: "25.0.0" },
      { installedVersion: "1.0", targetVersion: null },
    ]);
    expect(summary.ok).toBe(1);
    expect(summary.updateAvailable).toBe(1);
    expect(summary.unknown).toBe(1);
    expect(summary.total).toBe(3);
  });
});

describe("parseSoftwareVersionAction", () => {
  it("parses save_component with a season year", () => {
    const action = parseSoftwareVersionAction({ action: "save_component", orgId: "o1", seasonYear: 2026, component: "WPILib", category: "library", installedVersion: "2026.1.1" });
    expect(action).toMatchObject({ action: "save_component", component: "WPILib" });
  });
  it("rejects save_component without season year", () => {
    expect(() => parseSoftwareVersionAction({ action: "save_component", orgId: "o1", component: "WPILib", category: "library", installedVersion: "1.0" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseSoftwareVersionAction({ action: "hack", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
