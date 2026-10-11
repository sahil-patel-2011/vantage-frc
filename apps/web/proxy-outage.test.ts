import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Sessions live in the database, so while it is down every signed-in request fails at the
 * proxy's session check and never reaches /api/me. That check is where an outage is first
 * seen: it still answers "try again shortly", and hands the error to the outage tracker.
 */
const state = vi.hoisted(() => ({
  sessionError: null as Error | null,
  gateError: null as Error | null,
  noted: [] as Array<{ error: unknown; source: string }>,
}));

vi.mock("@vantage/core", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => {
        if (state.sessionError) throw state.sessionError;
        return { user: { id: "user-1" }, session: {} };
      }),
    },
  },
  getOnboardingGate: vi.fn(async () => {
    if (state.gateError) throw state.gateError;
    return { onboardingComplete: true, workspaceApproved: true };
  }),
  isEmail2faEnforced: () => false,
  sessionHasEmail2fa: () => true,
}));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, callback: (client: unknown) => Promise<unknown>) => callback({}) }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: () => "session-cookie" }));
vi.mock("./lib/media-availability", () => ({ MEDIA_ENABLED: true, MEDIA_PAUSED_MESSAGE: "", isPausedMediaRoute: () => false }));
vi.mock("./lib/products/products", () => ({ productRedirect: () => null, requestOrigin: () => "https://vantage.example" }));
vi.mock("./lib/google-sheets/oauth-state", () => ({ isGoogleSheetsState: () => false }));
vi.mock("./lib/provisioning/request-gate", () => ({ requestedProvisioningTeam: async () => null, pendingProvisioningTeam: async () => null }));
vi.mock("./lib/outage/note", () => ({
  noteDatabaseFailure: (error: unknown, source: string) => {
    state.noted.push({ error, source });
  },
}));

const { proxy } = await import("./proxy");

const refused = () => Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:5432"), { code: "ECONNREFUSED" });

describe("proxy access check during a database outage", () => {
  beforeEach(() => {
    state.sessionError = null;
    state.gateError = null;
    state.noted = [];
  });

  it("hands a failed session lookup to the outage tracker and still answers 503", async () => {
    state.sessionError = refused();
    const response = await proxy(new NextRequest("https://vantage.example/api/me"));
    expect(response.status).toBe(503);
    expect(state.noted).toEqual([{ error: state.sessionError, source: "sign-in check" }]);
  });

  it("does the same when the onboarding check can't reach the database", async () => {
    state.gateError = refused();
    const response = await proxy(new NextRequest("https://vantage.example/dashboard"));
    expect(response.headers.get("location")).toContain("/access-unavailable");
    expect(state.noted).toEqual([{ error: state.gateError, source: "sign-in check" }]);
  });

  it("reports nothing when the database answers", async () => {
    const response = await proxy(new NextRequest("https://vantage.example/api/me"));
    expect(response.status).not.toBe(503);
    expect(state.noted).toEqual([]);
  });
});
