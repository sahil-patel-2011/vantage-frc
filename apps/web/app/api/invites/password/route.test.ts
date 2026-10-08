import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), accounts: vi.fn(), password: vi.fn(), peek: vi.fn(), withRls: vi.fn(), allow: vi.fn() }));
vi.mock("@vantage/core", () => ({
  auth: { api: { getSession: fake.session, listUserAccounts: fake.accounts, setPassword: fake.password } },
  isInviteTokenShape: (token: string) => token === "valid-token",
  peekOrganizationInvite: fake.peek,
}));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../../../../lib/rate-limit", () => ({
  createRateLimiter: () => ({ allow: fake.allow }),
  rateLimitedResponse: (error: string) => Response.json({ error }, { status: 429 }),
}));

const request = (headers: Record<string, string> = {}, password = "a-long-test-password") => new Request("https://vantage.example/api/invites/password", {
  method: "POST", headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify({ token: "valid-token", password }),
});

beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "member-1", email: "scout@example.com", emailVerified: true } });
  fake.withRls.mockImplementation(async (_scope, callback) => callback({}));
  fake.peek.mockResolvedValue({ email: "scout@example.com", status: "pending", expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
  fake.accounts.mockResolvedValue([]);
  fake.allow.mockResolvedValue(true);
  fake.password.mockResolvedValue({ status: true });
});

describe("invitation password setup", () => {
  it("requires a signed-in, verified recipient", async () => {
    fake.session.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    fake.session.mockResolvedValueOnce({ user: { id: "member-1", email: "scout@example.com", emailVerified: false } });
    expect((await POST(request())).status).toBe(403);
    expect(fake.password).not.toHaveBeenCalled();
  });
  it("rejects cross-site writes and short passwords before reading the invite", async () => {
    expect((await POST(request({ origin: "https://other.example" }))).status).toBe(403);
    expect((await POST(request({}, "short"))).status).toBe(400);
    expect(fake.peek).not.toHaveBeenCalled();
  });
  it("rejects another person's invite, revoked links and expired links", async () => {
    fake.peek.mockResolvedValueOnce({ email: "another@example.com", status: "pending", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await POST(request())).status).toBe(403);
    for (const status of ["revoked", "accepted", "expired"]) {
      fake.peek.mockResolvedValueOnce({ email: "scout@example.com", status, expiresAt: new Date(Date.now() + 60_000).toISOString() });
      expect((await POST(request())).status).toBe(410);
    }
    fake.peek.mockResolvedValueOnce({ email: "scout@example.com", status: "pending", expiresAt: new Date(Date.now() - 1).toISOString() });
    expect((await POST(request())).status).toBe(410);
    expect(fake.password).not.toHaveBeenCalled();
  });
  it("preserves an existing password on retries", async () => {
    fake.accounts.mockResolvedValue([{ providerId: "credential" }]);
    expect(await (await POST(request())).json()).toEqual({ passwordSet: true, alreadySet: true });
    expect(fake.password).not.toHaveBeenCalled();
  });
  it("sets a password through the auth provider and keeps responses private", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fake.password).toHaveBeenCalledWith({ headers: expect.any(Headers), body: { newPassword: "a-long-test-password" } });
  });
  it("does not claim success when the auth provider fails", async () => {
    fake.password.mockRejectedValue(new Error("private provider error"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider error");
  });
  it("limits repeated credential attempts without touching credentials", async () => {
    fake.allow.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(429);
    expect(fake.password).not.toHaveBeenCalled();
  });
});
