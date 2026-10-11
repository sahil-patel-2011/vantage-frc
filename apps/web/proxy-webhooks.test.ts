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

/**
 * Outage handling has to work while the database — and so every session — is down: the public
 * "limited" flag reads no database, and the outage console is authorized by the signed link in
 * the owner's alert email, which its routes verify themselves.
 */
describe("outage status and console reach their routes without a session", () => {
  for (const [method, path] of [
    ["GET", "/api/status"],
    ["GET", "/api/status/outage"],
    ["POST", "/api/status/outage/broadcast"],
    ["POST", "/api/status/outage/banner"],
    ["GET", "/status/outage?t=abc.def"],
  ] as const) {
    it(`${method} ${path.split("?")[0]}`, async () => {
      const request = method === "GET" ? new NextRequest(`https://vantage.example${path}`) : post(path);
      const response = await proxy(request);
      expect(response.status).not.toBe(401);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    });
  }

  it("keeps a lookalike API path gated", async () => {
    const response = await proxy(new NextRequest("https://vantage.example/api/statusboard"));
    expect(response.status).toBe(401);
  });

  it("keeps the rest of /status gated", async () => {
    const response = await proxy(new NextRequest("https://vantage.example/status/other"));
    expect(response.headers.get("x-middleware-next")).not.toBe("1");
  });
});
