import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { IntelHttpError } from "../../../../../lib/intel-auth";

const fake = vi.hoisted(() => ({ session: vi.fn(), withIntelRequest: vi.fn(), query: vi.fn(), cookie: vi.fn(), email2faEnforced: vi.fn() }));
vi.mock("@vantage/core", () => ({ isEmail2faEnforced: fake.email2faEnforced }));
vi.mock("../../../../../lib/intel-auth", () => ({
  intelSession: fake.session, withIntelRequest: fake.withIntelRequest,
  IntelHttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
}));
vi.mock("../../../../../lib/cad/browser-pilot-access", () => ({
  isBrowserPilotOrgId: (value: unknown) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value),
  loadBrowserPilotAccess: async () => ({ allowed: true }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: fake.cookie }) }));
const orgId = "00000000-0000-4000-8000-000000000001";
const deviceId = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const request = (body: unknown = { orgId, deviceId }, origin = "https://vantage.example") => new Request(
  "https://vantage.example/api/cad/browser-agent/enroll",
  { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) },
);

beforeEach(() => {
  vi.resetAllMocks();
  fake.email2faEnforced.mockReturnValue(true);
  fake.session.mockResolvedValue({ user: { id: "actor" }, session: { id: sessionId } });
  fake.withIntelRequest.mockImplementation(async (_org, work) => work({ query: fake.query }));
  fake.query.mockResolvedValue({ rows: [{ approved: true }] });
});

describe("browser pilot session enrollment", () => {
  it("lists only same-user paired Onshape device summaries through the team guard", async () => {
    fake.query.mockResolvedValueOnce({ rows: [{ id: deviceId, name: "CAD laptop" }] });
    const response = await GET(new Request(`https://vantage.example/api/cad/browser-agent/enroll?orgId=${orgId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ devices: [{ id: deviceId, name: "CAD laptop" }] });
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("user_id=current_app_user_id()"), [orgId]);
    expect(fake.withIntelRequest).toHaveBeenCalledWith(orgId, expect.any(Function));
  });

  it("binds only the server session and hashes remembered MFA material", async () => {
    fake.cookie.mockReturnValueOnce({ value: "private-remembered-device-token" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const result = await response.json();
    expect(result.approved).toBe(true);
    expect(JSON.stringify(result)).not.toContain(sessionId);
    expect(fake.query).toHaveBeenCalledWith(
      "SELECT enroll_onshape_browser_pilot_device($1::uuid,$2::uuid,$3::uuid,$4,$5) AS approved",
      [deviceId, sessionId, orgId, createHash("sha256").update("private-remembered-device-token").digest("hex"), true],
    );
  });

  it("rejects cross-site approval and caller-selected sessions or users", async () => {
    expect((await POST(request(undefined, "https://other.example"))).status).toBe(403);
    expect((await POST(request({ orgId, deviceId, sessionId: "forged" }))).status).toBe(400);
    expect((await POST(request({ orgId, deviceId, userId: "someone-else" }))).status).toBe(400);
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("refuses missing sessions, policy failure, and unconfirmed enrollment", async () => {
    fake.session.mockRejectedValueOnce(new IntelHttpError(401, "Authentication required"));
    expect((await POST(request())).status).toBe(401);
    fake.withIntelRequest.mockRejectedValueOnce(new IntelHttpError(403, "Authenticator verification required"));
    expect((await POST(request())).status).toBe(403);
    expect(fake.query).not.toHaveBeenCalled();
    for (const rows of [[], [{ approved: false }]]) {
      fake.query.mockResolvedValueOnce({ rows });
      const response = await POST(request());
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ approved: false });
    }
  });

  it("hides a missing migration or other database failure", async () => {
    fake.query.mockRejectedValueOnce(new Error("private database schema details"));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("private database schema details");
  });
});
