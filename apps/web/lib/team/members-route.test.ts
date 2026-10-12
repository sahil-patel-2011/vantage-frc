import { describe, expect, it, vi } from "vitest";

const ORG = "22222222-2222-4222-8222-222222222222";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "student-1" } }) } },
  assertOrgCapability: async () => {
    throw new Error("Organization administrator access required");
  },
  getAdminTenureSnapshot: async () => null,
  HUB_ACCESS_HUB_IDS: [],
  listOrganizationMembers: async () => [],
  listOrgHubAccessByUser: async () => ({}),
  ORG_CAPABILITIES: [],
  setMemberCapabilities: async () => undefined,
  setMemberHubAccess: async () => undefined,
  removeMember: async () => undefined,
  setMemberRole: async () => undefined,
  handOverTeam: async () => undefined,
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) =>
    work({ query: async () => ({ rows: [], rowCount: 0 }) }),
}));

const { GET } = await import("../../app/api/organizations/members/route");

describe("GET /api/organizations/members for a student (QA A3-22)", () => {
  it("says who can, in plain words, with a 403", async () => {
    const response = await GET(new Request(`http://localhost/api/organizations/members?orgId=${ORG}`));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string; reason: string };
    expect(body.reason).toBe("team_admin_only");
    expect(body.error).toBe("Only the team owner and mentors or coaches can see or change people. Ask one of them.");
    expect(body.error).not.toMatch(/organization|administrator/i);
  });
});
