import { beforeEach, describe, expect, it } from "vitest";
import { resetSweepCapabilityCache, sweepOpenSessions } from "./sweep";

const NOW = Date.parse("2026-03-10T12:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const CALLER = "33333333-3333-4333-8333-333333333333";

function hoursAgo(hours: number): string {
  return new Date(NOW - hours * 3_600_000).toISOString();
}

type Call = { sql: string; params: unknown[] };

/**
 * Minimal PoolClient stub that answers by matching on the SQL text. Records every call so the
 * tests can assert org scoping and the exact clock_out written, without a database.
 */
function mockClient(options: {
  policy?: { afterHours: number | null; creditHours: number | null } | null;
  open?: Array<{ id: string; userId: string; userName: string | null; clockIn: string }>;
  flagsSupported?: boolean;
}) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return options.flagsSupported === false ? { rows: [], rowCount: 0 } : { rows: [{}], rowCount: 1 };
      }
      if (sql.includes("FROM hour_policies")) {
        const policy = options.policy;
        return policy ? { rows: [policy], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM hour_logs l")) {
        return { rows: options.open ?? [], rowCount: (options.open ?? []).length };
      }
      if (sql.startsWith("UPDATE hour_logs")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
  return { client, calls };
}

const updates = (calls: Call[]) => calls.filter((call) => call.sql.startsWith("UPDATE hour_logs"));

beforeEach(() => {
  resetSweepCapabilityCache();
});

describe("sweepOpenSessions", () => {
  it("leaves a session that is still inside the cutoff open", async () => {
    const { client, calls } = mockClient({
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(3) }],
    });
    const result = await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });
    expect(result.applied).toBe(0);
    expect(result.keptOpen).toBe(1);
    expect(updates(calls)).toHaveLength(0);
  });

  it("caps a forgotten 18-hour session at the policy credit instead of crediting all of it", async () => {
    const { client, calls } = mockClient({
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(18) }],
    });
    const result = await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });

    expect(result.applied).toBe(1);
    expect(result.closures[0]!.creditedHours).toBe(4);
    expect(result.closures[0]!.withheldHours).toBe(14);

    // The written clock_out must be clock_in + 4h, NOT now(). That difference is the whole point.
    const written = updates(calls)[0]!.params[2] as string;
    expect(Date.parse(written)).toBe(Date.parse(hoursAgo(18)) + 4 * 3_600_000);
    expect(Date.parse(written)).toBeLessThan(NOW);
  });

  it("flags the row for mentor review when the auto_closed columns exist", async () => {
    const { client, calls } = mockClient({
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(18) }],
    });
    const result = await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });
    expect(result.flagged).toBe(true);
    expect(updates(calls)[0]!.sql).toContain("auto_closed = true");
  });

  it("still caps the credit when the auto_closed columns are missing, only losing the flag", async () => {
    const { client, calls } = mockClient({
      flagsSupported: false,
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(18) }],
    });
    const result = await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });
    expect(result.flagged).toBe(false);
    expect(result.closures[0]!.creditedHours).toBe(4);
    const update = updates(calls)[0]!;
    expect(update.sql).not.toContain("auto_closed");
    expect(Date.parse(update.params[2] as string)).toBeLessThan(NOW);
  });

  it("scopes every write to the caller's org so a sweep cannot reach another team", async () => {
    const { client, calls } = mockClient({
      open: [
        { id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(18) },
        { id: "s2", userId: "u2", userName: "Grace", clockIn: hoursAgo(30) },
      ],
    });
    await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });

    for (const call of calls) {
      if (call.params.includes(OTHER_ORG)) throw new Error("sweep touched another org");
    }
    for (const update of updates(calls)) {
      expect(update.sql).toContain("org_id = $2::uuid");
      expect(update.params[1]).toBe(ORG);
    }
    const read = calls.find((call) => call.sql.includes("FROM hour_logs l"))!;
    expect(read.sql).toContain("l.org_id = $1::uuid");
    expect(read.params[0]).toBe(ORG);
  });

  it("honours a team's own policy over the defaults", async () => {
    const { client } = mockClient({
      policy: { afterHours: 2, creditHours: 1 },
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(5) }],
    });
    const result = await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });
    expect(result.policy).toEqual({ afterHours: 2, creditHours: 1 });
    expect(result.closures[0]!.creditedHours).toBe(1);
  });

  it("falls back to the documented defaults when the team has no policy row", async () => {
    const { client } = mockClient({ policy: null, open: [] });
    const result = await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });
    expect(result.policy).toEqual({ afterHours: 12, creditHours: 4 });
  });

  it("reports a readable summary when nothing needed sweeping", async () => {
    const { client } = mockClient({ open: [] });
    const result = await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW });
    expect(result.applied).toBe(0);
    expect(result.summary).toContain("No forgotten sessions");
  });
});

describe("sweepOpenSessions with an attested end-of-meeting time", () => {
  const attestedCloseAt = new Date(NOW);

  it("closes a current session at the attested time with its real elapsed hours", async () => {
    const { client, calls } = mockClient({
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(3) }],
    });
    const result = await sweepOpenSessions(client, {
      orgId: ORG,
      callerId: CALLER,
      now: NOW,
      attestedCloseAt,
    });

    expect(result.applied).toBe(0);
    expect(result.attested).toBe(1);
    expect(result.keptOpen).toBe(0);

    // The blanket close takes (orgId, closeAt, callerId); the per-row cap takes five.
    const attestedUpdate = updates(calls).find((call) => call.params.length === 3);
    expect(attestedUpdate).toBeDefined();
    expect(attestedUpdate!.params[1]).toBe(attestedCloseAt.toISOString());
  });

  it("still caps a session forgotten from a previous day rather than crediting it to this meeting", async () => {
    const { client, calls } = mockClient({
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(18) }],
    });
    const result = await sweepOpenSessions(client, {
      orgId: ORG,
      callerId: CALLER,
      now: NOW,
      attestedCloseAt,
    });

    expect(result.applied).toBe(1);
    expect(result.closures[0]!.creditedHours).toBe(4);

    // The per-row cap runs before the blanket close, and the blanket close only touches rows that
    // are still open — so the capped clock_out is never walked forward to the attested time.
    const capped = updates(calls)[0]!;
    expect(capped.params[0]).toBe("s1");
    expect(Date.parse(capped.params[2] as string)).toBeLessThan(NOW);
  });

  it("scopes the attested close to the caller's org", async () => {
    const { client, calls } = mockClient({
      open: [{ id: "s1", userId: "u1", userName: "Ada", clockIn: hoursAgo(2) }],
    });
    await sweepOpenSessions(client, { orgId: ORG, callerId: CALLER, now: NOW, attestedCloseAt });
    for (const update of updates(calls)) {
      expect(update.params).toContain(ORG);
      expect(update.params).not.toContain(OTHER_ORG);
    }
  });
});
