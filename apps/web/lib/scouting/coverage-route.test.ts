import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScoutForbiddenError } from "../scout-org-access";
import type { ScoutingCoverageView } from "./coverage";

/**
 * Route contract for /api/scouting/coverage. Auth and withRls are stubbed; compute and
 * watchlist loading are recorded so we can prove lineup gets watchlist-sorted coverage
 * and that an empty schedule cache is returned as empty slots — never invented.
 */

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SCOUT = "22222222-2222-4222-8222-222222222222";
const EVENT = "2026txho";

const EMPTY_SUMMARY = {
  totalSlots: 0,
  unscouted: 0,
  assignedWaiting: 0,
  covered: 0,
  doubleCovered: 0,
  coverageRate: null,
  doubleRate: null,
};

function emptyLive(overrides: Partial<Extract<ScoutingCoverageView, { status: "live" }>> = {}): Extract<
  ScoutingCoverageView,
  { status: "live" }
> {
  return {
    status: "live",
    orgId: ORG,
    teamNumber: 1234,
    eventKey: EVENT,
    generatedAt: "2026-03-01T00:00:00.000Z",
    qualsOnly: true,
    canAssign: true,
    summary: EMPTY_SUMMARY,
    live: { focusMatchKeys: [], focusSlots: [], gapSlots: [], doubleSlots: [] },
    slots: [],
    scouts: [],
    schemaRoles: {
      status: "no_schema",
      roles: {},
      mappedRoles: [],
      missingRoles: [],
      unmappedFields: [],
      optedOutFields: [],
      warnings: [],
    },
    ...overrides,
  };
}

const state = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  member: true,
  role: "admin" as string,
  priorityTeamKeys: [] as string[],
  view: null as unknown,
  compute: vi.fn(),
  assign: vi.fn(),
  swap: vi.fn(),
  applyAuto: vi.fn(),
  loadWatchlist: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string) => {
        if (sql.includes("FROM memberships")) {
          return state.member
            ? { rows: [{ role: state.role }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    }),
}));

vi.mock("../watchlist", async () => {
  const actual = await vi.importActual<typeof import("../watchlist")>("../watchlist");
  return {
    ...actual,
    loadWatchlistTeamKeys: (...args: unknown[]) => state.loadWatchlist(...args),
  };
});

vi.mock("./coverage", async () => {
  const actual = await vi.importActual<typeof import("./coverage")>("./coverage");
  return {
    ...actual,
    computeScoutingCoverageView: (...args: unknown[]) => state.compute(...args),
    assignCoverageSlot: (...args: unknown[]) => state.assign(...args),
    swapCoverageSlot: (...args: unknown[]) => state.swap(...args),
    applyAutoAssignments: (...args: unknown[]) => state.applyAuto(...args),
  };
});

const { GET, POST } = await import("../../app/api/scouting/coverage/route");

function getRequest(query = `?orgId=${ORG}`) {
  return new Request(`http://localhost/api/scouting/coverage${query}`);
}

function postRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/scouting/coverage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.session = { user: { id: USER } };
  state.member = true;
  state.role = "admin";
  state.priorityTeamKeys = [];
  state.view = emptyLive();
  state.compute.mockReset();
  state.assign.mockReset();
  state.swap.mockReset();
  state.applyAuto.mockReset();
  state.loadWatchlist.mockReset();
  state.loadWatchlist.mockImplementation(async () => state.priorityTeamKeys);
  state.compute.mockImplementation(async () => state.view);
  state.assign.mockResolvedValue({ inserted: true });
  state.swap.mockResolvedValue({ moved: true });
  state.applyAuto.mockResolvedValue({ assigned: 0 });
});

