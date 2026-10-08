import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const fake = vi.hoisted(() => ({ getSession: vi.fn(), getSessionCookie: vi.fn(), withRls: vi.fn(), emailVerified: vi.fn() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: fake.getSession } },
  getOnboardingGate: vi.fn(), isEmail2faEnforced: () => true,
  sessionHasEmail2fa: fake.emailVerified,
}));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: fake.getSessionCookie }));
vi.mock("./lib/products/products", () => ({ productRedirect: () => null, requestOrigin: () => "https://vantagefrc.vercel.app" }));
vi.mock("./lib/media-availability", () => ({ isPausedMediaRoute: () => false, MEDIA_ENABLED: false, MEDIA_PAUSED_MESSAGE: "Media paused" }));
vi.mock("./lib/google-sheets/oauth-state", () => ({ isGoogleSheetsState: () => false }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("E2E_AUTH_FIXTURE", "0");
  fake.getSessionCookie.mockReturnValue(null);
});
afterEach(() => vi.unstubAllEnvs());

const request = (path: string, method: string) => new NextRequest(`https://vantagefrc.vercel.app${path}`, {
  method, headers: { authorization: `Bearer ${"a".repeat(43)}` },
});

describe("browser pilot device authentication boundary in proxy", () => {
  it("lets the exact POST reach its own bearer/membership/MFA handler without a cookie", async () => {
    const response = await proxy(request("/api/cad/browser-agent/access", "POST"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fake.getSession).not.toHaveBeenCalled();
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("keeps GET, enrollment and neighboring routes session protected", async () => {
    for (const [path, method] of [
      ["/api/cad/browser-agent/access", "GET"],
      ["/api/cad/browser-agent/access", "PATCH"],
      ["/api/cad/browser-agent/enroll", "POST"],
      ["/api/cad/browser-agent/access/child", "POST"],
      ["/api/cad/browser-agent/access-other", "POST"],
    ]) {
      const response = await proxy(request(path!, method!));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Authentication required" });
    }
  });

  it("still enforces browser email verification on access GET and enrollment POST", async () => {
    fake.getSessionCookie.mockReturnValue("session-token");
    fake.getSession.mockResolvedValue({ user: { id: "member" }, session: { id: "session" } });
    fake.emailVerified.mockReturnValue(false);
    for (const [path, method] of [["/api/cad/browser-agent/access", "GET"], ["/api/cad/browser-agent/enroll", "POST"]]) {
      const response = await proxy(request(path!, method!));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "email_verification_required" });
    }
    expect(fake.withRls).not.toHaveBeenCalled();
  });
});
