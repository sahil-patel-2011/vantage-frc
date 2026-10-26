import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  dispatch: { ok: true as const, body: { count: 4 as number | null } } as
    | { ok: true; body: { count: number | null } }
    | { ok: false; pending: true; reason: "cron_unconfigured" },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@vantage/core", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: USER }, session: { id: "session", authMethod: "otp" } }),
    },
  },
  assertOrgAuthentication: async () => undefined,
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_ctx: unknown, work: (client: unknown) => Promise<unknown>) => work({}),
}));
vi.mock("@vantage/scouting/permissions", () => ({ canManageScouting: async () => true }));
vi.mock("../../../../../lib/events/event-planning", () => ({ parseEventYear: () => 2026 }));
vi.mock("../../../../../lib/reference/dispatch-cron", () => ({
  dispatchCron: async () => state.dispatch,
}));
vi.mock("../../../../../lib/security/public-error", () => ({
  publicErrorMessage: () => "Published events couldn't be refreshed.",
}));

const { POST } = await import("./route");

beforeEach(() => {
  state.dispatch = { ok: true, body: { count: 4 } };
});

describe("POST /api/context/event/directory", () => {
  it("returns the cron count when the refresh finishes", async () => {
    const response = await POST(new Request("https://vantage.example/api/context/event/directory", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG, year: 2026 }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, count: 4 });
  });

  it("returns the pending flag when the cron cannot be reached", async () => {
    state.dispatch = { ok: false, pending: true, reason: "cron_unconfigured" };
    const response = await POST(new Request("https://vantage.example/api/context/event/directory", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG, year: 2026 }),
    }));
    expect(await response.json()).toEqual({ ok: true, pending: true, count: null });
  });
});
