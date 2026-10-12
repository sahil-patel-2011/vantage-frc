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
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  takenName: null as string | null,
  notices: [] as Array<{ email: string; subject: string }>,
  converted: [] as string[],
  deleteError: null as unknown,
  rotated: true,
}));
vi.mock("../marketing/waitlist", () => ({
  waitlistBackend: () => "memory",
  createWaitlistStore: () => ({
    markConverted: async (email: string) => {
      state.converted.push(email);
      return { email };
    },
  }),
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
  resolveAuthBaseURL: () => "https://vantage.example",
  createEmailProvider: () => ({
    name: "resend",
    sendSecurityNotice: async (message: { email: string; subject: string }) => {
      state.notices.push({ email: message.email, subject: message.subject });
    },
  }),
}));
vi.mock("@vantage/db", () => ({
  withRls: async (context: { userId: string; orgId?: string }, work: (client: unknown) => Promise<unknown>) => {
    state.contexts.push(context);
    state.current = context.userId;
    return work({
      query: async (sql: string, params: unknown[] = []) => {
        state.queries.push({ sql, params });
        if (sql.includes("FROM users")) return { rows: state.owner ? [state.owner] : [], rowCount: state.owner ? 1 : 0 };
        if (sql.includes("FROM organizations WHERE team_number")) {
          return { rows: state.takenName ? [{ name: state.takenName }] : [], rowCount: state.takenName ? 1 : 0 };
        }
        if (sql.includes("INSERT INTO organizations")) return { rows: [{ id: ORG }], rowCount: 1 };
        if (sql.includes("INSERT INTO invites")) return { rows: [{ id: "invite-1" }], rowCount: 1 };
        if (sql.includes("UPDATE invites")) {
          return state.rotated ? { rows: [{ email: "owner@example.test", organization: "Team 1678" }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("delete_team") && state.deleteError) throw state.deleteError;
        return { rows: [], rowCount: 1 };
      },
    });
  },
}));

const { POST, PATCH, DELETE } = await import("../../app/api/admin/organizations/route");

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
    state.queries = [];
    state.takenName = null;
    state.notices = [];
    state.converted = [];
    state.deleteError = null;
    state.rotated = true;
  });

  it("adds the /claim defaults as the seeded owner, after the admin's transaction", async () => {
    state.owner = { id: OWNER, emailVerified: true };
    const response = await provision();
    expect(response.status).toBe(201);
    // The admin's transaction, then the defaults and the owner's inbox note, both as the owner.
    expect(state.contexts).toEqual([{ userId: ADMIN }, { userId: OWNER, orgId: ORG }, { userId: OWNER, orgId: ORG }]);
    expect(state.defaultsCalls).toEqual([{ orgId: ORG, actor: OWNER, asUser: OWNER }]);
    const body = (await response.json()) as { teamDefaults?: string };
    expect(body.teamDefaults).toBe("ready");
  });

  it("tells an existing account they own the new team, by email and in Vantage (A2-08)", async () => {
    state.owner = { id: OWNER, emailVerified: true };
    const response = await provision();
    const body = (await response.json()) as { owner: { emailSent?: boolean } };
    expect(body.owner.emailSent).toBe(true);
    expect(state.notices).toEqual([{ email: "owner@example.test", subject: "You're the owner of Team 1678 on Vantage" }]);
    const note = state.queries.find((query) => query.sql.includes("'team_owner_added'"));
    expect(note?.params.slice(0, 2)).toEqual([OWNER, ORG]);
  });

  it("names a team number that already has a team before touching the web address (A2-07)", async () => {
    state.takenName = "Ionic Bond";
    const response = await provision();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Team 1678 already has a team (Ionic Bond). Find it in the list on the right.");
    expect(state.queries.some((query) => query.sql.includes("INSERT INTO organizations"))).toBe(false);
  });

  it("marks the owner's waitlist request converted (A2-09)", async () => {
    await provision();
    expect(state.converted).toEqual(["owner@example.test"]);
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

describe("PATCH /api/admin/organizations owner link", () => {
  beforeEach(() => {
    state.queries = [];
    state.rotated = true;
  });

  const reissue = () =>
    PATCH(
      new Request("http://localhost/api/admin/organizations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "owner_link", orgId: ORG }),
      }),
    );

  it("reissues an expired owner invite too, and only while the team has no owner (A2-03)", async () => {
    const response = await reissue();
    expect(response.status).toBe(200);
    const update = state.queries.find((query) => query.sql.includes("UPDATE invites"))!;
    expect(update.sql).toContain("i.status IN ('pending', 'expired')");
    expect(update.sql).toContain("status = 'pending'");
    expect(update.sql).toContain("NOT EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = $1::uuid AND m.role = 'owner')");
  });

  it("says plainly when there is nothing to replace", async () => {
    state.rotated = false;
    const response = await reissue();
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/owner may have joined already/);
  });
});

describe("DELETE /api/admin/organizations", () => {
  beforeEach(() => {
    state.queries = [];
    state.deleteError = null;
  });

  const remove = (confirm: string) =>
    DELETE(
      new Request("http://localhost/api/admin/organizations", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: ORG, confirm }),
      }),
    );

  it("deletes through delete_team with the typed number", async () => {
    const response = await remove("1 ");
    expect(response.status).toBe(200);
    expect(state.queries.find((query) => query.sql.includes("delete_team"))?.params).toEqual([ORG, "1"]);
  });

  it("explains a refusal instead of passing database text through", async () => {
    state.deleteError = Object.assign(new Error("Type the team number to confirm"), { code: "22023", detail: "vantage:confirm_mismatch" });
    const response = await remove("2");
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe("confirm_mismatch");
  });
});
