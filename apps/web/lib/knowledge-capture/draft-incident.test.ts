import { describe, expect, it } from "vitest";
import { draftFromIncidentReport, incidentEvidence, type IncidentReportSource } from "./draft-incident";

function source(overrides: Partial<IncidentReportSource> = {}): IncidentReportSource {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    title: "Cut hand on a deburred plate",
    category: "injury",
    severity: "moderate",
    status: "resolved",
    occurredOn: "2026-02-03",
    location: "Shop bench 2",
    description: "A student ran a hand along a freshly cut plate edge.",
    correctiveAction: "Cut gloves are now required at the bandsaw.",
    owner: "Safety captain",
    seasonYear: 2026,
    ...overrides,
  };
}

describe("draftFromIncidentReport", () => {
  it("drafts from a closed-out incident using only recorded text", () => {
    const draft = draftFromIncidentReport(source());
    expect(draft).not.toBeNull();
    expect(draft!.title).toBe("Safety incident — Cut hand on a deburred plate");
    expect(draft!.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(draft!.templateKind).toBe("other");
    expect(draft!.body).toContain("A student ran a hand along a freshly cut plate edge.");
    expect(draft!.body).toContain("Cut gloves are now required at the bandsaw.");
    expect(draft!.body).toContain("**Severity:** moderate");
  });

  it("drafts nothing while the incident is still open", () => {
    expect(draftFromIncidentReport(source({ status: "open" }))).toBeNull();
    expect(draftFromIncidentReport(source({ status: "investigating" }))).toBeNull();
    expect(draftFromIncidentReport(source({ status: "action_pending" }))).toBeNull();
  });

  it("accepts the closed status as well as resolved", () => {
    expect(draftFromIncidentReport(source({ status: "closed" }))).not.toBeNull();
  });

  it("drafts nothing when nothing was written down", () => {
    expect(draftFromIncidentReport(source({ description: "", correctiveAction: null }))).toBeNull();
  });

  it("omits the corrective-action heading when none was recorded", () => {
    const draft = draftFromIncidentReport(source({ correctiveAction: null }));
    expect(draft!.body).toContain("## What happened");
    expect(draft!.body).not.toContain("## Corrective action taken");
  });
});

describe("incidentEvidence", () => {
  it("quotes only recorded fields", () => {
    expect(incidentEvidence(source({ owner: null, location: "  " })).map((row) => row.label)).toEqual([
      "What happened",
      "Corrective action",
      "Severity",
    ]);
  });
});
