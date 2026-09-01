import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/chemistry promotes partner-fit onto pick_lists through
 * promoteChemistryShortlist (the picklist store). This file covers the route
 * contract: auth, action allowlist, honest setup, and that fit is taken from the
 * loaded view — never a client-supplied DEMO score.
 */

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  eventKey: "2026onto" as string | null,
  chemistryScore: 72 as number | null,
  teamKeys: ["frc254", "frc1678"] as string[],
  promote: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: {
    api: {
      getSession: async () => state.session,
    },
  },
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) => work({}),
}));

vi.mock("../reference/hydrate-active-event", () => ({
  hydrateOrgActiveEvent: async () => undefined,
}));

vi.mock("./load-chemistry", () => ({
  loadAllianceChemistry: async () => ({
    status: state.eventKey ? "live" : "setup_required",
    orgId: ORG,
    eventKey: state.eventKey,
    eventName: state.eventKey ? "Ontario Provincial" : null,
    teamNumber: 254,
    teamKey: "frc254",
    tbaConfigured: true,
    teamKeys: state.teamKeys,
    chemistry: state.chemistryScore == null
      ? { score: null, modelVersion: "alliance-chemistry-v1" }
      : {
          score: state.chemistryScore,
          modelVersion: "alliance-chemistry-v1",
          complementarity: 85,
          totalEpa: 94.2,
          reliabilityBlend: 80,
        },
    teams: [],
    suggestions: [],
    computedAt: "2026-03-01T00:00:00.000Z",
  }),
}));

vi.mock("./promote-to-pick-list", async () => {
  const actual = await vi.importActual<typeof import("./promote-to-pick-list")>(
    "./promote-to-pick-list",
  );
  return {
    ...actual,
    promoteChemistryShortlist: (...args: unknown[]) => state.promote(...args),
  };
});

const { POST } = await import("../../app/api/chemistry/route");

function post(body: Record<string, unknown>) {
  return POST(
    new Request("https://vantage.test/api/chemistry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  state.session = { user: { id: USER } };
  state.eventKey = "2026onto";
  state.chemistryScore = 72;
  state.teamKeys = ["frc254", "frc1678"];
  state.promote.mockReset();
  state.promote.mockResolvedValue({
    pickListId: "desk-list",
    promoted: ["frc254", "frc1678"],
    rejected: [],
    bucket: "first_pick",
    message: "Saved 254, 1678 to the pick list.",
  });
});

describe("POST /api/chemistry partner-fit promote", () => {
  it("returns 401 when there is no session", async () => {
    state.session = null;
    const response = await post({ orgId: ORG, teamKeys: ["254"] });
    expect(response.status).toBe(401);
    expect(state.promote).not.toHaveBeenCalled();
  });

  it("returns 400 when orgId is missing", async () => {
    const response = await post({ teamKeys: ["254"] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "orgId is required" });
  });

  it("rejects unknown actions so island writers cannot sneak in", async () => {
    const response = await post({
      orgId: ORG,
      action: "write-chemistry-island",
      teamKeys: ["254"],
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/unknown action/i);
    expect(state.promote).not.toHaveBeenCalled();
  });

  it("refuses an empty shortlist", async () => {
    const response = await post({ orgId: ORG, action: "promote-partner-fit", teamKeys: [] });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/at least one team/i);
    expect(state.promote).not.toHaveBeenCalled();
  });

  it("requires an active event before writing the pick list", async () => {
    state.eventKey = null;
    const response = await post({
      orgId: ORG,
      action: "promote-partner-fit",
      teamKeys: ["254", "1678"],
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/active event/i);
    expect(state.promote).not.toHaveBeenCalled();
  });

  it("promotes onto the spine with MODEL fit from the loaded view, ignoring client scores", async () => {
    const response = await post({
      orgId: ORG,
      action: "promote-partner-fit",
      teamKeys: ["254", "1678"],
      bucket: "first_pick",
      score: 99,
      notes: "DEMO 99",
    });
    expect(response.status).toBe(200);
    expect(state.promote).toHaveBeenCalledTimes(1);
    const input = state.promote.mock.calls[0]![1] as {
      eventKey: string;
      teamKeys: Array<string | number>;
      fit: { score: number | null; allianceTeamKeys: string[] };
      notes: string | null;
    };
    expect(input.eventKey).toBe("2026onto");
    expect(input.teamKeys).toEqual(["254", "1678"]);
    expect(input.fit.score).toBe(72);
    expect(input.fit.allianceTeamKeys).toEqual(["frc254", "frc1678"]);
    expect(input.notes).toBe("DEMO 99");
    const body = await response.json();
    expect(body.promotion.pickListId).toBe("desk-list");
    expect(body.promotion.message).toContain("254, 1678");
  });

  it("accepts the legacy save-to-pick-list action alias", async () => {
    const response = await post({
      orgId: ORG,
      action: "save-to-pick-list",
      teamKeys: ["118"],
    });
    expect(response.status).toBe(200);
    expect(state.promote).toHaveBeenCalled();
  });

  it("passes a null score through when chemistry could not score — never DEMO", async () => {
    state.chemistryScore = null;
    const response = await post({
      orgId: ORG,
      action: "promote",
      teamKeys: ["254"],
    });
    expect(response.status).toBe(200);
    const input = state.promote.mock.calls[0]![1] as { fit: { score: number | null } };
    expect(input.fit.score).toBeNull();
  });
});
