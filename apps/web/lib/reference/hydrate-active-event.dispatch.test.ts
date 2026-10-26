import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  dispatch: { ok: false as const, pending: true as const, reason: "cron_unconfigured" as const } as
    | { ok: true; body: { status: string } }
    | { ok: false; pending: true; reason: "cron_unconfigured" },
  row: {
    orgId: "11111111-1111-4111-8111-111111111111",
    eventKey: "2026alpha",
    matchCount: 0,
    matchSyncedAt: null as string | null,
    epaCount: 0,
    epaSyncedAt: null as string | null,
  },
  afterCalls: 0,
}));

vi.mock("@vantage/db", () => ({
  withRls: async (
    _ctx: unknown,
    work: (client: { query: () => Promise<{ rows: unknown[] }> }) => Promise<unknown>,
  ) => work({ query: async () => ({ rows: [state.row] }) }),
}));

vi.mock("next/server", () => ({
  after: () => {
    state.afterCalls += 1;
  },
}));

vi.mock("./dispatch-cron", () => ({
  dispatchCron: async () => state.dispatch,
}));

const { hydrateOrgActiveEvent } = await import("./hydrate-active-event");

beforeEach(() => {
  state.afterCalls = 0;
  state.dispatch = { ok: false, pending: true, reason: "cron_unconfigured" };
  state.row = {
    orgId: ORG,
    eventKey: "2026alpha",
    matchCount: 0,
    matchSyncedAt: null,
    epaCount: 0,
    epaSyncedAt: null,
  };
});

describe("hydrateOrgActiveEvent cron dispatch", () => {
  it("leaves an empty cache empty when the cron is not configured", async () => {
    const result = await hydrateOrgActiveEvent({ userId: USER, requestedOrg: ORG });
    expect(result).toEqual({ orgId: ORG, eventKey: "2026alpha", fetched: false });
    expect(state.afterCalls).toBe(0);
  });

  it("reports fetched when the cron accepts the blocking refresh", async () => {
    state.row.eventKey = "2026beta";
    state.dispatch = { ok: true, body: { status: "refreshed" } };
    const result = await hydrateOrgActiveEvent({ userId: USER, requestedOrg: ORG });
    expect(result.fetched).toBe(true);
    expect(result.eventKey).toBe("2026beta");
  });

  it("serves stale matches and schedules the cron after the response", async () => {
    state.row = {
      orgId: ORG,
      eventKey: "2026gamma",
      matchCount: 4,
      matchSyncedAt: "2020-01-01T00:00:00.000Z",
      epaCount: 4,
      epaSyncedAt: "2020-01-01T00:00:00.000Z",
    };
    const result = await hydrateOrgActiveEvent({ userId: USER, requestedOrg: ORG });
    expect(result).toEqual({ orgId: ORG, eventKey: "2026gamma", fetched: false });
    expect(state.afterCalls).toBe(1);
  });
});
