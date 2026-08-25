import { describe, expect, it } from "vitest";
import {
  ineligibleReason,
  isDecisionRecordEligible,
  isIncidentReportEligible,
  isPitRepairEligible,
} from "./eligibility";

describe("isDecisionRecordEligible", () => {
  it("accepts an accepted decision that recorded context or rationale", () => {
    expect(
      isDecisionRecordEligible({ title: "Swerve", status: "accepted", context: "Cycles", rationale: null }),
    ).toBe(true);
    expect(
      isDecisionRecordEligible({ title: "Swerve", status: "accepted", context: null, rationale: "Faster" }),
    ).toBe(true);
  });

  it("refuses a decision that has neither context nor rationale", () => {
    expect(
      isDecisionRecordEligible({ title: "Swerve", status: "accepted", context: "  ", rationale: null }),
    ).toBe(false);
  });

  it("refuses decisions that are not accepted", () => {
    for (const status of ["proposed", "rejected", "superseded"]) {
      expect(
        isDecisionRecordEligible({ title: "Swerve", status, context: "Cycles", rationale: "Faster" }),
      ).toBe(false);
    }
  });

  it("refuses an untitled row", () => {
    expect(isDecisionRecordEligible({ title: "", status: "accepted", context: "Cycles" })).toBe(false);
  });
});

describe("isIncidentReportEligible", () => {
  it("accepts resolved and closed incidents with prose", () => {
    for (const status of ["resolved", "closed"]) {
      expect(
        isIncidentReportEligible({ title: "Cut hand", status, description: "Deburring", correctiveAction: null }),
      ).toBe(true);
    }
  });

  it("refuses an unresolved incident even when it is fully written up", () => {
    for (const status of ["open", "investigating", "action_pending"]) {
      expect(
        isIncidentReportEligible({
          title: "Cut hand",
          status,
          description: "Deburring",
          correctiveAction: "Gloves required",
        }),
      ).toBe(false);
    }
  });

  it("refuses a resolved incident with nothing written down", () => {
    expect(
      isIncidentReportEligible({ title: "Cut hand", status: "resolved", description: null, correctiveAction: "" }),
    ).toBe(false);
  });
});

describe("isPitRepairEligible", () => {
  it("accepts a resolved repair with a symptom or rationale", () => {
    expect(
      isPitRepairEligible({ title: "Intake", status: "resolved", symptomNote: "Belt slipping", rationale: null }),
    ).toBe(true);
  });

  it("refuses open or merely staged repairs", () => {
    for (const status of ["open", "staged"]) {
      expect(
        isPitRepairEligible({ title: "Intake", status, symptomNote: "Belt slipping", rationale: "Swap" }),
      ).toBe(false);
    }
  });

  it("refuses a resolved repair with no recorded prose", () => {
    expect(
      isPitRepairEligible({ title: "Intake", status: "resolved", symptomNote: " ", rationale: null }),
    ).toBe(false);
  });
});

describe("ineligibleReason", () => {
  it("explains each source kind honestly", () => {
    expect(ineligibleReason("decision_record")).toContain("Accepted decisions");
    expect(ineligibleReason("incident_report")).toContain("Resolved incidents");
    expect(ineligibleReason("pit_repair_triage")).toContain("Resolved repairs");
  });
});
