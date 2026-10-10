import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const fake = vi.hoisted(() => ({ query: vi.fn(), session: vi.fn(), policy: vi.fn() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: fake.session } }, assertOrgAuthentication: fake.policy }));
vi.mock("@vantage/db", () => ({ withRls: async (_scope: unknown, work: (client: unknown) => Promise<unknown>) => work({ query: fake.query }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventKey = "2026txho";
const request = () => new Request(`https://vantage.example/api/scouting/reconcile?orgId=${orgId}&eventKey=${eventKey}`);
beforeEach(() => {
  vi.resetAllMocks();
  fake.session.mockResolvedValue({ user: { id: "11111111-1111-4111-8111-111111111111" }, session: { id: "session" } });
  fake.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM memberships")) return { rows: [{}], rowCount: 1 };
    if (sql.includes("FROM org_active_context")) return { rows: [{ eventKey }], rowCount: 1 };
    if (sql.includes("FROM matches_ref")) return { rows: Array.from({ length: 45 }, (_, index) => ({ matchKey: `${eventKey}_qm${index + 1}`, matchNumber: index + 1, compLevel: "qm", redAlliance: { teamKeys: ["frc1", "frc2", "frc3"], score: 30 }, blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"], score: 20 } })), rowCount: 45 };
    return { rows: [], rowCount: 0 };
  });
});
describe("alliance review endpoint", () => {
  it("returns the whole scoped event so Show more can reach matches after the old forty-row limit", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const view = await response.json();
    expect(view).toMatchObject({ status: "live", orgId, eventKey, truncated: false, summary: { matches: 45 } });
    expect(view.matches).toHaveLength(45);
    expect(fake.query).toHaveBeenCalledWith(expect.stringContaining("e.org_id = $1::uuid AND e.event_key = $2::text"), [orgId, eventKey]);
  });
  it("returns a private outage instead of a successful empty setup", async () => {
    fake.query.mockRejectedValue(new Error("private database detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toContain("private database");
  });
  it("preserves policy denials for sign-in recovery", async () => {
    fake.policy.mockRejectedValue(Object.assign(new Error("Authenticator verification required"), { code: "mfa_step_up_required" }));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("FROM matches_ref"))).toBe(false);
  });
});
