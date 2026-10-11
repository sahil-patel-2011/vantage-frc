import { beforeEach, describe, expect, it, vi } from "vitest";

const ADMIN = "11111111-1111-4111-8111-111111111111";
const OWNER = "33333333-3333-4333-8333-333333333333";
const ORG = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  owner: null as null | { id: string; emailVerified: boolean },
  contexts: [] as Array<{ userId: string; orgId?: string }>,
  defaultsCalls: [] as Array<{ orgId: string; actor: string; asUser: string }>,
  defaultsResult: { defaults: true, joinCode: true } as { defaults: boolean; joinCode: boolean },
  current: "" as string,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("../google-sheets/sheets-hub", () => ({
  ensureHubSheetForNewTeam: async () => undefined,
  loadSheetsHubBridge: async () => null,
  teamSheetTitle: () => "Team",
}));
vi.mock("../provisioning/owner-defaults", () => ({
  ensureFirstOwnerTeamDefaults: vi.fn(async (_client: unknown, orgId: string, actor: string) => {
    state.defaultsCalls.push({ orgId, actor, asUser: state.current });
    return state.defaultsResult;
  }),
}));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: ADMIN }, session: { id: "session-1" } }) } },
  assertPlatformAdmin: async () => undefined,
  assertPlatformPrivilegeMfa: async () => ({ bootstrap: true }),
  createOrganizationAsPlatformAdmin: async () => ORG,
  createInviteToken: () => ({ token: "t".repeat(43), tokenHash: "hash" }),
  deliverInviteEmail: async () => ({ emailSent: false, delivery: "unconfigured" }),
  hashEmail: () => "email-hash",
  inviteAcceptUrl: (token: string) => `http://localhost/invite?token=${token}`,
  platformAdminDeniedResponse: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
  writeAdminAction: async () => undefined,
}));
vi.mock("@vantage/db", () => ({
  withRls: async (context: { userId: string; orgId?: string }, work: (client: unknown) => Promise<unknown>) => {
    state.contexts.push(context);
    state.current = context.userId;
    return work({
      query: async (sql: string) => {
        if (sql.includes("FROM users")) return { rows: state.owner ? [state.owner] : [], rowCount: state.owner ? 1 : 0 };
        if (sql.includes("INSERT INTO organizations")) return { rows: [{ id: ORG }], rowCount: 1 };
        if (sql.includes("INSERT INTO invites")) return { rows: [{ id: "invite-1" }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
    });
  },
}));

const { POST } = await import("../../app/api/admin/organizations/route");

const provision = () =>
  POST(
    new Request("http://localhost/api/admin/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Team 1678", slug: "team-1678", teamNumber: 1678, ownerEmail: "owner@example.test" }),
    }),
  );

describe("POST /api/admin/organizations team defaults", () => {
  beforeEach(() => {
    state.owner = null;
    state.contexts = [];
    state.defaultsCalls = [];
    state.defaultsResult = { defaults: true, joinCode: true };
  });

  it("adds the /claim defaults as the seeded owner, after the admin's transaction", async () => {
    state.owner = { id: OWNER, emailVerified: true };
    const response = await provision();
    expect(response.status).toBe(201);
    expect(state.contexts).toEqual([{ userId: ADMIN }, { userId: OWNER, orgId: ORG }]);
    expect(state.defaultsCalls).toEqual([{ orgId: ORG, actor: OWNER, asUser: OWNER }]);
    const body = (await response.json()) as { teamDefaults?: string };
    expect(body.teamDefaults).toBe("ready");
  });

  it("reports pending defaults without failing the team when they could not be added", async () => {
    state.owner = { id: OWNER, emailVerified: true };
    state.defaultsResult = { defaults: false, joinCode: false };
    const response = await provision();
    expect(response.status).toBe(201);
    expect(((await response.json()) as { teamDefaults?: string }).teamDefaults).toBe("pending");
  });

  it("leaves an invited owner's team for the owner's own accept", async () => {
    const response = await provision();
    expect(response.status).toBe(201);
    expect(state.contexts).toEqual([{ userId: ADMIN }]);
    expect(state.defaultsCalls).toEqual([]);
    expect(((await response.json()) as { teamDefaults?: string }).teamDefaults).toBe("on_owner_join");
  });
});