describe("GET /api/scouting/coverage", () => {
  it("returns 401 when there is no session", async () => {
    state.session = null;
    const response = await GET(getRequest());
    expect(response.status).toBe(401);
    expect(state.compute).not.toHaveBeenCalled();
  });

  it("calls computeScoutingCoverageView with watchlist priority keys", async () => {
    state.priorityTeamKeys = ["frc1323", "frc254"];
    const response = await GET(getRequest(`?orgId=${ORG}&window=4`));
    expect(response.status).toBe(200);
    expect(state.loadWatchlist).toHaveBeenCalledWith(expect.anything(), ORG);
    expect(state.compute).toHaveBeenCalledTimes(1);
    expect(state.compute.mock.calls[0]![1]).toMatchObject({
      userId: USER,
      requestedOrg: ORG,
      windowSize: 4,
      qualsOnly: true,
      priorityTeamKeys: ["frc1323", "frc254"],
    });
  });

  it("returns empty slots when the schedule cache is empty — never invents coverage", async () => {
    state.view = emptyLive();
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = (await response.json()) as Extract<ScoutingCoverageView, { status: "live" }>;
    expect(body.status).toBe("live");
    expect(body.slots).toEqual([]);
    expect(body.live.focusSlots).toEqual([]);
    expect(body.live.gapSlots).toEqual([]);
    expect(body.summary.totalSlots).toBe(0);
    expect(body.summary.coverageRate).toBeNull();
  });

  it("returns 403 when compute hard-denies a foreign org", async () => {
    state.compute.mockRejectedValue(new ScoutForbiddenError("forbidden"));
    const response = await GET(getRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Organization access denied" });
  });
});

describe("POST /api/scouting/coverage", () => {
  it("returns 401 when there is no session", async () => {
    state.session = null;
    const response = await POST(postRequest({ orgId: ORG, action: "assign" }));
    expect(response.status).toBe(401);
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("returns 400 when orgId is missing", async () => {
    const response = await POST(postRequest({ action: "assign" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "orgId is required" });
  });

  it("rejects an unknown action", async () => {
    const response = await POST(postRequest({ orgId: ORG, action: "invent-coverage" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/unknown action/i);
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("refuses assignment writes from a scout role", async () => {
    state.role = "scout";
    const response = await POST(
      postRequest({
        orgId: ORG,
        action: "assign",
        matchKey: `${EVENT}_qm1`,
        teamKey: "frc254",
        userId: SCOUT,
      }),
    );
    expect(response.status).toBe(403);
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("assigns a slot then returns the refreshed compute view", async () => {
    const response = await POST(
      postRequest({
        orgId: ORG,
        action: "assign",
        matchKey: `${EVENT}_qm1`,
        teamKey: "frc254",
        userId: SCOUT,
        focusMatchKey: `${EVENT}_qm1`,
      }),
    );
    expect(response.status).toBe(200);
    expect(state.loadWatchlist).toHaveBeenCalledWith(expect.anything(), ORG);
    expect(state.assign).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      eventKey: EVENT,
      matchKey: `${EVENT}_qm1`,
      teamKey: "frc254",
      userId: SCOUT,
    });
    expect(state.compute.mock.calls[0]![1]).toMatchObject({
      priorityTeamKeys: [],
      requestedOrg: ORG,
    });
    const body = (await response.json()) as { status: string; slots: unknown[] };
    expect(body.status).toBe("live");
    expect(body.slots).toEqual([]);
  });

  it("auto-assigns watchlisted gaps before later schedule slots", async () => {
    state.priorityTeamKeys = ["frc2"];
    state.view = emptyLive({
      slots: [
        {
          matchKey: "m2",
          teamKey: "frc2",
          status: "unscouted",
          assignmentCount: 0,
          matchNumber: 2,
          compLevel: "qm",
        },
        {
          matchKey: "m1",
          teamKey: "frc1",
          status: "unscouted",
          assignmentCount: 0,
          matchNumber: 1,
          compLevel: "qm",
        },
      ] as Extract<ScoutingCoverageView, { status: "live" }>["slots"],
      scouts: [{ userId: SCOUT, name: "Grace", role: "scout", assignedCount: 0, isMe: false }],
    });

    const response = await POST(postRequest({ orgId: ORG, action: "auto-assign" }));
    expect(response.status).toBe(200);
    expect(state.applyAuto).toHaveBeenCalledTimes(1);
    const applied = state.applyAuto.mock.calls[0]![1] as {
      plan: Array<{ teamKey: string; userId: string }>;
    };
    expect(applied.plan.map((entry) => entry.teamKey)).toEqual(["frc2", "frc1"]);
    expect(applied.plan[0]?.userId).toBe(SCOUT);
    expect(state.compute.mock.calls[0]![1]).toMatchObject({
      priorityTeamKeys: ["frc2"],
    });
  });

  it("swaps a slot between members", async () => {
    const response = await POST(
      postRequest({
        orgId: ORG,
        action: "swap",
        matchKey: `${EVENT}_qm1`,
        teamKey: "frc118",
        fromUserId: USER,
        toUserId: SCOUT,
      }),
    );
    expect(response.status).toBe(200);
    expect(state.swap).toHaveBeenCalledWith(expect.anything(), {
      orgId: ORG,
      matchKey: `${EVENT}_qm1`,
      teamKey: "frc118",
      fromUserId: USER,
      toUserId: SCOUT,
    });
  });
});
