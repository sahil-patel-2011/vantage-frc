import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), withRls: vi.fn() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: fake.session } },
  beginMfaEnrollment: vi.fn(), confirmMfaEnrollment: vi.fn(),
  regenerateRecoveryCodes: vi.fn(), revokeMfa: vi.fn(), verifyMfaStepUp: vi.fn(),
}));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("qrcode", () => ({ toDataURL: vi.fn() }));
vi.mock("../../../../lib/rate-limit", () => ({
  createRateLimiter: () => ({ allow: async () => true }),
  anonymizeIp: () => "test", clientIp: () => "test", rateLimitedResponse: vi.fn(),
}));

beforeEach(() => vi.resetAllMocks());

describe("account security access recovery", () => {
  it("returns private 401 for signed-out reads and mutations, before touching security data", async () => {
    fake.session.mockResolvedValue(null);
    const request = (method: string) => new Request("https://vantage.example/api/security/mfa", {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "begin" }),
    });
    for (const response of [await GET(), await POST(request("POST")), await DELETE(request("DELETE"))]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toEqual({ error: "Authentication required" });
    }
    expect(fake.withRls).not.toHaveBeenCalled();
  });

  it("keeps failed security reads private and does not expose database details", async () => {
    fake.session.mockResolvedValue({ user: { id: "member" }, session: { id: "session" } });
    fake.withRls.mockRejectedValue(Object.assign(new Error("relation private_table does not exist"), { code: "42P01" }));
    const response = await GET();
    expect(response.ok).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "Security settings unavailable" });
  });
});
