import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  manager: false,
  created: [] as string[],
  failFor: new Set<string>(),
  suggested: [] as Array<{ email: string; role: string; note: string | null }>,
  suggestError: null as Error | null,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../rate-limit", () => ({
  createRateLimiter: () => ({ allow: async () => true }),
  rateLimitedResponse: () => Response.json({ error: "slow" }, { status: 429 }),
}));
vi.mock("@vantage/core", () => {
  class AlreadyTeamMemberError extends Error {
    readonly code = "already_member";
    constructor(readonly userId: string) {
      super("Sam is already on the team as Student. To change what they can do, use Access on their row under People.");
    }
  }
  return {
    AlreadyTeamMemberError,
    ORGANIZATION_INVITE_MAX_HOURS: 168,
    auth: { api: { getSession: async () => ({ user: { id: "user-1" } }) } },
    listOrganizationInvites: async () => [{ id: "i1", email: "secret@example.test" }],
    getAdminTenureSnapshot: async () => null,
    inviteEmailDeliveryMode: () => "local",
    createOrganizationInvite: async (_client: unknown, _actor: string, input: { email: string; role: string }) => {
      if (input.email === "member@example.test") throw new AlreadyTeamMemberError("member-1");
      if (state.failFor.has(input.email)) throw new Error("Only the team owner can invite a mentor or coach.");
      state.created.push(input.email);
      return { id: `id-${input.email}`, email: input.email, role: input.role, organization: "Team", token: "t", expiresAt: new Date() };
    },
    deliverInviteEmail: async () => ({ emailSent: false, delivery: "local" }),
    publicCreatedInvite: (invite: { id: string }) => ({ id: invite.id, expiresAt: new Date(0), inviteUrl: `https://v/invite?token=${invite.id}`, emailSent: false, delivery: "local" }),
    resendOrganizationInvite: async () => undefined,
    revokeOrganizationInvite: async () => undefined,
    suggestTeamInvite: async (_client: unknown, input: { email: string; role: string; note: string | null }) => {
      if (state.suggestError) throw state.suggestError;
      state.suggested.push(input);
      return { notified: 2 };
    },
  };
});
vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string) => {
        if (sql.includes("has_org_capability")) return { rows: [{ allowed: state.manager }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
    }),
}));

const invites = await import("../../app/api/organizations/invites/route");
const suggestion = await import("../../app/api/team/invite-suggestion/route");

const post = (url: string, body: unknown, handler: (request: Request) => Promise<Response>) =>
  handler(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("GET /api/organizations/invites (QA A3-03)", () => {
  beforeEach(() => {
    state.manager = false;
  });

  it("refuses a member who can't manage people, without reading any invite", async () => {
    const response = await invites.GET(new Request(`http://localhost/api/organizations/invites?orgId=${ORG}`));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; reason: string; invites?: unknown };
    expect(body.reason).toBe("team_admin_only");
    expect(body.invites).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret@example.test");
    expect(body.error).not.toMatch(/administrator access required/i);
  });

  it("lists invites for the people who manage them", async () => {
    state.manager = true;
    const response = await invites.GET(new Request(`http://localhost/api/organizations/invites?orgId=${ORG}`));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { invites: unknown[] }).invites).toHaveLength(1);
  });
});

describe("POST /api/organizations/invites", () => {
  beforeEach(() => {
    state.created = [];
    state.failFor = new Set();
  });

  it("makes a pasted list in one request; one failure never undoes the others (QA A3-11)", async () => {
    state.failFor.add("b@example.test");
    const response = await post(
      "http://localhost/api/organizations/invites",
      { orgId: ORG, emails: ["a@example.test", "b@example.test", "ünï@example.test", "c@example.test"], role: "scout", expiresInHours: 72 },
      invites.POST,
    );
    expect(response.status).toBe(201);
    const { results } = (await response.json()) as { results: Array<{ email: string; ok: boolean; error?: string }> };
    expect(results.map((row) => row.ok)).toEqual([true, false, false, true]);
    expect(state.created).toEqual(["a@example.test", "c@example.test"]);
    // The non-ASCII address is named with a reason, not "Request fields are invalid." (QA A3-25)
    expect(results[2]!.error).toMatch(/ünï@example\.test.*can't send/);
  });

  it("says who is already on the team and gives Team admin their id (QA A3-12)", async () => {
    const response = await post("http://localhost/api/organizations/invites", { orgId: ORG, email: "member@example.test", role: "admin" }, invites.POST);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "already_member", userId: "member-1" });
  });

  it("refuses a lifetime over a week", async () => {
    const response = await post("http://localhost/api/organizations/invites", { orgId: ORG, email: "a@example.test", role: "scout", expiresInHours: 720 }, invites.POST);
    expect(response.status).toBe(400);
  });
});

describe("POST /api/team/invite-suggestion (QA A3-04)", () => {
  beforeEach(() => {
    state.suggested = [];
    state.suggestError = null;
  });

  it("sends the owner and mentors the address and the access suggested", async () => {
    const response = await post(
      "http://localhost/api/team/invite-suggestion",
      { orgId: ORG, email: "lee@school.org", role: "admin", note: "Teaches CAD" },
      suggestion.POST,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notified: 2 });
    expect(state.suggested).toEqual([{ orgId: ORG, email: "lee@school.org", role: "admin", note: "Teaches CAD" }]);
  });

  it("names a bad address and says the hourly limit plainly", async () => {
    const bad = await post("http://localhost/api/team/invite-suggestion", { orgId: ORG, email: "lee@", role: "admin" }, suggestion.POST);
    expect(bad.status).toBe(400);
    state.suggestError = Object.assign(new Error("You sent five suggestions this hour. Try again later."), { code: "P0001" });
    const limited = await post("http://localhost/api/team/invite-suggestion", { orgId: ORG, email: "lee@school.org", role: "scout" }, suggestion.POST);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toBe("You sent five suggestions this hour. Try again later.");
  });
});
