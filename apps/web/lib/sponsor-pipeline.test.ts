import { describe, expect, it } from "vitest";
import {
  buildSponsorReminders,
  defaultRenewalDueOn,
  defaultThankYouDueOn,
  groupSponsorsByStage,
  mapLegacyStatusToPipelineStage,
  nextPipelineStage,
  previousPipelineStage,
  statusForPipelineStage,
  summarizeFundraisingProgress,
  type PipelineSponsor,
} from "./sponsor-pipeline";

function sponsor(partial: Partial<PipelineSponsor> & Pick<PipelineSponsor, "id" | "name">): PipelineSponsor {
  return {
    pipelineStage: "prospect",
    status: "prospect",
    askCents: 0,
    pledgedCents: 0,
    seasonCents: 0,
    seasonCashCents: 0,
    thankYouDueOn: null,
    renewalDueOn: null,
    nextFollowUpOn: null,
    lastContactOn: null,
    ...partial,
  };
}

describe("sponsor pipeline stages", () => {
  it("maps legacy status into CRM stages", () => {
    expect(mapLegacyStatusToPipelineStage("active")).toBe("active");
    expect(mapLegacyStatusToPipelineStage("lapsed")).toBe("renewal");
    expect(mapLegacyStatusToPipelineStage("prospect")).toBe("prospect");
  });

  it("walks the FRC process forward and back", () => {
    expect(nextPipelineStage("prospect")).toBe("ask");
    expect(nextPipelineStage("ask")).toBe("visit");
    expect(nextPipelineStage("visit")).toBe("pledged");
    expect(nextPipelineStage("pledged")).toBe("active");
    expect(nextPipelineStage("active")).toBe("renewal");
    expect(nextPipelineStage("renewal")).toBeNull();
    expect(previousPipelineStage("ask")).toBe("prospect");
    expect(previousPipelineStage("prospect")).toBeNull();
  });

  it("keeps relationship status aligned with pipeline stage", () => {
    expect(statusForPipelineStage("ask")).toBe("prospect");
    expect(statusForPipelineStage("active")).toBe("active");
    expect(statusForPipelineStage("renewal")).toBe("lapsed");
  });

  it("groups by stage and excludes declined partners from the board", () => {
    const groups = groupSponsorsByStage([
      sponsor({ id: "1", name: "Acme", pipelineStage: "ask", status: "prospect" }),
      sponsor({ id: "2", name: "Beta", pipelineStage: "active", status: "active" }),
      sponsor({ id: "3", name: "Nope", pipelineStage: "ask", status: "declined" }),
    ]);
    expect(groups.ask).toHaveLength(1);
    expect(groups.active).toHaveLength(1);
    expect(groups.prospect).toHaveLength(0);
  });
});

describe("fundraising goal vs actual", () => {
  it("tracks cash actuals against the season goal without inventing money", () => {
    const summary = summarizeFundraisingProgress({
      fundraisingGoalCents: 50_000_00,
      grantIncomeCents: 5_000_00,
      sponsors: [
        sponsor({ id: "1", name: "Acme", seasonCashCents: 10_000_00, pledgedCents: 10_000_00, pipelineStage: "active" }),
        sponsor({ id: "2", name: "Beta", seasonCashCents: 0, pledgedCents: 8_000_00, askCents: 8_000_00, pipelineStage: "pledged" }),
      ],
    });
    expect(summary.actualCashCents).toBe(10_000_00);
    expect(summary.actualCents).toBe(15_000_00);
    expect(summary.pledgedPipelineCents).toBe(18_000_00);
    expect(summary.remainingCents).toBe(35_000_00);
    expect(summary.percentOfGoal).toBe(30);
    expect(summary.stages.find((s) => s.stage === "active")?.count).toBe(1);
    expect(summary.stages.find((s) => s.stage === "pledged")?.valueCents).toBe(8_000_00);
  });
});

describe("thank-you and renewal reminders", () => {
  it("defaults thank-you and renewal due dates", () => {
    expect(defaultThankYouDueOn("2026-07-10")).toBe("2026-07-17");
    expect(defaultRenewalDueOn(2026)).toBe("2026-10-01");
  });

  it("builds overdue thank-you, renewal, and follow-up nudges", () => {
    const now = new Date("2026-07-17T12:00:00Z");
    const reminders = buildSponsorReminders(
      [
        sponsor({
          id: "1",
          name: "Acme",
          thankYouDueOn: "2026-07-10",
          pipelineStage: "active",
          status: "active",
        }),
        sponsor({
          id: "2",
          name: "Beta",
          renewalDueOn: "2026-07-01",
          pipelineStage: "active",
          status: "active",
        }),
        sponsor({
          id: "3",
          name: "Gamma",
          nextFollowUpOn: "2026-07-15",
          pipelineStage: "visit",
          status: "prospect",
        }),
        sponsor({
          id: "4",
          name: "Quiet",
          thankYouDueOn: "2026-07-10",
          thankYouSentAt: "2026-07-12T00:00:00Z",
          pipelineStage: "active",
          status: "active",
        }),
      ],
      now,
    );
    expect(reminders.map((r) => r.kind)).toEqual(["renewal", "thank_you", "follow_up"]);
    expect(reminders.find((r) => r.sponsorId === "4")).toBeUndefined();
  });
});
