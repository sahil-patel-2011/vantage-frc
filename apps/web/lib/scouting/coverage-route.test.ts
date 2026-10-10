import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScoutForbiddenError } from "../scout-org-access";
import type { ScoutingCoverageView } from "./coverage";
import { classifyLoadFailure } from "../ui/load-failure";

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
    eventName: null,
    generatedAt: "2026-03-01T00:00:00.000Z",
    qualsOnly: true,
    canAssign: true,
    summary: EMPTY_SUMMARY,
    live: { focusMatchKeys: [], focusSlots: [], gapSlots: [], doubleSlots: [] },
    slots: [],
    playedMatchKeys: [],
    scope: {
      playedMatches: 0,
      playedRobots: 0,
      playedScouted: 0,
      playedMissed: 0,
      upcomingMatches: 0,
      upcomingRobots: 0,
      upcomingNoScout: 0,
      reportsBeforePlay: 0,
    },
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
  session: null as { user: { id: string }; session: { id: string } } | null,
  policy: vi.fn(),
  conflicts: vi.fn(),
  query: vi.fn(),
  absentUser: "",
  member: true,
  role: "admin" as string,
  lead: false,
  priorityTeamKeys: [] as string[],
  view: null as unknown,
  compute: vi.fn(),
  assign: vi.fn(),
  swap: vi.fn(),
  applyAuto: vi.fn(),
  loadWatchlist: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
  assertOrgAuthentication: (...args: unknown[]) => state.policy(...args),
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) => work({ query: state.query }),
}));
vi.mock("./assignment-conflicts-load", () => ({ loadAssignmentConflictContext: (...args: unknown[]) => state.conflicts(...args) }));

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
  state.session = { user: { id: USER }, session: { id: "session" } };
  state.absentUser = "";
  state.policy.mockReset();
  state.policy.mockResolvedValue(undefined);
  state.query.mockReset();
  state.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("has_org_capability")) return { rows: [{ allowed: state.member && (["owner", "admin"].includes(state.role) || state.lead) }], rowCount: 1 };
    if (sql.includes("FROM memberships")) return state.member && params[1] !== state.absentUser ? { rows: [{ role: state.role }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes("FROM org_active_context")) return { rows: [{ eventKey: EVENT }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  state.conflicts.mockReset();
  state.conflicts.mockResolvedValue({ ourTeamKey: null, standingDriveTeam: new Set(), driveDuties: [], matches: new Map(), assignments: [] });
  state.member = true;
  state.role = "admin";
  state.lead = false;
  state.priorityTeamKeys = [];
  state.view = emptyLive({ slots: ["frc254", "frc118", "frc1323"].map(teamKey => ({ matchKey: `${EVENT}_qm1`, teamKey, teamNumber: Number(teamKey.slice(3)), matchNumber: 1, compLevel: "qm", status: "unscouted", entryCount: 0, assignmentCount: 0 })) });
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
  it("blocks cross-site mutations before reading or saving assignments", async () => {
    const request = new Request("http://localhost/api/scouting/coverage", { method: "POST", headers: { "content-type": "application/json", origin: "https://other.example" }, body: JSON.stringify({ orgId: ORG, action: "auto-assign" }) });
    expect((await POST(request)).status).toBe(403);
    expect(state.query).not.toHaveBeenCalled();
  });
  it("allows delegated leads to manage assignments", async () => {
    state.role = "student";
    state.lead = true;
    expect((await POST(postRequest({ orgId: ORG, action: "assign", matchKey: `${EVENT}_qm1`, teamKey: "frc254", userId: SCOUT }))).status).toBe(200);
  });
  it("serializes assignment publishers before reading conflicts", async () => {
    expect((await POST(postRequest({ orgId: ORG, action: "assign", matchKey: `${EVENT}_qm1`, teamKey: "254", userId: SCOUT }))).status).toBe(200);
    const index = state.query.mock.calls.findIndex(([sql]) => String(sql).includes("pg_advisory_xact_lock"));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(state.query.mock.calls[index]?.[1]).toEqual([`scout-assignments:${ORG}:${EVENT}`]);
    expect(state.query.mock.invocationCallOrder[index]).toBeLessThan(state.conflicts.mock.invocationCallOrder[0]!);
  });

  it("applies team authentication before assignment reads and writes", async () => {
    state.policy.mockRejectedValue(new Error("Second factor required"));
    const denied = await GET(getRequest());
    expect(denied.status).toBe(403);
    expect(classifyLoadFailure({ status: denied.status, message: (await denied.json()).error })).toBe("reauth");
    expect((await POST(postRequest({ orgId: ORG, action: "auto-assign" }))).status).toBe(403);
    expect(state.compute).not.toHaveBeenCalled();
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("refuses foreign-event robots and departed members", async () => {
    const payload = { orgId: ORG, action: "assign", matchKey: `${EVENT}_qm1`, teamKey: "frc254", userId: SCOUT };
    expect((await POST(postRequest({ ...payload, eventKey: "2026other" }))).status).toBe(400);
    expect((await POST(postRequest({ ...payload, teamKey: "frc999" }))).status).toBe(400);
    state.absentUser = SCOUT;
    expect((await POST(postRequest(payload))).status).toBe(409);
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("derives a range event from its first match and reports partial refusals", async () => {
    state.view = emptyLive({ slots: [1, 2].map(matchNumber => ({ matchKey: `${EVENT}_qm${matchNumber}`, teamKey: "frc254", teamNumber: 254, compLevel: "qm", matchNumber, assignmentCount: 0, entryCount: 0, status: "unscouted" })) });
    state.conflicts.mockResolvedValue({ ourTeamKey: null, standingDriveTeam: new Set(), driveDuties: [], matches: new Map(), assignments: [{ userId: SCOUT, matchKey: `${EVENT}_qm1`, teamKey: "frc118" }] });
    const response = await POST(postRequest({ orgId: ORG, action: "assign-range", firstMatchKey: `${EVENT}_qm1`, lastMatchKey: `${EVENT}_qm2`, teamKey: "254", userId: SCOUT }));
    expect(response.status).toBe(200);
    expect(state.conflicts).toHaveBeenCalledWith(expect.anything(), { orgId: ORG, eventKey: EVENT });
    expect(state.compute.mock.calls[0]?.[1]).toMatchObject({ requestedEvent: EVENT });
    expect(state.assign).toHaveBeenCalledTimes(1);
    expect(state.assign.mock.calls[0]?.[1]).toMatchObject({ matchKey: `${EVENT}_qm2`, eventKey: EVENT });
    expect((await response.json()).assignmentResult).toMatchObject({ assigned: 1, unchanged: 0, refused: [expect.stringMatching(/one scout, one robot/)] });
  });

  it("does not pretend a stale reassignment moved a scout", async () => {
    state.swap.mockResolvedValue({ moved: false });
    expect((await POST(postRequest({ orgId: ORG, action: "swap", matchKey: `${EVENT}_qm1`, teamKey: "frc254", fromUserId: USER, toUserId: SCOUT }))).status).toBe(409);
  });

  it("confirms an idempotent retry without counting a new assignment", async () => {
    state.assign.mockResolvedValue({ inserted: false });
    const response = await POST(postRequest({ orgId: ORG, action: "assign", matchKey: `${EVENT}_qm1`, teamKey: "frc254", userId: SCOUT }));
    expect((await response.json()).assignmentResult).toMatchObject({ assigned: 0, unchanged: 1 });
  });

  it("returns a private outage response instead of an empty successful board", async () => {
    state.compute.mockRejectedValue(new Error("Database offline"));
    const response = await GET(getRequest());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("returns 401 when there is no session", async () => {
    state.session = null;
    const response = await POST(postRequest({ orgId: ORG, action: "assign" }));
    expect(response.status).toBe(401);
    expect(state.assign).not.toHaveBeenCalled();
  });

  it("returns 400 when orgId is missing", async () => {
    const response = await POST(postRequest({ action: "assign" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Request fields are invalid." });
  });

  it("rejects an unknown action", async () => {
    const response = await POST(postRequest({ orgId: ORG, action: "invent-coverage" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/invalid/i);
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
    expect(body.slots).toEqual((state.view as ScoutingCoverageView & { slots: unknown[] }).slots);
    expect((body as unknown as { assignmentResult: unknown }).assignmentResult).toMatchObject({ action: "assign", assigned: 1, unchanged: 0, refused: [] });
  });

  it("auto-assigns watchlisted gaps before later schedule slots", async () => {
    state.priorityTeamKeys = ["frc2"];
    state.view = emptyLive({
      slots: [
        {
          matchKey: `${EVENT}_qm2`,
          teamKey: "frc2",
          status: "unscouted",
          assignmentCount: 0,
          matchNumber: 2,
          compLevel: "qm",
        },
        {
          matchKey: `${EVENT}_qm1`,
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
