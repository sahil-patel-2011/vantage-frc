import { describe, expect, it } from "vitest";
import type { Sponsor, SponsorProspect } from "../business-portal";
import type { SponsorReminder } from "../sponsor-pipeline";
import { boundForModel, dollarsOrNull, viewHighlights, viewIsEmpty } from "./bound";
import {
  rankSponsorAsks,
  renewalsComingUp,
  sponsorDraftKind,
  sponsorNamedIn,
  sponsorshipHighlights,
} from "./sponsorships";

const NOW = new Date("2026-10-11T15:00:00Z");

function sponsor(partial: Partial<Sponsor> & Pick<Sponsor, "id" | "name">): Sponsor {
  return {
    status: "prospect",
    pipelineStage: "prospect",
    tier: null,
    website: null,
    industry: null,
    contactName: null,
    contactEmail: null,
    relationshipOwner: null,
    lastContactOn: null,
    nextFollowUpOn: null,
    notes: null,
    askCents: 0,
    pledgedCents: 0,
    thankYouDueOn: null,
    renewalDueOn: null,
    lifetimeCents: 0,
    seasonCents: 0,
    seasonCashCents: 0,
    ...partial,
  };
}

describe("Sponsorships skill: who to ask next", () => {
  const sponsors = [
    sponsor({ id: "a", name: "Acme Robotics", status: "active", pipelineStage: "active", renewalDueOn: "2026-10-01", lifetimeCents: 250_000, seasonCents: 250_000, contactName: "Dana" }),
    sponsor({ id: "b", name: "Bolt Supply", pipelineStage: "pledged", pledgedCents: 100_000 }),
    sponsor({ id: "c", name: "Cobalt Labs", pipelineStage: "ask", lastContactOn: "2026-09-01" }),
    sponsor({ id: "d", name: "Delta Credit Union", status: "lapsed", pipelineStage: "renewal", lifetimeCents: 50_000 }),
    sponsor({ id: "e", name: "Echo Hardware" }),
    sponsor({ id: "f", name: "Foxtrot Inc", status: "declined", pipelineStage: "ask" }),
    sponsor({ id: "g", name: "Gamma Plastics", status: "active", pipelineStage: "active", seasonCents: 10_000, lifetimeCents: 10_000 }),
  ];
  const reminders: SponsorReminder[] = [
    { sponsorId: "a", sponsorName: "Acme Robotics", kind: "renewal", dueOn: "2026-10-01", message: "Start renewal outreach with Acme Robotics" },
    { sponsorId: "g", sponsorName: "Gamma Plastics", kind: "thank_you", dueOn: "2026-10-05", message: "Send a thank-you to Gamma Plastics" },
    { sponsorId: "f", sponsorName: "Foxtrot Inc", kind: "follow_up", dueOn: "2026-09-30", message: "Follow up with Foxtrot Inc" },
  ];
  const prospects: SponsorProspect[] = [
    { id: "p1", name: "Helix Machining", website: "https://helix.example.test", summary: "", sourceTitle: "", sourceQuery: "", fitScore: 72, fitReason: "", status: "new" },
    { id: "p2", name: "acme robotics", website: "https://acme.example.test", summary: "", sourceTitle: "", sourceQuery: "", fitScore: 90, fitReason: "", status: "new" },
  ];

  it("thanks first, then renewals, then pledges, lapsed, stalled, never-contacted and research prospects", () => {
    const ranked = rankSponsorAsks({ sponsors, reminders, prospects, now: NOW });
    expect(ranked.map((row) => [row.name, row.kind])).toEqual([
      ["Gamma Plastics", "thank_you"],
      ["Acme Robotics", "renewal"],
      ["Bolt Supply", "pledge"],
      ["Delta Credit Union", "lapsed"],
      ["Cobalt Labs", "stalled"],
      ["Echo Hardware", "not_contacted"],
      ["Helix Machining", "prospect_research"],
    ]);
  });

  it("never lists a declined sponsor, and never lists a researched prospect twice", () => {
    const ranked = rankSponsorAsks({ sponsors, reminders, prospects, now: NOW });
    expect(ranked.some((row) => row.name === "Foxtrot Inc")).toBe(false);
    expect(ranked.filter((row) => row.name.toLowerCase() === "acme robotics")).toHaveLength(1);
  });

  it("explains each pick from recorded fields and shows an amount only when one was recorded", () => {
    const ranked = rankSponsorAsks({ sponsors, reminders, prospects, now: NOW });
    const bolt = ranked.find((row) => row.name === "Bolt Supply")!;
    expect(bolt.reason).toBe("Pledged, but nothing received this season yet");
    expect(bolt.recordedAmount).toBe("$1,000");
    const echo = ranked.find((row) => row.name === "Echo Hardware")!;
    expect(echo.recordedAmount).toBeNull();
    expect(ranked.find((row) => row.name === "Cobalt Labs")!.reason).toBe("Ask stage, last contact 40 days ago");
    expect(ranked.find((row) => row.name === "Acme Robotics")!.contactName).toBe("Dana");
  });

  it("puts a high renewal risk first within the same urgency", () => {
    const ranked = rankSponsorAsks({
      sponsors: [sponsor({ id: "x", name: "Alpha" }), sponsor({ id: "y", name: "Zulu" })],
      reminders: [],
      renewalRisk: new Map([["y", "high"]]),
      now: NOW,
    });
    expect(ranked.map((row) => row.name)).toEqual(["Zulu", "Alpha"]);
  });

  it("returns nothing for a team with no records — no made-up suggestions", () => {
    expect(rankSponsorAsks({ sponsors: [], reminders: [], prospects: [], now: NOW })).toEqual([]);
    expect(sponsorshipHighlights({ askNext: [], comingUp: [], matches: [], goal: null })).toEqual([]);
  });

  it("lists renewals coming up in the next 45 days, not ones already due", () => {
    const rows = renewalsComingUp(
      [
        sponsor({ id: "1", name: "Soon", renewalDueOn: "2026-11-01" }),
        sponsor({ id: "2", name: "Past", renewalDueOn: "2026-10-01" }),
        sponsor({ id: "3", name: "Far", renewalDueOn: "2027-03-01" }),
      ],
      NOW,
    );
    expect(rows.map((row) => row.name)).toEqual(["Soon"]);
  });

  it("finds the sponsor a message names and picks the draft kind", () => {
    expect(sponsorNamedIn("Draft a renewal email to acme robotics please", sponsors)?.id).toBe("a");
    expect(sponsorNamedIn("Who should we ask next?", sponsors)).toBeNull();
    expect(sponsorDraftKind("Draft a renewal email to Acme")).toBe("renewal");
    expect(sponsorDraftKind("Write a thank-you note")).toBe("thank_you");
    expect(sponsorDraftKind("Reach out to a new company")).toBe("cold_intro");
    expect(sponsorDraftKind("Ask Bolt for $500")).toBe("sponsorship_ask");
  });

  it("writes plain highlight lines", () => {
    const ranked = rankSponsorAsks({ sponsors, reminders, prospects, now: NOW });
    const lines = sponsorshipHighlights({
      askNext: ranked,
      comingUp: [{ name: "Soon", renewalDueOn: "2026-11-01" }],
      matches: [{ contactName: "Pat", employer: "Boeing" }],
      goal: { goalCents: 500_000, actualCents: 120_000 },
    });
    expect(lines[0]).toBe("Ask next: Gamma Plastics — Thank-you due since Oct 5 — thank them before the next ask");
    expect(lines).toContain("Renewals coming up: Soon (Nov 1)");
    expect(lines).toContain("Matching gifts: 1 contact works at Boeing — each has a matching-gift program on file");
    expect(lines).toContain("Season goal: $1,200 raised of $5,000");
  });
});

