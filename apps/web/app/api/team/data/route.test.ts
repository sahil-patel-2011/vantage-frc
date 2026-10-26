import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  dispatch: { ok: false as const, pending: true as const, reason: "cron_unconfigured" as const } as
    | { ok: true; body: { summary: { matches: number; teams: number } } }
    | { ok: false; pending: true; reason: "cron_unconfigured" },
  notified: false,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: USER } }) } },
  assertOrgCapability: async () => undefined,
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_ctx: unknown, work: (client: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) =>
    work({
      query: async (sql: string) => {
        if (sql.includes("active_event_key")) return { rows: [{ eventKey: "2026test", credentialId: null }] };
        if (sql.includes("team_number")) return { rows: [{ teamNumber: 1111, eventName: "Test" }] };
        return { rows: [] };
      },
    }),
  withSavepoint: async (_client: unknown, work: () => Promise<unknown>) => work(),
}));
vi.mock("../../../../lib/notify-match", () => ({
  notifyNextMatchReady: async () => {
    state.notified = true;
    return { status: "sent" };
  },
}));
vi.mock("../../../../lib/reference-health", () => ({ loadDataSourceHealth: async () => null }));
vi.mock("../../../../lib/reference/dispatch-cron", () => ({
  dispatchCron: async () => state.dispatch,
}));
vi.mock("../../../../lib/security/public-error", () => ({
  publicErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "failed"),
}));

const { POST } = await import("./route");

beforeEach(() => {
  state.notified = false;
  state.dispatch = { ok: false, pending: true, reason: "cron_unconfigured" };
});

describe("POST /api/team/data", () => {
  it("does not notify when the event sync is still pending", async () => {
    const response = await POST(new Request("https://vantage.example/api/team/data", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG, action: "sync" }),
    }));
    expect(await response.json()).toEqual({ success: true, pending: true });
    expect(state.notified).toBe(false);
  });

  it("returns the cron summary and then notifies", async () => {
    state.dispatch = { ok: true, body: { summary: { matches: 3, teams: 2 } } };
    const response = await POST(new Request("https://vantage.example/api/team/data", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG, action: "sync" }),
    }));
    expect(await response.json()).toMatchObject({ success: true, summary: { matches: 3, teams: 2 } });
    expect(state.notified).toBe(true);
  });
});
