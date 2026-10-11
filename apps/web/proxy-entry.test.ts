/** QA A1-27, A1-29, A1-P5: public aliases and the signed-out API answer. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";
import { SIGNED_OUT_MESSAGE } from "./lib/security/signed-out";

const fake = vi.hoisted(() => ({ session: vi.fn(), gate: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, getOnboardingGate: fake.gate, isEmail2faEnforced: () => false, sessionHasEmail2fa: () => true }));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, callback: (client: unknown) => Promise<unknown>) => callback({}) }));
vi.mock("better-auth/cookies", () => ({ getSessionCookie: () => "session" }));
vi.mock("./lib/media-availability", () => ({ MEDIA_ENABLED: true, MEDIA_PAUSED_MESSAGE: "", isPausedMediaRoute: () => false }));
vi.mock("./lib/products/products", () => ({ productRedirect: () => null, requestOrigin: () => "https://vantage.example" }));
vi.mock("./lib/google-sheets/oauth-state", () => ({ isGoogleSheetsState: () => false }));
vi.mock("./lib/provisioning/request-gate", () => ({ requestedProvisioningTeam: async () => null, pendingProvisioningTeam: async () => null }));

const request = (path: string) => new NextRequest(`https://vantage.example${path}`);

beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue(null);
});

describe("public aliases", () => {
  it("sends /contact to a page with the address written out, not a mailto: link", async () => {
    const response = await proxy(request("/contact"));
    expect(response.status).toBe(308);
    const location = response.headers.get("location") ?? "";
    expect(location).not.toMatch(/^mailto:/);
    expect(new URL(location).pathname).toBe("/");
    expect(new URL(location).hash).toBe("#contact");
  });

  it("lets the page's own name, Cost, be typed as an address", async () => {
    const response = await proxy(request("/cost"));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/pricing");
  });
});

describe("a signed-out API request", () => {
  it("answers with the same sentence the routes use", async () => {
    const response = await proxy(request("/api/me"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: SIGNED_OUT_MESSAGE });
  });
});
