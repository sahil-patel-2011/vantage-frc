import { describe, expect, it } from "vitest";
import { parseSoftwareVersionAction, staleSeasonStackCue, summarizeVersions, validateComponent, versionStatus, vh109DipSwitchCue, vh109FirmwareCue, inspectionDsCue, inspectionRioImageCue, STALE_SEASON_STACK_CUE, VH109_DIP_SWITCH_CUE, VH109_FIRMWARE_CUE, INSPECTION_DS_CUE, INSPECTION_RIO_IMAGE_CUE } from "./software-versions";

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

describe("vh109FirmwareCue", () => {
  it("cues only a logged radio firmware row below 2.01 — never invents a radio", () => {
    expect(vh109FirmwareCue([])).toBeNull();
    expect(vh109FirmwareCue([{ component: "WPILib", installedVersion: "2026.1.1" }])).toBeNull();
    expect(vh109FirmwareCue([{ component: "Radio firmware", installedVersion: "2.00" }])).toBe(VH109_FIRMWARE_CUE);
    expect(vh109FirmwareCue([{ component: "VH-109 radio", installedVersion: "2.01" }])).toBeNull();
    expect(vh109FirmwareCue([{ component: "Radio firmware", installedVersion: "unparsed" }])).toBeNull();
  });
});

describe("vh109DipSwitchCue", () => {
  it("cues only a logged radio firmware row at 2.0+ — never invents a radio", () => {
    expect(vh109DipSwitchCue([])).toBeNull();
    expect(vh109DipSwitchCue([{ component: "WPILib", installedVersion: "2.01" }])).toBeNull();
    expect(vh109DipSwitchCue([{ component: "Radio firmware", installedVersion: "1.3" }])).toBeNull();
    expect(vh109DipSwitchCue([{ component: "Radio firmware", installedVersion: "2.00" }])).toBe(VH109_DIP_SWITCH_CUE);
    expect(vh109DipSwitchCue([{ component: "VH-109 radio", installedVersion: "2.01" }])).toBe(VH109_DIP_SWITCH_CUE);
    expect(vh109DipSwitchCue([{ component: "Radio firmware", installedVersion: "unparsed" }])).toBeNull();
    expect(JSON.stringify(VH109_DIP_SWITCH_CUE).toLowerCase()).not.toContain("demo");
  });
});

describe("staleSeasonStackCue", () => {
  it("cues only a logged WPILib / RIO / DS year behind the season — never invents a stack", () => {
    expect(staleSeasonStackCue([], 2026)).toBeNull();
    expect(staleSeasonStackCue([{ component: "Radio firmware", installedVersion: "2.00" }], 2026)).toBeNull();
    expect(staleSeasonStackCue([{ component: "WPILib", installedVersion: "2026.1.1" }], 2026)).toBeNull();
    expect(staleSeasonStackCue([{ component: "WPILib", installedVersion: "2025.3.2" }], 2026)).toBe(STALE_SEASON_STACK_CUE);
    expect(staleSeasonStackCue([{ component: "roboRIO image", installedVersion: "FRC_roboRIO_2025_v2.0" }], 2026)).toBe(
      STALE_SEASON_STACK_CUE,
    );
    expect(staleSeasonStackCue([{ component: "Driver Station / NI Game Tools", installedVersion: "2025.0.0" }], 2026)).toBe(
      STALE_SEASON_STACK_CUE,
    );
    expect(staleSeasonStackCue([{ component: "roboRIO image", installedVersion: "unparsed" }], 2026)).toBeNull();
    expect(JSON.stringify(STALE_SEASON_STACK_CUE).toLowerCase()).not.toContain("demo");
  });
});

describe("inspectionRioImageCue", () => {
  it("cues only a logged 2026 roboRIO image below v1.2 — never invents a RIO", () => {
    expect(inspectionRioImageCue([], 2026)).toBeNull();
    expect(inspectionRioImageCue([{ component: "WPILib", installedVersion: "2026.1.1" }], 2026)).toBeNull();
    expect(inspectionRioImageCue([{ component: "roboRIO image", installedVersion: "FRC_roboRIO_2026_v1.0" }], 2026)).toBe(
      INSPECTION_RIO_IMAGE_CUE,
    );
    expect(inspectionRioImageCue([{ component: "roboRIO image", installedVersion: "FRC_roboRIO_2026_v1.2" }], 2026)).toBeNull();
    expect(inspectionRioImageCue([{ component: "roboRIO image", installedVersion: "FRC_roboRIO_2026_v1.0" }], 2027)).toBeNull();
    expect(inspectionRioImageCue([{ component: "roboRIO image", installedVersion: "unparsed" }], 2026)).toBeNull();
    expect(JSON.stringify(INSPECTION_RIO_IMAGE_CUE).toLowerCase()).not.toContain("demo");
  });
});

describe("inspectionDsCue", () => {
  it("cues only a logged 2026 Driver Station below 26.0 — never invents a DS", () => {
    expect(inspectionDsCue([], 2026)).toBeNull();
    expect(inspectionDsCue([{ component: "WPILib", installedVersion: "25.0" }], 2026)).toBeNull();
    expect(inspectionDsCue([{ component: "Driver Station / NI Game Tools", installedVersion: "25.0" }], 2026)).toBe(
      INSPECTION_DS_CUE,
    );
    expect(inspectionDsCue([{ component: "Driver Station / NI Game Tools", installedVersion: "26.0" }], 2026)).toBeNull();
    expect(inspectionDsCue([{ component: "Driver Station / NI Game Tools", installedVersion: "2026.0.0" }], 2026)).toBeNull();
    expect(inspectionDsCue([{ component: "Driver Station / NI Game Tools", installedVersion: "25.0" }], 2027)).toBeNull();
    expect(JSON.stringify(INSPECTION_DS_CUE).toLowerCase()).not.toContain("demo");
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
