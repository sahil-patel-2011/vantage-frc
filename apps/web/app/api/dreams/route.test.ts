import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  dispatch: { ok: true as const, body: { ok: 1, noActivity: 0, fallback: 0, errors: 0 } } as
    | { ok: true; body: { ok: number; noActivity: number; fallback: number; errors: number } }
    | { ok: false; pending: true; reason: "cron_unconfigured" },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: USER } }) } },
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_ctx: unknown, work: (client: { query: () => Promise<{ rows: unknown[] }> }) => Promise<unknown>) =>
    work({
      query: async () => ({ rows: [{ role: "owner", enabled: true, retentionDays: 30, present: true, seconds: null }] }),
    }),
}));
vi.mock("../../../lib/reference/dispatch-cron", () => ({
  dispatchCron: async () => state.dispatch,
}));
vi.mock("../../../lib/security/public-error", () => ({
  publicErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "failed"),
}));

const { POST } = await import("./route");

beforeEach(() => {
  state.dispatch = { ok: true, body: { ok: 1, noActivity: 0, fallback: 0, errors: 0 } };
});

describe("POST /api/dreams", () => {
  it("returns the cron summary for this org", async () => {
    const response = await POST(new Request("https://vantage.example/api/dreams", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary: { ok: 1, noActivity: 0, fallback: 0, errors: 0 } });
  });

  it("returns pending when the dream cron cannot be reached", async () => {
    state.dispatch = { ok: false, pending: true, reason: "cron_unconfigured" };
    const response = await POST(new Request("https://vantage.example/api/dreams", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG }),
    }));
    expect(await response.json()).toEqual({ pending: true });
  });
});
