import { describe, expect, it } from "vitest";
import {
  FMEA_BUILD_RELATED_INCLUDE,
  FMEA_TEAM_RELATED_INCLUDE,
  fmeaNextActions,
  fmeaRelatedLinks,
  formatOsdFactors,
  formatRiskRowMeta,
  formatRpnDisplay,
} from "./fmea-related";

describe("fmea-related Soft-UI helpers", () => {
  it("builds Knowledge / CAD / Prototypes cross-links", () => {
    const links = fmeaRelatedLinks("org-1");
    expect(links.find((l) => l.id === "knowledge")?.href).toBe("/team?tab=knowledge&orgId=org-1");
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
    expect(links.find((l) => l.id === "prototype")?.href).toBe("/build?tab=prototype&orgId=org-1");
    expect(links.find((l) => l.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(links.find((l) => l.id === "inventory")?.href).toBe("/inventory?orgId=org-1");
  });

  it("excludes active and respects include", () => {
    const links = fmeaRelatedLinks("org-1", {
      active: "batteries",
      include: ["knowledge", "cad", "prototype"],
    });
    expect(links.map((l) => l.id)).toEqual(["knowledge", "cad", "prototype"]);
  });

  it("never uses DEMO labels or RPN placeholders", () => {
    const links = fmeaRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    const emptyActions = fmeaNextActions({
      orgId: "org-1",
      failureCount: 0,
      activeCount: 0,
      needsFixCount: 0,
      highestRpn: 0,
    });
    expect(emptyActions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(emptyActions[0]?.id).toBe("log-first");
    expect(emptyActions[0]?.detail).toContain("Priority stays blank");
    expect(emptyActions[0]?.detail).not.toMatch(/\bRPN\b|O×S×D|\bFMEA\b/);
    expect(emptyActions.some((a) => a.id === "knowledge")).toBe(true);
    expect(emptyActions.some((a) => a.id === "cad")).toBe(true);
    expect(emptyActions.some((a) => a.id === "prototype")).toBe(true);
  });

  it("hides numeric priority when no failures are logged", () => {
    expect(formatRpnDisplay(0, false)).toBe("—");
    expect(formatRpnDisplay(120, true)).toBe("120");
    expect(formatOsdFactors({ occurrence: 3, severity: 8, detection: 4 })).toBe(
      "How often 3 · How bad 8 · How hard to notice 4",
    );
  });

  it("formats risk-row meta from scored evaluations only", () => {
    const meta = formatRiskRowMeta({
      rpn: 96,
      level: "moderate",
      failure: {
        id: "f1",
        title: "Belt skip",
        failureMode: "Teeth jump",
        context: "match",
        subsystemId: null,
        subsystemName: "Intake",
        occurrence: 3,
        severity: 8,
        detection: 4,
        rootCause: null,
        fiveWhys: null,
        fix: null,
        status: "open",
        inspectionItemId: null,
        eventKey: null,
        matchKey: null,
        robotLabel: "competition",
        occurredAt: "2026-07-01T12:00:00Z",
        seasonYear: 2026,
        recordedByName: null,
      },
    });
    expect(meta).toBe(
      "Intake · match · How often 3 · How bad 8 · How hard to notice 4 · Priority 96",
    );
    expect(meta).not.toMatch(/demo/i);
  });

  it("uses focused Team / Build related includes without DEMO labels", () => {
    expect(FMEA_TEAM_RELATED_INCLUDE).toContain("knowledge");
    expect(FMEA_BUILD_RELATED_INCLUDE).toContain("cad");
    expect(FMEA_BUILD_RELATED_INCLUDE).toContain("prototype");
    expect(FMEA_TEAM_RELATED_INCLUDE.every((id) => !/demo/i.test(id))).toBe(true);
  });

  it("requires workspace before next actions", () => {
    expect(
      fmeaNextActions({
        failureCount: 0,
        activeCount: 0,
        needsFixCount: 0,
        highestRpn: 0,
      }).map((a) => a.id),
    ).toEqual(["workspace"]);
  });

  it("prioritizes recording a fix when open risks lack countermeasures", () => {
    const actions = fmeaNextActions({
      orgId: "org-1",
      failureCount: 2,
      activeCount: 2,
      needsFixCount: 1,
      highestRpn: 210,
      topTitle: "Intake jam",
    });
    expect(actions[0]?.id).toBe("needs-fix");
    expect(actions[0]?.detail).toContain("priority 210");
    expect(actions[0]?.detail).not.toMatch(/demo/i);
    expect(actions.every((a) => !/\bRPN\b|O×S×D|\bFMEA\b/.test(`${a.label} ${a.detail}`))).toBe(
      true,
    );
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.find((a) => a.id === "cad")?.detail).toContain("open failure risks");
    expect(actions.find((a) => a.id === "batteries")?.detail).toContain("failure log");
  });
});
