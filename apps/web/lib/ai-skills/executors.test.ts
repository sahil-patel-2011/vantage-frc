import { beforeEach, describe, expect, it, vi } from "vitest";

const business = vi.hoisted(() => ({ view: null as unknown }));

vi.mock("../business-data", () => ({
  currentBusinessSeason: () => 2026,
  loadBusinessView: vi.fn(async () => business.view),
}));
vi.mock("../sponsor-renewal-roi/compute-sponsor-renewal-roi", () => ({
  computeSponsorRenewalRoiView: vi.fn(async () => ({
    status: "live",
    sponsors: [{ sponsorId: "s-1", sponsorName: "Acme Robotics", tier: "gold", status: "active", risk: { tier: "high", score: 81 }, latestReport: null }],
  })),
}));
vi.mock("../matching-gift-finder/compute-matching-gift-finder", () => ({
  computeMatchingGiftFinderView: vi.fn(async () => ({
    status: "live",
    contacts: [{ id: "c-1" }],
    matches: [{ contactId: "c-1", contactName: "Pat Lee", hasPledge: false, program: { employerName: "Boeing", matchRatio: "1:1" } }],
    pledges: [],
    summary: { totalContacts: 1, totalPrograms: 1, unmatchedMatchCount: 1 },
  })),
}));

import { AI_SKILLS } from "./catalog";
import { aiSkillExecutorIds, runAiSkill, type SkillRunContext } from "./executors";

function fakeClient() {
  const queries: string[] = [];
  return {
    queries,
    client: {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      }),
    },
  };
}

function ctx(client: unknown, request = "Who should we ask next?"): SkillRunContext {
  return {
    client: client as SkillRunContext["client"],
    orgId: "6925a000-0000-4000-8000-000000000001",
    userId: "user-1",
    activeEventKey: null,
    request,
    page: { from: "/business?tab=sponsors" },
    now: new Date("2026-10-11T15:00:00Z"),
  };
}

function liveBusiness(overrides: Record<string, unknown> = {}) {
  return {
    status: "live",
    orgId: "6925a000-0000-4000-8000-000000000001",
    orgName: "Team 6925",
    teamNumber: 6925,
    sponsorsAllowed: true,
    sponsors: [],
    sponsorReminders: [],
    prospects: [],
    interactions: [],
    awards: [],
    impact: { activities: 0, hours: 0, peopleReached: 0 },
    fundraisingProgress: { goalCents: 0, actualCents: 0 },
    grants: [],
    ...overrides,
  };
}

describe("Ask AI skill executors", () => {
  beforeEach(() => {
    business.view = liveBusiness();
  });

  it("has an executor for every skill in the catalog, and nothing else", () => {
    expect(aiSkillExecutorIds().sort()).toEqual(AI_SKILLS.map((skill) => skill.id).sort());
  });

  it("says how to add a sponsor when a team has none — and suggests nobody", async () => {
    const { client } = fakeClient();
    const result = await runAiSkill("sponsorships", ctx(client));
    expect(result?.status).toBe("empty");
    expect(result?.summary).toMatch(/No sponsor records yet/);
    expect(result?.next?.href).toContain("/business?tab=sponsors");
    expect((result?.data as { askNext: unknown[] }).askNext).toEqual([]);
  });

  it("ranks real sponsor records and brings in renewal risk and matching gifts", async () => {
    business.view = liveBusiness({
      sponsors: [
        {
          id: "s-1",
          name: "Acme Robotics",
          status: "active",
          pipelineStage: "active",
          tier: "gold",
          website: null,
          industry: null,
          contactName: "Dana",
          contactEmail: "dana@example.test",
          relationshipOwner: null,
          lastContactOn: "2026-09-01",
          nextFollowUpOn: null,
          notes: null,
          askCents: 0,
          pledgedCents: 0,
          thankYouDueOn: null,
          renewalDueOn: "2026-10-01",
          lifetimeCents: 250_000,
          seasonCents: 250_000,
          seasonCashCents: 250_000,
        },
      ],
      sponsorReminders: [{ sponsorId: "s-1", sponsorName: "Acme Robotics", kind: "renewal", dueOn: "2026-10-01", message: "Start renewal outreach with Acme Robotics" }],
    });
    const { client } = fakeClient();
    const result = await runAiSkill("sponsorships", ctx(client, "Draft a renewal email to Acme Robotics"));
    expect(result?.status).toBe("ok");
    expect(result?.summary).toBe("1 sponsor to act on — start with Acme Robotics.");
    expect(result?.highlights[0]).toBe("Ask next: Acme Robotics — Renewal outreach due Oct 1 · renewal risk high");
    expect(result?.highlights.some((line) => line.includes("Boeing"))).toBe(true);
    const data = result?.data as { focusSponsor: { name: string; contactName: string } & Record<string, unknown> };
    expect(data.focusSponsor.name).toBe("Acme Robotics");
    expect(data.focusSponsor.contactName).toBe("Dana");
    // The contact's email address never goes to the model.
    expect(JSON.stringify(result?.data)).not.toContain("dana@example.test");
  });

  it("respects a team that turned sponsor tools off", async () => {
    business.view = liveBusiness({ sponsorsAllowed: false });
    const { client } = fakeClient();
    const result = await runAiSkill("sponsorships", ctx(client));
    expect(result?.status).toBe("setup_required");
    expect(result?.summary).toMatch(/turned off/);
  });

  it("turns a failed read into a plain setup state instead of throwing", async () => {
    business.view = Promise.reject(new Error("relation does not exist"));
    const { client } = fakeClient();
    const result = await runAiSkill("grants", ctx(client, "Which grant deadlines are coming up?"));
    expect(result?.status).toBe("setup_required");
    expect(result?.summary).toMatch(/couldn't read your team's records/);
  });

  it("returns null for an unknown skill", async () => {
    const { client } = fakeClient();
    expect(await runAiSkill("not-a-skill", ctx(client))).toBeNull();
  });
});
