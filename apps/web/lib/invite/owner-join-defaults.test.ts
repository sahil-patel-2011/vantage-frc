import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ orgId: string; actor: string }>,
  completed: { accessStatus: "approved", workspaceOrgId: "22222222-2222-4222-8222-222222222222", workspaceRole: "owner" } as Record<string, unknown>,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../rate-limit", () => ({
  anonymizeIp: () => "ip",
  clientIp: () => "127.0.0.1",
  createRateLimiter: () => ({ allow: async () => true }),
  rateLimitedResponse: () => Response.json({ error: "slow" }, { status: 429 }),
}));
vi.mock("../provisioning/owner-defaults", () => ({
  ensureFirstOwnerTeamDefaults: vi.fn(async (_client: unknown, orgId: string, actor: string) => {
    state.calls.push({ orgId, actor });
    return { defaults: true, joinCode: true };
  }),
}));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: USER, email: "owner@example.test" } }) } },
  isInviteTokenShape: () => true,
  peekOrganizationInvite: async () => ({ orgId: ORG, email: "owner@example.test", status: "pending", role: "owner" }),
  assertLegalAccepted: () => undefined,
  recordLegalAcceptance: async () => undefined,
  acceptOrganizationInvite: async () => ORG,
  acceptMyOrganizationInvite: async () => ORG,
  completeOnboarding: async () => state.completed,
  getOnboardingState: async () => state.completed,
  saveOnboardingProgress: async () => state.completed,
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({
      query: async (sql: string) =>
        sql.includes("terms_accepted_at")
          ? { rows: [{ termsAcceptedAt: "2026-01-01", privacyAcceptedAt: "2026-01-01", terms: "x", privacy: "x" }], rowCount: 1 }
          : { rows: [], rowCount: 0 },
    }),
}));

const accept = await import("../../app/api/invites/accept/route");
const acceptMine = await import("../../app/api/invites/accept-mine/route");
const onboarding = await import("../../app/api/onboarding/route");

const json = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const finished = {
  firstName: "Olive",
  lastName: "Owner",
  dateOfBirth: "1990-01-01",
  gender: "prefer_not_to_say",
  preferredTeamNumber: 1678,
  primaryFocus: "leadership",
  termsAccepted: true,
  privacyAccepted: true,
};

describe("an owner joining an /admin team gets the team's starter defaults", () => {
  beforeEach(() => {
    state.calls = [];
    state.completed = { accessStatus: "approved", workspaceOrgId: ORG, workspaceRole: "owner", complete: true };
  });

  it("through the invite link", async () => {
    const response = await accept.POST(json("http://localhost/api/invites/accept", { token: "t".repeat(43) }));
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{ orgId: ORG, actor: USER }]);
  });

  it("through one-tap join by verified email", async () => {
    const response = await acceptMine.POST(json("http://localhost/api/invites/accept-mine", { orgId: ORG }));
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{ orgId: ORG, actor: USER }]);
  });

  it("when finishing onboarding joins the owner", async () => {
    const response = await onboarding.POST(json("http://localhost/api/onboarding", finished));
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{ orgId: ORG, actor: USER }]);
  });

  it("not when onboarding leaves someone waiting or joins them as a member", async () => {
    state.completed = { accessStatus: "pending", workspaceOrgId: ORG, workspaceRole: "owner", complete: true };
    await onboarding.POST(json("http://localhost/api/onboarding", finished));
    state.completed = { accessStatus: "approved", workspaceOrgId: ORG, workspaceRole: "scout", complete: true };
    await onboarding.POST(json("http://localhost/api/onboarding", finished));
    expect(state.calls).toEqual([]);
  });
});
