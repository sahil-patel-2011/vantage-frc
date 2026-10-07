import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fake = vi.hoisted(() => ({ session: vi.fn(), withRls: vi.fn(), query: vi.fn(), allow: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } } }));
vi.mock("@vantage/db", () => ({ withRls: fake.withRls }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("../../../../lib/rate-limit", () => ({ createRateLimiter: () => ({ allow: fake.allow }),
  rateLimitedResponse: (error: string) => Response.json({ error }, { status: 429 }) }));
const orgId = "186677b7-122c-4d11-9978-a2845d3df048";
const request = (body: unknown = { orgId }, extraHeaders: Record<string, string> = {}) => new Request("https://vantage.example/api/organizations/leave", {
  method: "POST", headers: { "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "actor" } });
  fake.allow.mockResolvedValue(true);
  fake.withRls.mockImplementation(async (_scope, work) => work({ query: fake.query }));
  fake.query.mockResolvedValue({ rows: [{ outcome: "left" }] });
});
describe("self-service team departure", () => {
  it("requires authentication and rejects another user's ID or cross-site mutation", async () => {
    fake.session.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request({ orgId, userId: "someone-else" }))).status).toBe(400);
    expect((await POST(request({ orgId }, { origin: "https://other.example" }))).status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
  });
  it("uses the session actor and acknowledges repeat departures privately", async () => {
    for (const outcome of ["left", "already_left"]) {
      fake.query.mockResolvedValueOnce({ rows: [{ outcome }] });
      const response = await POST(request());
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({ left: true, orgId, alreadyLeft: outcome === "already_left" });
    }
    expect(fake.withRls).toHaveBeenCalledWith({ userId: "actor", orgId }, expect.any(Function));
    expect(fake.query).toHaveBeenCalledWith("SELECT public.leave_my_team($1::uuid) AS outcome", [orgId]);
  });
  it("shows an ownership or last-administrator correction without claiming a departure", async () => {
    for (const outcome of ["owner_required", "last_admin"]) {
      fake.query.mockResolvedValueOnce({ rows: [{ outcome }] });
      const response = await POST(request());
      expect(response.status).toBe(409);
      expect(await response.json()).not.toHaveProperty("left");
    }
  });
  it("limits retries and hides database failures", async () => {
    fake.allow.mockResolvedValueOnce(false);
    expect((await POST(request())).status).toBe(429);
    expect(fake.query).not.toHaveBeenCalled();
    fake.query.mockRejectedValueOnce(new Error("private database details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database details");
  });
});
