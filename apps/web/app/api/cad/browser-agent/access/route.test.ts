import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { GET, POST } from "./route";
import { IntelHttpError } from "../../../../../lib/intel-auth";

const fake = vi.hoisted(() => ({ withIntelRequest: vi.fn(), query: vi.fn(), relayQuery: vi.fn(), email2faEnforced: vi.fn() }));
vi.mock("@vantage/core", () => ({ isEmail2faEnforced: fake.email2faEnforced }));
vi.mock("@vantage/db/cad-relay", () => ({ getCadRelayPool: () => ({ query: fake.relayQuery }) }));
vi.mock("../../../../../lib/intel-auth", () => ({
  withIntelRequest: fake.withIntelRequest,
  IntelHttpError: class extends Error { constructor(readonly status: number, message: string) { super(message); } },
}));
const orgId = "00000000-0000-4000-8000-000000000001";
const request = (value = orgId) => new Request(`https://vantage.example/api/cad/browser-agent/access?orgId=${value}`);

beforeEach(() => {
  vi.resetAllMocks();
  fake.email2faEnforced.mockReturnValue(false);
  vi.stubEnv("VANTAGE_ONSHAPE_BROWSER_PILOT_ORG_ID", orgId);
  fake.withIntelRequest.mockImplementation(async (_org, work) => work({ query: fake.query }));
  fake.query.mockResolvedValue({ rows: [{ teamNumber: 6925 }] });
});

describe("paired Onshape browser pilot device access", () => {
  const token = "a".repeat(43);
  const deviceRequest = (authorization = `Bearer ${token}`) => new Request(
    "https://vantage.example/api/cad/browser-agent/access?orgId=caller-chosen-org",
    { method: "POST", headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ orgId: "caller-chosen-org", userId: "someone-else" }) },
  );

  it("uses only the hashed device credential and server-bound org, never caller identity", async () => {
    fake.relayQuery.mockResolvedValueOnce({ rows: [{ allowed: true, status: "eligible", reason: "pilot_member" }] });
    const response = await POST(deviceRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ allowed: true, status: "eligible", transport: "onshape_browser_ui" });
    expect(fake.relayQuery).toHaveBeenCalledWith(
      "SELECT allowed, status, reason FROM check_onshape_browser_pilot_device($1, $2::uuid, $3)",
      [createHash("sha256").update(token).digest("hex"), orgId, false],
    );
    expect(fake.withIntelRequest).not.toHaveBeenCalled();
  });

  it("passes current global email second-factor enforcement on every device request", async () => {
    fake.email2faEnforced.mockReturnValue(true);
    fake.relayQuery.mockResolvedValueOnce({ rows: [{ allowed: false, status: "denied", reason: "team_sign_in_required" }] });
    expect((await POST(deviceRequest())).status).toBe(403);
    expect(fake.relayQuery).toHaveBeenCalledWith(expect.any(String), [expect.any(String), orgId, true]);
  });

  it("requires an actual Bearer credential before any database access", async () => {
    for (const authorization of ["", token, `Basic ${token}`, "Bearer too-short", `Bearer ${token} extra`]) {
      expect((await POST(deviceRequest(authorization))).status).toBe(401);
    }
    expect(fake.relayQuery).not.toHaveBeenCalled();
  });

  it("fails closed for revoked/wrong-platform devices, departure, MFA and method restrictions", async () => {
    for (const [reason, status] of [["device_invalid", 401], ["pilot_membership_required", 403], ["team_sign_in_required", 403]] as const) {
      fake.relayQuery.mockResolvedValueOnce({ rows: [{ allowed: false, status: "denied", reason }] });
      const response = await POST(deviceRequest());
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.json()).toMatchObject({ allowed: false, reason });
    }
  });

  it("does not interpret missing, malformed or unavailable authorization as success", async () => {
    for (const rows of [[], [{ allowed: true, status: "denied", reason: "pilot_member" }]]) {
      fake.relayQuery.mockResolvedValueOnce({ rows });
      const response = await POST(deviceRequest());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ allowed: false, status: "unavailable" });
    }
    fake.relayQuery.mockRejectedValueOnce(new Error("private database failure"));
    const failed = await POST(deviceRequest());
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private database failure");
    vi.stubEnv("VANTAGE_ONSHAPE_BROWSER_PILOT_ORG_ID", "");
    const setup = await POST(deviceRequest());
    expect(setup.status).toBe(503);
    expect(await setup.json()).toMatchObject({ allowed: false, status: "setup_required" });
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("Onshape browser pilot access route", () => {
  it("checks the session/team MFA guard and returns private eligibility only", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fake.withIntelRequest).toHaveBeenCalledWith(orgId, expect.any(Function));
    const result = await response.json();
    expect(result).toMatchObject({ allowed: true, status: "eligible", transport: "onshape_browser_ui" });
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("orgId");
  });

  it("rejects malformed team identifiers before querying", async () => {
    const response = await GET(request("6925"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fake.query).not.toHaveBeenCalled();
  });

  it("denies signed-out, departed, and MFA-denied sessions without exposing internal errors", async () => {
    for (const status of [401, 403]) {
      fake.withIntelRequest.mockRejectedValueOnce(new IntelHttpError(status, "private policy details"));
      const response = await GET(request());
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.text()).not.toContain("private policy details");
    }
    expect(fake.query).not.toHaveBeenCalled();
    fake.query.mockResolvedValueOnce({ rows: [] });
    expect((await GET(request())).status).toBe(403);
  });

  it("refuses a self-claimed 6925 organization and absent pilot configuration", async () => {
    expect((await GET(request("00000000-0000-4000-8000-000000000002"))).status).toBe(403);
    vi.stubEnv("VANTAGE_ONSHAPE_BROWSER_PILOT_ORG_ID", "");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ allowed: false, status: "setup_required" });
  });

  it("fails closed and hides database details when authorization cannot be checked", async () => {
    fake.query.mockRejectedValueOnce(new Error("private database connection detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      allowed: false, status: "unavailable", error: "Pilot access could not be verified. Try again.",
    });
  });
});
