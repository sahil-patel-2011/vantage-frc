import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The remembered-team cookie only ever holds one of the person's own teams (QA A2-02), and a link to
// another team lands on the chooser that says so (QA A2-04).
const OWN = "d8a66c7b-8425-4783-bff0-a98b2f60c469";
const SECOND = "6c6a13e8-8672-4a9c-9be6-960c1298334c";
const FOREIGN = "6925a000-0000-4000-8000-000000000001";

const fake = vi.hoisted(() => ({ teams: [] as string[], membershipReads: 0 }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: async () => ({ user: { id: "owner-a" }, session: {} }) } },
  getOnboardingGate: async () => ({ onboardingComplete: true, workspaceApproved: true, accessStatus: "approved" }),
  isEmail2faEnforced: () => false,
  sessionHasEmail2fa: () => true,
}));
vi.mock("@vantage/db", () => ({
  withRls: async (_scope: unknown, callback: (client: unknown) => Promise<unknown>) =>
    callback({
      query: async (sql: string) => {
        if (/FROM memberships/.test(sql)) {
          fake.membershipReads += 1;
          return { rows: fake.teams.map((orgId) => ({ orgId })) };
        }
        return { rows: [] };
      },
    }),
}));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: () => "session" }));
vi.mock("./lib/media-availability", () => ({ MEDIA_ENABLED: true, MEDIA_PAUSED_MESSAGE: "", isPausedMediaRoute: () => false }));
vi.mock("./lib/products/products", () => ({ productRedirect: () => null, requestOrigin: () => "https://vantage.example" }));
vi.mock("./lib/google-sheets/oauth-state", () => ({ isGoogleSheetsState: () => false }));
vi.mock("./lib/provisioning/request-gate", () => ({ requestedProvisioningTeam: async () => null, pendingProvisioningTeam: async () => null }));

const { proxy } = await import("./proxy");

function request(path: string, remembered?: string) {
  const headers = remembered ? { cookie: `vantage-team=${remembered}` } : undefined;
  return new NextRequest(`https://vantage.example${path}`, { headers });
}

function rememberedCookie(response: Response): string | null {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("vantage-team="));
  return cookie ? cookie.slice("vantage-team=".length).split(";")[0]! : null;
}

beforeEach(() => {
  fake.teams = [OWN, SECOND];
  fake.membershipReads = 0;
});

describe("the remembered team", () => {
  it("remembers a team the person is on", async () => {
    const response = await proxy(request(`/dashboard?orgId=${SECOND}`, OWN));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(rememberedCookie(response)).toBe(SECOND);
  });

  it("never remembers another team, and sends the link to the chooser instead", async () => {
    const response = await proxy(request(`/team/admin?orgId=${FOREIGN}&tab=members`, OWN));
    expect(rememberedCookie(response)).toBeNull();
    const target = new URL(response.headers.get("location")!);
    expect(target.pathname).toBe("/workspace");
    expect(target.searchParams.get("notOnTeam")).toBe("1");
    // The page they wanted, for their own team, without the other team's id.
    expect(target.searchParams.get("next")).toBe("/team/admin?tab=members");
    expect(target.toString()).not.toContain(FOREIGN);
  });

  it("fills a bare team page with the person's own team when the cookie names another", async () => {
    const response = await proxy(request("/scouting/forms", FOREIGN));
    const target = new URL(response.headers.get("location")!);
    expect(target.pathname).toBe("/scouting/forms");
    expect(target.searchParams.get("orgId")).toBe(OWN);
  });

  it("keeps a remembered team the person is still on", async () => {
    const response = await proxy(request("/team/admin", SECOND));
    expect(new URL(response.headers.get("location")!).searchParams.get("orgId")).toBe(SECOND);
  });

  it("lets platform admin pages take any team without remembering it", async () => {
    const response = await proxy(request(`/admin/analytics?orgId=${FOREIGN}`, OWN));
    expect(response.headers.get("location")).toBeNull();
    expect(rememberedCookie(response)).toBeNull();
  });

  it("leaves someone on no team alone (onboarding and invites handle them)", async () => {
    fake.teams = [];
    const response = await proxy(request(`/dashboard?orgId=${FOREIGN}`));
    expect(response.headers.get("location")).toBeNull();
    expect(rememberedCookie(response)).toBeNull();
  });

  it("sends /workspace to the person's own Home, never to a stale cookie's team", async () => {
    const stale = new URL((await proxy(request("/workspace", FOREIGN))).headers.get("location")!);
    expect(stale.pathname).toBe("/dashboard");
    expect(stale.searchParams.get("orgId")).toBe(OWN);
    const own = await proxy(request("/workspace", SECOND));
    expect(new URL(own.headers.get("location")!).searchParams.get("orgId")).toBe(SECOND);
  });

  it("lets the team switcher reach the chooser untouched", async () => {
    const response = await proxy(request("/workspace?next=%2Fdashboard", OWN));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fake.membershipReads).toBe(0);
  });

  it("does not read memberships for a page that names no team", async () => {
    await proxy(request("/notebook-help-not-team-scoped"));
    expect(fake.membershipReads).toBe(0);
  });
});
