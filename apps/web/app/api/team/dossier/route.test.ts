import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  session: true,
  teamNumber: 1111 as number | null,
  dispatch: { ok: true as const, body: { status: "ready" as const } } as
    | { ok: true; body: { status: "ready" | "failed" } }
    | { ok: false; pending: true; reason: "cron_unconfigured" },
  viewStatus: "running" as "running" | "ready",
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => (state.session ? { user: { id: USER } } : null) } },
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_ctx: unknown, work: (client: unknown) => Promise<unknown>) => work({}),
}));
vi.mock("../../../../lib/team-dossier/store", () => ({
  claimDossierBuild: async () => state.teamNumber,
  loadTeamDossier: async () => ({ status: state.viewStatus, teamNumber: 1111, canBuild: true }),
  resolveDossierOrg: async () => ORG,
}));
vi.mock("../../../../lib/reference/dispatch-cron", () => ({
  dispatchCron: async () => state.dispatch,
}));
vi.mock("../../../../lib/security/public-error", () => ({
  publicErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "failed"),
}));

const { POST } = await import("./route");

beforeEach(() => {
  state.session = true;
  state.teamNumber = 1111;
  state.viewStatus = "running";
  state.dispatch = { ok: true, body: { status: "ready" } };
});

describe("POST /api/team/dossier", () => {
  it("returns the saved view after the cron build finishes", async () => {
    state.viewStatus = "ready";
    const response = await POST(new Request("https://vantage.example/api/team/dossier", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG, action: "build" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready", teamNumber: 1111 });
  });

  it("returns the running view when the cron is not configured", async () => {
    state.dispatch = { ok: false, pending: true, reason: "cron_unconfigured" };
    const response = await POST(new Request("https://vantage.example/api/team/dossier", {
      method: "POST",
      body: JSON.stringify({ orgId: ORG, action: "build" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "running" });
  });
});
