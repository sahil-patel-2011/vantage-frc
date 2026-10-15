import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; emailVerified: boolean } },
  member: null as null | { orgId: string; orgName: string; teamNumber: number },
  inviteId: "invite-1" as string | null,
  retryAt: null as string | null,
  calls: [] as string[],
  params: [] as unknown[][],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../rate-limit", () => ({
  anonymizeIp: () => "ip",
  clientIp: () => "127.0.0.1",
  createRateLimiter: () => ({ allow: async () => true }),
  rateLimitedResponse: () => Response.json({ error: "slow" }, { status: 429 }),
}));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => state.session } },
  peekOrganizationInvite: async () => ({ orgName: "Robo Rangers", teamNumber: 6925 }),
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string, params: unknown[] = []) => {
        state.calls.push(sql);
        state.params.push(params);
        return { rows: state.member ? [state.member] : [], rowCount: state.member ? 1 : 0 };
      },
    }),
  requestPool: {
    query: async (sql: string, params: unknown[] = []) => {
      state.calls.push(sql);
      state.params.push(params);
      if (sql.includes("team_code_join_retry_at")) return { rows: [{ retryAt: state.retryAt }], rowCount: 1 };
      return { rows: [{ id: state.inviteId }], rowCount: 1 };
    },
    connect: async () => ({ query: async () => ({ rows: [] }), release: () => undefined }),
  },
}));

const { POST } = await import("../../app/api/teams/join/route");
const join = () =>
  POST(
    new Request("http://localhost/api/teams/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ teamNumber: 6925, pin: "123456", email: "sam@example.test" }),
    }),
  );

// Email-first joining (ff270e73a): a code is only checked for a signed-in, verified email, and the
// invitation is issued to that session's email, never to an address typed into the request.
const SIGNED_IN = { user: { id: "user-1", email: "Sam@Example.TEST", emailVerified: true } };

describe("POST /api/teams/join", () => {
  beforeEach(() => {
    state.session = SIGNED_IN;
    state.member = null;
    state.inviteId = "invite-1";
    state.retryAt = null;
    state.calls = [];
    state.params = [];
  });

  it("asks a signed-out or unverified person to verify their email before checking any code", async () => {
    state.session = null;
    const signedOut = await join();
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toMatchObject({ code: "auth_required" });
    state.session = { user: { ...SIGNED_IN.user, emailVerified: false } };
    expect((await join()).status).toBe(401);
    expect(state.calls.some((sql) => sql.includes("request_team_code_invite"))).toBe(false);
  });

  it("issues the invitation to the session's verified email, not the one in the request", async () => {
    state.session = { user: { ...SIGNED_IN.user, email: "Riley@Example.TEST" } };
    await join();
    const call = state.calls.findIndex((sql) => sql.includes("request_team_code_invite"));
    expect(state.params[call]?.[2]).toBe("riley@example.test");
  });

  it("tells a wrong code apart from a lockout, and never says to wait on a first mistake (QA A3-14)", async () => {
    state.inviteId = null;
    const wrong = await join();
    expect(wrong.status).toBe(400);
    const wrongBody = (await wrong.json()) as { error: string; code: string };
    expect(wrongBody.code).toBe("join_code_wrong");
    expect(wrongBody.error).not.toMatch(/fifteen|wait/i);

    state.retryAt = "2026-10-11T20:42:00.000Z";
    const locked = await join();
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "join_code_locked", retryAt: "2026-10-11T20:42:00.000Z" });
  });

  it("issues a code invitation and names the team for the sign-in copy", async () => {
    const response = await join();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { href: string; orgName: string; teamNumber: number };
    expect(body.href).toMatch(/^\/invite\?token=[A-Za-z0-9_-]{43}$/);
    expect(body).toMatchObject({ orgName: "Robo Rangers", teamNumber: 6925 });
  });

  it("tells a signed-in member they are already on the team, without a new invitation", async () => {
    state.member = { orgId: ORG, orgName: "Robo Rangers", teamNumber: 6925 };
    const response = await join();
    expect(await response.json()).toEqual({
      alreadyMember: true,
      orgId: ORG,
      orgName: "Robo Rangers",
      teamNumber: 6925,
      href: `/dashboard?orgId=${ORG}`,
    });
    expect(state.calls.some((sql) => sql.includes("request_team_code_invite"))).toBe(false);
  });

  it("still checks the code for a signed-in person on another team", async () => {
    state.inviteId = null;
    const response = await join();
    expect(response.status).toBe(400);
    expect(state.calls.some((sql) => sql.includes("request_team_code_invite"))).toBe(true);
  });
});
