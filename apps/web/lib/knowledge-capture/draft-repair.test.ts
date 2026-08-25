import { describe, expect, it } from "vitest";
import {
  draftFromPitRepair,
  repairDecisionLabel,
  repairEvidence,
  type PitRepairSource,
} from "./draft-repair";

function source(overrides: Partial<PitRepairSource> = {}): PitRepairSource {
  return {
    id: "99999999-8888-7777-6666-555555555555",
    title: "Intake belt slipping",
    subsystemName: "Intake",
    status: "resolved",
    decision: "swap",
    symptomNote: "Belt walked off the pulley after two cycles.",
    rationale: "We had a spare belt staged and only nine minutes.",
    severity: 7,
    priorFailureCount: 2,
    minutesUntilNextMatch: 9,
    prestageRecommended: true,
    seasonYear: 2026,
    ...overrides,
  };
}

describe("draftFromPitRepair", () => {
  it("drafts from a resolved repair using recorded text and numbers", () => {
    const draft = draftFromPitRepair(source());
    expect(draft).not.toBeNull();
    expect(draft!.title).toBe("Pit repair — Intake: Intake belt slipping");
    expect(draft!.templateKind).toBe("pit_ops");
    expect(draft!.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(draft!.body).toContain("Belt walked off the pulley after two cycles.");
    expect(draft!.body).toContain("We had a spare belt staged and only nine minutes.");
    expect(draft!.body).toContain("**Triage call:** Swap the part");
    expect(draft!.body).toContain("**Severity recorded:** 7 of 10");
    expect(draft!.body).toContain("**Minutes to next match:** 9");
  });

  it("drafts nothing for an open or staged repair", () => {
    expect(draftFromPitRepair(source({ status: "open" }))).toBeNull();
    expect(draftFromPitRepair(source({ status: "staged" }))).toBeNull();
  });

  it("drafts nothing when no symptom and no rationale were recorded", () => {
    expect(draftFromPitRepair(source({ symptomNote: "", rationale: "   " }))).toBeNull();
  });

  it("does not claim a pre-stage recommendation that was not made", () => {
    const draft = draftFromPitRepair(source({ prestageRecommended: false }));
    expect(draft!.body).not.toContain("Pre-stage recommended");
  });

  it("falls back to the bare title when no subsystem was recorded", () => {
    const draft = draftFromPitRepair(source({ subsystemName: null }));
    expect(draft!.title).toBe("Pit repair — Intake belt slipping");
    expect(draft!.body).not.toContain("**Subsystem:**");
  });
});

describe("repairDecisionLabel", () => {
  it("maps the stored enum and passes anything else through", () => {
    expect(repairDecisionLabel("fix")).toBe("Fix in place");
    expect(repairDecisionLabel("swap")).toBe("Swap the part");
    expect(repairDecisionLabel("monitor")).toBe("Monitor");
    expect(repairDecisionLabel(null)).toBeNull();
  });
});

describe("repairEvidence", () => {
  it("quotes only recorded fields", () => {
    expect(repairEvidence(source({ rationale: null })).map((row) => row.label)).toEqual([
      "Symptom",
      "Triage call",
      "Subsystem",
    ]);
  });
});
