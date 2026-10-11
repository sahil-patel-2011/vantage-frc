import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Webhooks arrive from GitHub, Stripe and The Blue Alliance with no session cookie. Each route
 * proves the sender itself (a signature over the raw body), so the proxy must let the request
 * through instead of answering 401 "Authentication required" before the route ever runs.
 */
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
  getOnboardingGate: vi.fn(),
  isEmail2faEnforced: () => false,
  sessionHasEmail2fa: () => true,
}));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, callback: (client: unknown) => Promise<unknown>) => callback({}) }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: () => null }));
vi.mock("./lib/media-availability", () => ({ MEDIA_ENABLED: true, MEDIA_PAUSED_MESSAGE: "", isPausedMediaRoute: () => false }));
vi.mock("./lib/products/products", () => ({ productRedirect: () => null, requestOrigin: () => "https://vantage.example" }));
vi.mock("./lib/google-sheets/oauth-state", () => ({ isGoogleSheetsState: () => false }));
vi.mock("./lib/provisioning/request-gate", () => ({ requestedProvisioningTeam: async () => null, pendingProvisioningTeam: async () => null }));

const { proxy } = await import("./proxy");

function post(path: string) {
  return new NextRequest(`https://vantage.example${path}`, { method: "POST", body: "{}" });
}

describe("signed webhooks reach their routes without a session", () => {
  for (const path of [
    "/api/github/webhook/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde",
    "/api/stripe/webhook",
    "/api/webhooks/tba",
  ]) {
    it(path.split("/").slice(0, 4).join("/"), async () => {
      const response = await proxy(post(path));
      expect(response.status).not.toBe(401);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  }

  it("still refuses a product API without a session", async () => {
    const response = await proxy(post("/api/github/pulls"));
    expect(response.status).toBe(401);
  });
});
