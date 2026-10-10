import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const fake = vi.hoisted(() => ({ session: vi.fn(), gate: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, getOnboardingGate: fake.gate, isEmail2faEnforced: () => false, sessionHasEmail2fa: () => true }));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, callback: (client: unknown) => Promise<unknown>) => callback({}) }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: () => "session" }));
vi.mock("./lib/media-availability", () => ({ MEDIA_ENABLED: true, MEDIA_PAUSED_MESSAGE: "", isPausedMediaRoute: () => false }));
vi.mock("./lib/products/products", () => ({ productRedirect: () => null, requestOrigin: () => "https://vantage.example" }));
vi.mock("./lib/google-sheets/oauth-state", () => ({ isGoogleSheetsState: () => false }));
vi.mock("./lib/provisioning/request-gate", () => ({ requestedProvisioningTeam: async () => null, pendingProvisioningTeam: async () => null }));
function request(path: string) { return new NextRequest(`https://vantage.example${path}`); }
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "returning-member" }, session: {} });
  fake.gate.mockResolvedValue({ onboardingComplete: true, workspaceApproved: true, accessStatus: "approved" });
});
describe("entry gates during account outages", () => {
  it("does not label a failed profile read as incomplete onboarding", async () => {
    fake.gate.mockRejectedValue(new Error("Store unavailable"));
    const response = await proxy(request("/competition?tab=scouting&orgId=team-one"));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.pathname).toBe("/access-unavailable");
    expect(destination.searchParams.get("next")).toBe("/competition?tab=scouting&orgId=team-one");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("lets API clients recognize temporary failure without an auth or onboarding redirect", async () => {
    fake.gate.mockRejectedValue(new Error("Store unavailable"));
    const response = await proxy(request("/api/scouting/formulas?orgId=team-one"));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.json()).toMatchObject({ code: "access_check_unavailable" });
  });
  it("preserves the distinction between missing onboarding and a failed lookup", async () => {
    fake.gate.mockResolvedValue({ onboardingComplete: false, workspaceApproved: false, accessStatus: "none" });
    expect(new URL((await proxy(request("/dashboard"))).headers.get("location")!).pathname).toBe("/onboarding");
  });
  it("does not erase a returning session when its lookup throws", async () => {
    fake.session.mockRejectedValue(new Error("Store unavailable"));
    expect((await proxy(request("/api/me"))).status).toBe(503);
    expect(fake.gate).not.toHaveBeenCalled();
  });
  it("keeps recovery reachable without an account lookup", async () => {
    fake.session.mockRejectedValue(new Error("Store unavailable"));
    const response = await proxy(request("/access-unavailable?next=%2Fdashboard"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fake.session).not.toHaveBeenCalled();
  });
  it("prevents a completed profile looping back into onboarding", async () => {
    expect(new URL((await proxy(request("/onboarding?next=%2Fonboarding"))).headers.get("location")!).pathname).toBe("/dashboard");
  });
});
