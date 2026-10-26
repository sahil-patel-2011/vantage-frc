import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  dispatch: { ok: false as const, pending: true as const, reason: "cron_unconfigured" as const } as
    | { ok: true; body: { summary: { matches: number } } }
    | { ok: false; pending: true; reason: "cron_unconfigured" },
  historyCalls: 0,
  seasonCalls: 0,
  eventDayCalls: 0,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => {
  class PlatformAdminRequiredError extends Error {}
  return {
    PlatformAdminRequiredError,
    auth: { api: { getSession: async () => ({ user: { id: USER }, session: { id: "sess" } }) } },
    assertOrgCapability: async () => undefined,
    assertPlatformAdmin: async () => undefined,
    assertPlatformPrivilegeMfa: async () => undefined,
  };
});
vi.mock("@vantage/db", () => ({
  withRls: async (
    _ctx: unknown,
    work: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>,
  ) =>
    work({
      query: async (sql: string) => {
        if (sql.includes("active_event_key")) return { rows: [{ eventKey: "2026test", credentialId: null }] };
        return { rows: [] };
      },
    }),
}));
vi.mock("@vantage/billing", () => ({
  createKms: () => ({}),
  decryptSecret: async () => "",
  encryptSecret: async () => ({}),
}));
vi.mock("@vantage/reference", () => ({ TbaClient: class TbaClient {} }));
vi.mock("../../../../lib/reference/dispatch-cron", () => ({
  dispatchCron: async () => state.dispatch,
}));
vi.mock("../../../../lib/reference/worker-ingest", () => ({
  runTeamYearHistorySync: async () => {
    state.historyCalls += 1;
    return { years: 1 };
  },
  runTbaSeasonSync: async () => {
    state.seasonCalls += 1;
    return { matches: 2 };
  },
  runTbaEventDaySync: async () => {
    state.eventDayCalls += 1;
    return { matches: 3 };
  },
}));
vi.mock("../../../../lib/security/public-error", () => ({
  publicErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "failed"),
}));

const { POST } = await import("./route");

function post(body: unknown) {
  return POST(new Request("https://vantage.example/api/admin/data-connectors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  state.dispatch = { ok: false, pending: true, reason: "cron_unconfigured" };
  state.historyCalls = 0;
  state.seasonCalls = 0;
  state.eventDayCalls = 0;
});

describe("POST /api/admin/data-connectors sync", () => {
  it("queues a team event sync on the cron and does not run the worker", async () => {
    const response = await post({ orgId: ORG, action: "sync" });
    expect(await response.json()).toEqual({ success: true, pending: true });
    expect(state.eventDayCalls).toBe(0);
  });

  it("returns the cron summary for a team event sync", async () => {
    state.dispatch = { ok: true, body: { summary: { matches: 5 } } };
    const response = await post({ orgId: ORG, action: "sync" });
    expect(await response.json()).toEqual({ success: true, summary: { matches: 5 } });
    expect(state.eventDayCalls).toBe(0);
  });

  it("runs a platform history sync on the worker after the admin checks", async () => {
    const response = await post({ action: "sync", syncMode: "history" });
    expect(await response.json()).toEqual({ success: true, history: { years: 1 } });
    expect(state.historyCalls).toBe(1);
    expect(state.seasonCalls).toBe(0);
    expect(state.eventDayCalls).toBe(0);
  });
});
