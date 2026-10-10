import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoutCoverageLiveView } from "./compute-scout-coverage-live";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
const nudgeId = "22222222-2222-4222-8222-222222222222";
const eventKey = "2026txho";
const state = vi.hoisted(() => ({ session: null as unknown, compute: vi.fn(), access: vi.fn(), target: vi.fn(), flag: vi.fn(), acknowledge: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@vantage/core", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@vantage/db", () => ({ withRls: async (_context: unknown, work: (client: unknown) => Promise<unknown>) => work({}) }));
vi.mock("../scouting/coverage-access", () => ({ assertCoverageSession: (...args: unknown[]) => state.access(...args) }));
vi.mock("./compute-scout-coverage-live", () => ({
  computeScoutCoverageLiveView: (...args: unknown[]) => state.compute(...args),
  setThinThreshold: (...args: unknown[]) => state.target(...args),
  sendCoverageNudge: (...args: unknown[]) => state.flag(...args),
  acknowledgeCoverageNudge: (...args: unknown[]) => state.acknowledge(...args),
}));
const { GET, POST } = await import("../../app/api/scout-coverage-live/route");
const { RequestSecurityError } = await import("../security/request");
function live(overrides: Partial<Extract<ScoutCoverageLiveView, { status: "live" }>> = {}): Extract<ScoutCoverageLiveView, { status: "live" }> {
  return { status: "live", orgId, eventKey, teamNumber: 6925, eventName: "Houston", thinThreshold: 1, canManage: false,
    computedAt: "2026-10-09T12:00:00Z", cells: [{ matchKey: `${eventKey}_qm1`, matchLabel: "Qual 1", compLevel: "qm", matchNumber: 1, teamKey: "frc6925", teamNumber: 6925, alliance: "red", entryCount: 0, status: "zero", played: true }],
    gaps: [], nudges: [], summary: { totalCells: 1, zeroCount: 1, thinCount: 0, coveredCount: 0, coveragePct: 0 }, ...overrides };
}
function request(body: unknown, origin = "https://vantage.example") {
  return new Request("https://vantage.example/api/scout-coverage-live", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
}
const flag = () => ({ orgId, eventKey, action: "send-nudge", matchKey: `${eventKey}_qm1`, teamKey: "frc6925", message: "Please review" });
beforeEach(() => {
  for (const fn of [state.compute, state.access, state.target, state.flag, state.acknowledge]) fn.mockReset();
  state.session = { user: { id: userId }, session: { id: "current-session" } };
  state.access.mockResolvedValue(undefined); state.compute.mockResolvedValue(live());
  state.flag.mockResolvedValue({ id: nudgeId, created: true });
  state.acknowledge.mockResolvedValue({ acknowledgedAt: "2026-10-09 12:00:00+00" });
});

describe("coverage review authenticated route", () => {
  it("keeps signed-out and wrong-origin requests away from data writes", async () => {
    state.session = null;
    expect((await GET(new Request(`https://vantage.example/api/scout-coverage-live?orgId=${orgId}`))).status).toBe(401);
    expect((await POST(request(flag()))).status).toBe(401);
    state.session = { user: { id: userId }, session: { id: "session" } };
    expect((await POST(request(flag(), "https://other.example"))).status).toBe(403);
    expect(state.compute).not.toHaveBeenCalled(); expect(state.flag).not.toHaveBeenCalled();
  });
  it("enforces current membership and team sign-in policy on reads and writes", async () => {
    state.access.mockRejectedValue(new RequestSecurityError(403, "Authenticator verification required"));
    const read = await GET(new Request(`https://vantage.example/api/scout-coverage-live?orgId=${orgId}`));
    expect(read.status).toBe(403); expect(read.headers.get("cache-control")).toContain("no-store");
    expect((await POST(request(flag()))).status).toBe(403);
    expect(state.compute).not.toHaveBeenCalled();
  });
  it("does not turn a temporary database outage into an empty setup page", async () => {
    state.compute.mockRejectedValue(new Error("connection lost"));
    const response = await GET(new Request(`https://vantage.example/api/scout-coverage-live?orgId=${orgId}`));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("status", "setup_required");
  });
  it("lets a scout flag a scheduled missing observation with an explicit confirmed identity", async () => {
    const response = await POST(request(flag()));
    expect(response.status).toBe(200);
    expect((await response.json()).coverageResult).toEqual({ action: "send-nudge", nudgeId, created: true, matchKey: `${eventKey}_qm1`, teamKey: "frc6925" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("refuses cross-event, unscheduled robot and now-covered flags", async () => {
    expect((await POST(request({ ...flag(), eventKey: "2026other" }))).status).toBe(409);
    expect((await POST(request({ ...flag(), teamKey: "frc254" }))).status).toBe(400);
    state.compute.mockResolvedValue(live({ cells: [{ ...live().cells[0]!, status: "covered", entryCount: 1 }] }));
    expect((await POST(request(flag()))).status).toBe(409);
    state.compute.mockResolvedValue(live({ cells: [{ ...live().cells[0]!, played: false, assignmentCount: 1 }] }));
    expect((await POST(request(flag()))).status).toBe(409);
    expect(state.flag).not.toHaveBeenCalled();
  });
  it("refuses a lead-only change even if the browser displays old lead controls", async () => {
    state.target.mockRejectedValue(Object.assign(new Error("Scouting lead access required"), { status: 403 }));
    state.acknowledge.mockRejectedValue(Object.assign(new Error("Scouting lead access required"), { status: 403 }));
    expect((await POST(request({ orgId, eventKey, action: "set-threshold", thinThreshold: 2, expectedThreshold: 1 }))).status).toBe(403);
    expect((await POST(request({ orgId, eventKey, action: "acknowledge-nudge", nudgeId }))).status).toBe(403);
  });
  it("asks older clients to refresh instead of overwriting a target without its baseline", async () => {
    const response = await POST(request({ orgId, eventKey, action: "set-threshold", thinThreshold: 2 }));
    expect(response.status).toBe(409); expect((await response.json()).error).toMatch(/Refresh/);
    expect(state.target).not.toHaveBeenCalled();
  });
  it("requires the follow-up view to show the saved target before reporting success", async () => {
    const response = await POST(request({ orgId, eventKey, action: "set-threshold", thinThreshold: 2, expectedThreshold: 1 }));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("coverageResult");
  });
});