describe("bounding a feature view for the model", () => {
  it("drops plumbing, clips text and lists, and keeps empty things empty", () => {
    const bounded = boundForModel({
      status: "live",
      orgId: "org",
      steps: [{ id: "x" }],
      reports: Array.from({ length: 12 }, (_, index) => ({ title: `Report ${index}` })),
      note: "x".repeat(600),
      contactEmail: "someone@example.test",
      latest: null,
    }) as Record<string, unknown>;
    expect(bounded.status).toBeUndefined();
    expect(bounded.orgId).toBeUndefined();
    expect(bounded.steps).toBeUndefined();
    expect(bounded.contactEmail).toBeUndefined();
    expect((bounded.reports as unknown[]).length).toBe(11);
    expect((bounded.reports as unknown[])[10]).toBe("…and 2 more");
    expect((bounded.note as string).length).toBe(501);
    expect(bounded.latest).toBeNull();
  });

  it("summarises a view's lists and calls an all-empty view empty", () => {
    expect(viewHighlights({ status: "live", reports: [{ title: "Arm bent" }, { title: "Chain off" }], fmeaHistory: [] })).toEqual([
      "2 reports: Arm bent; Chain off",
    ]);
    expect(viewIsEmpty({ status: "live", reports: [], seasons: [2026] })).toBe(true);
    expect(viewIsEmpty({ status: "live", reports: [{ title: "x" }] })).toBe(false);
    expect(dollarsOrNull(0)).toBeNull();
    expect(dollarsOrNull(1999)).toBe("$19.99");
  });
});
