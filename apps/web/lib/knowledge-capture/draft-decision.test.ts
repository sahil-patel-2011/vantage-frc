import { describe, expect, it } from "vitest";
import {
  decisionEvidence,
  decisionOptionLines,
  draftFromDecisionRecord,
  type DecisionRecordSource,
} from "./draft-decision";

function source(overrides: Partial<DecisionRecordSource> = {}): DecisionRecordSource {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    title: "Swerve over tank",
    category: "design",
    status: "accepted",
    context: "Tank cost us cycles in defense-heavy matches.",
    decision: "Build a swerve drivetrain for 2026.",
    rationale: "Two mentors already know MK4i and we have the budget.",
    options: ["Keep tank", { label: "Swerve", notes: "MK4i" }],
    decidedOn: "2026-01-12",
    deciders: "Design team",
    seasonYear: 2026,
    ...overrides,
  };
}

describe("draftFromDecisionRecord", () => {
  it("drafts a page whose every line comes from the source row", () => {
    const draft = draftFromDecisionRecord(source());
    expect(draft).not.toBeNull();
    const body = draft!.body;

    expect(draft!.title).toBe("Decision — Swerve over tank");
    expect(draft!.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(draft!.templateKind).toBe("other");
    expect(draft!.seasonYear).toBe(2026);

    expect(body).toContain("Tank cost us cycles in defense-heavy matches.");
    expect(body).toContain("Build a swerve drivetrain for 2026.");
    expect(body).toContain("Two mentors already know MK4i and we have the budget.");
    expect(body).toContain("- Keep tank");
    expect(body).toContain("- Swerve — MK4i");
    expect(body).toContain("**Decided on:** 2026-01-12");
    expect(body).toContain("nothing was generated");
  });

  it("is deterministic", () => {
    expect(draftFromDecisionRecord(source())).toEqual(draftFromDecisionRecord(source()));
  });

  it("drafts nothing when there is no context AND no rationale", () => {
    expect(draftFromDecisionRecord(source({ context: null, rationale: "  " }))).toBeNull();
  });

  it("drafts nothing for a decision that was never accepted", () => {
    expect(draftFromDecisionRecord(source({ status: "proposed" }))).toBeNull();
    expect(draftFromDecisionRecord(source({ status: "rejected" }))).toBeNull();
  });

  it("omits a heading rather than inventing the missing half", () => {
    const draft = draftFromDecisionRecord(source({ rationale: null, decision: null }));
    expect(draft).not.toBeNull();
    expect(draft!.body).toContain("## Context");
    expect(draft!.body).not.toContain("## Why");
    expect(draft!.body).not.toContain("## What we decided");
  });

  it("leaves out facts the row never recorded", () => {
    const draft = draftFromDecisionRecord(source({ decidedOn: null, deciders: null, category: null }));
    expect(draft!.body).not.toContain("Decided on");
    expect(draft!.body).not.toContain("Deciders");
    expect(draft!.body).not.toContain("Category");
  });
});

describe("decisionOptionLines", () => {
  it("reads strings and labelled objects, and ignores the rest", () => {
    expect(decisionOptionLines(["a", { name: "b" }, { nope: 1 }, 7, null])).toBe("- a\n- b");
  });

  it("returns null for non-arrays and empty arrays", () => {
    expect(decisionOptionLines(null)).toBeNull();
    expect(decisionOptionLines([])).toBeNull();
    expect(decisionOptionLines({ a: 1 })).toBeNull();
  });
});

describe("decisionEvidence", () => {
  it("quotes only fields the row actually carries", () => {
    const evidence = decisionEvidence(source({ deciders: null, options: [] }));
    expect(evidence.map((row) => row.label)).toEqual(["Context", "Decision", "Rationale"]);
  });
});
