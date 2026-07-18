import { describe, expect, it } from "vitest";
import {
  SIGNOFF_BUILD_RELATED_INCLUDE,
  formatSignoffReadinessDisplay,
  formatSubsystemCompletionDisplay,
  shouldShowSignoffSummaryTiles,
  signoffNextActions,
  signoffRelatedLinks,
} from "./subsystem-signoff-related";

describe("subsystem-signoff-related Soft-UI helpers", () => {
  it("builds FMEA / CAD / Tasks cross-links", () => {
    const links = signoffRelatedLinks("org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
    expect(links.find((l) => l.id === "tasks")?.href).toBe("/tasks?orgId=org-1");
    expect(links.find((l) => l.id === "subsystems")?.href).toBe("/subsystems?orgId=org-1");
  });

  it("excludes active and respects include", () => {
    const links = signoffRelatedLinks("org-1", {
      active: "subsystems",
      include: ["fmea", "cad", "tasks"],
    });
    expect(links.map((l) => l.id)).toEqual(["fmea", "cad", "tasks"]);
  });

  it("never uses DEMO labels or readiness placeholders", () => {
    const links = signoffRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    const emptyActions = signoffNextActions({
      orgId: "org-1",
      subsystemCount: 0,
      startedCount: 0,
      signedOffCount: 0,
      blockedCount: 0,
      pendingGates: 0,
    });
    expect(emptyActions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(emptyActions[0]?.id).toBe("add-first");
    expect(emptyActions.some((a) => a.id === "fmea")).toBe(true);
    expect(emptyActions.some((a) => a.id === "cad")).toBe(true);
    expect(emptyActions.some((a) => a.id === "tasks")).toBe(true);
  });

  it("hides readiness % until a real gate decision exists", () => {
    expect(formatSignoffReadinessDisplay(0, { subsystemCount: 0, startedCount: 0 })).toBe("—");
    expect(formatSignoffReadinessDisplay(0, { subsystemCount: 2, startedCount: 0 })).toBe("—");
    expect(formatSignoffReadinessDisplay(0.42, { subsystemCount: 2, startedCount: 1 })).toBe("42%");
    expect(formatSubsystemCompletionDisplay(0, 0, 0)).toBe("—");
    expect(formatSubsystemCompletionDisplay(0.5, 3, 0)).toBe("50%");
    expect(shouldShowSignoffSummaryTiles(0)).toBe(false);
    expect(shouldShowSignoffSummaryTiles(1)).toBe(true);
  });

  it("uses focused Build related includes without DEMO labels", () => {
    expect(SIGNOFF_BUILD_RELATED_INCLUDE).toContain("fmea");
    expect(SIGNOFF_BUILD_RELATED_INCLUDE).toContain("cad");
    expect(SIGNOFF_BUILD_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });

  it("requires workspace before next actions", () => {
    expect(
      signoffNextActions({
        subsystemCount: 0,
        startedCount: 0,
        signedOffCount: 0,
        blockedCount: 0,
        pendingGates: 0,
      }).map((a) => a.id),
    ).toEqual(["workspace"]);
  });

  it("prioritizes blocked subsystems then pending gates from real trails", () => {
    const blocked = signoffNextActions({
      orgId: "org-1",
      subsystemCount: 3,
      startedCount: 2,
      signedOffCount: 0,
      blockedCount: 1,
      pendingGates: 8,
      topTitle: "Intake",
    });
    expect(blocked[0]?.id).toBe("blocked");
    expect(blocked[0]?.detail).toContain("Intake");
    expect(blocked[0]?.detail).not.toMatch(/demo/i);

    const pending = signoffNextActions({
      orgId: "org-1",
      subsystemCount: 2,
      startedCount: 2,
      signedOffCount: 0,
      blockedCount: 0,
      pendingGates: 4,
      topTitle: "Climber",
    });
    expect(pending[0]?.id).toBe("pending-gates");
    expect(pending[0]?.detail).toContain("Climber");
    expect(pending.some((a) => a.id === "fmea")).toBe(true);
    expect(pending.some((a) => a.id === "cad")).toBe(true);
    expect(pending.some((a) => a.id === "tasks")).toBe(true);
  });
});
