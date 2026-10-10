import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { acknowledgeCoverageNudge, sendCoverageNudge, setThinThreshold } from "./compute-scout-coverage-live";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
const nudgeId = "22222222-2222-4222-8222-222222222222";
const eventKey = "2026txho";
const state = vi.hoisted(() => ({ lead: vi.fn() }));
vi.mock("@vantage/scouting/permissions", () => ({ assertScoutingLead: (...args: unknown[]) => state.lead(...args) }));
function clientFor(handler: (sql: string, params: unknown[]) => unknown[]) {
  const query = vi.fn(async (sql: string, params: unknown[] = []) => ({ rows: handler(sql, params) }));
  return { query, client: { query } as unknown as PoolClient };
}
beforeEach(() => { state.lead.mockReset(); state.lead.mockResolvedValue(undefined); });

describe("coverage review persisted outcomes", () => {
  it("refuses a stale target without overwriting the other lead's choice", async () => {
    const { client, query } = clientFor(sql => sql.startsWith("SELECT thin_threshold") ? [{ thinThreshold: 3 }] : []);
    await expect(setThinThreshold(client, { orgId, userId, thinThreshold: 2, expectedThreshold: 1 })).rejects.toMatchObject({ status: 409 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("treats the default as the first target baseline and locks before reading it", async () => {
    const { client, query } = clientFor(() => []);
    await setThinThreshold(client, { orgId, userId, thinThreshold: 2, expectedThreshold: 1 });
    expect(query.mock.calls[0]?.[0]).toContain("pg_advisory_xact_lock");
    expect(query.mock.calls.at(-1)?.[1]).toEqual([orgId, 2, userId]);
  });
  it("refuses target changes and flag acknowledgement when the lead capability was revoked", async () => {
    state.lead.mockRejectedValue(Object.assign(new Error("Scouting lead access required"), { status: 403 }));
    const { client, query } = clientFor(() => []);
    await expect(setThinThreshold(client, { orgId, userId, thinThreshold: 2, expectedThreshold: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(acknowledgeCoverageNudge(client, { orgId, userId, eventKey, nudgeId })).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });
  it("keeps the original outstanding flag on retry instead of inserting a duplicate", async () => {
    const { client, query } = clientFor(sql => sql.startsWith("SELECT id") ? [{ id: nudgeId }] : []);
    expect(await sendCoverageNudge(client, { orgId, userId, eventKey, matchKey: `${eventKey}_qm1`, teamKey: "frc6925", message: "Changed retry message" })).toEqual({ id: nudgeId, created: false });
    expect(query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
    expect(query.mock.calls[1]?.[1]).toEqual([orgId, eventKey, `${eventKey}_qm1`, "frc6925"]);
  });
  it("requires an inserted flag identity before reporting it saved", async () => {
    const { client } = clientFor(() => []);
    await expect(sendCoverageNudge(client, { orgId, userId, eventKey, matchKey: `${eventKey}_qm1`, teamKey: "frc6925", message: "Review" })).rejects.toThrow("could not be confirmed");
  });
  it("cannot acknowledge a flag in a different event", async () => {
    const { client, query } = clientFor(() => []);
    await expect(acknowledgeCoverageNudge(client, { orgId, userId, eventKey, nudgeId })).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls.at(-1)?.[1]).toEqual([userId, nudgeId, orgId, eventKey]);
    expect(query.mock.calls.at(-1)?.[0]).toContain("event_key=$4");
  });
  it("preserves the first review timestamp on retries", async () => {
    const acknowledgedAt = "2026-10-09 12:00:00+00";
    const { client, query } = clientFor(sql => sql.includes("UPDATE scout_coverage_live_nudges") ? [{ acknowledgedAt }] : []);
    expect(await acknowledgeCoverageNudge(client, { orgId, userId, eventKey, nudgeId })).toEqual({ acknowledgedAt });
    expect(query.mock.calls.at(-1)?.[0]).toContain("COALESCE(acknowledged_at,now())");
  });
});
