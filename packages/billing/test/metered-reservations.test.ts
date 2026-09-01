import type { PoolClient } from "@neondatabase/serverless";
import { CommitAndThrowError } from "@vantage/db";
import { describe, expect, it } from "vitest";
import {
  DuplicateMeteredRequestError,
  UsageHardCutoffError,
  authorizeMeteredAI,
  meteredAI,
  releaseMeteredAI,
  settleMeteredAI,
  type MeterKeySource,
  type MeteredAIInput,
} from "../src";

type Recorded = { sql: string; params: unknown[] };

function client(opts: {
  used?: number;
  reserved?: number;
  cap?: number;
  grants?: number;
  /** Models another authorize having already claimed this request id. */
  reservationConflict?: boolean;
}) {
  const queries: Recorded[] = [];
  const impl = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params: params ?? [] });
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ locked: true }], rowCount: 1 };
      }
      if (sql.includes("FROM org_billing")) {
        return {
          rows: [
            {
              tier: "team",
              credit_cap_usd: String(opts.cap ?? 100),
              kill_switch: false,
              period_start: new Date("2026-01-01"),
              period_end: new Date("2027-01-01"),
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("INSERT INTO ai_usage_reservations")) {
        return opts.reservationConflict
          ? { rows: [], rowCount: 0 }
          : { rows: [{ id: "reservation-1" }], rowCount: 1 };
      }
      if (sql.includes("COALESCE") && sql.includes("AS used")) {
        return {
          rows: [
            {
              used: String(opts.used ?? 0),
              reserved: String(opts.reserved ?? 0),
              grants: String(opts.grants ?? 0),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client: impl as unknown as PoolClient, queries };
}

function input(
  pool: PoolClient,
  overrides: Partial<MeteredAIInput<string>> = {},
): MeteredAIInput<string> {
  return {
    client: pool,
    orgId: "org-1",
    userId: "user-1",
    feature: "chat",
    requestId: "req-1",
    estimatedCostUsd: 1,
    invoke: async (keySource: MeterKeySource) => ({
      value: "ok",
      promptTokens: 10,
      completionTokens: 20,
      costUsd: 0.5,
      model: "m",
      provider: "p",
      keySource,
    }),
    ...overrides,
  };
}

const sqlOf = (queries: Recorded[], needle: string) =>
  queries.filter((q) => q.sql.includes(needle));

function unwrapCutoff(error: unknown): UsageHardCutoffError {
  if (error instanceof CommitAndThrowError && error.publicError instanceof UsageHardCutoffError) {
    return error.publicError;
  }
  if (error instanceof UsageHardCutoffError) return error;
  throw error;
}

describe("authorize/settle split", () => {
  it("does not reserve when the caller settles in the same transaction", async () => {
    const { client: pool, queries } = client({});
    await meteredAI(input(pool));
    // meteredAI is the unsplit path: adding a reservation write to every AI call in
    // the product would be pure overhead, since its advisory lock never released.
    expect(sqlOf(queries, "INSERT INTO ai_usage_reservations")).toHaveLength(0);
    expect(sqlOf(queries, "INSERT INTO ai_usage_events")).toHaveLength(1);
  });

  it("holds an estimate against caps when the phases are split", async () => {
    const { client: pool, queries } = client({});
    const auth = await authorizeMeteredAI(input(pool, { estimatedCostUsd: 2.5 }), {
      reserve: true,
    });

    expect(auth.reserved).toBe(true);
    expect(auth.keySource).toBe("platform");
    const [reservation] = sqlOf(queries, "INSERT INTO ai_usage_reservations");
    expect(reservation).toBeDefined();
    expect(reservation?.params).toContain("req-1");
    expect(reservation?.params).toContain(2.5);
    // Nothing was invoked or charged by authorize alone.
    expect(sqlOf(queries, "INSERT INTO ai_usage_events")).toHaveLength(0);
  });

  it("counts another caller's in-flight stream against the cap", async () => {
    // Committed usage is nil and the cap is $10, so on its own this call passes. The
    // only thing that should deny it is $12 of someone else's unsettled stream.
    const { client: pool } = client({ used: 0, reserved: 12, cap: 10 });
    const error = await authorizeMeteredAI(input(pool), { reserve: true }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(unwrapCutoff(error)).toBeInstanceOf(UsageHardCutoffError);
  });

  it("admits the same call once the in-flight holds are gone", async () => {
    const { client: pool } = client({ used: 0, reserved: 0, cap: 10 });
    const auth = await authorizeMeteredAI(input(pool), { reserve: true });
    expect(auth.keySource).toBe("platform");
  });

  it("rejects a retry that arrives while the first attempt is still streaming", async () => {
    // The advisory lock died when the first authorize committed, so the UNIQUE
    // request_id is the only thing standing between a retry and a double charge.
    const { client: pool } = client({ reservationConflict: true });
    await expect(authorizeMeteredAI(input(pool), { reserve: true })).rejects.toThrow(
      DuplicateMeteredRequestError,
    );
  });

  it("records usage and closes the hold at settle", async () => {
    const { client: pool, queries } = client({});
    const authorized = await authorizeMeteredAI(input(pool), { reserve: true });
    const value = await settleMeteredAI(input(pool), authorized, {
      value: "done",
      promptTokens: 10,
      completionTokens: 90,
      costUsd: 0.42,
      model: "m",
      provider: "p",
    });

    expect(value).toBe("done");
    const [usage] = sqlOf(queries, "INSERT INTO ai_usage_events");
    expect(usage?.params).toContain(0.42);
    const [closed] = sqlOf(queries, "SET settled_at = now()");
    expect(closed?.params).toEqual(["req-1"]);
  });

  it("leaves the hold alone when the caller never reserved", async () => {
    const { client: pool, queries } = client({});
    const authorized = await authorizeMeteredAI(input(pool));
    await settleMeteredAI(input(pool), authorized, {
      value: "done",
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0.01,
      model: "m",
      provider: "p",
    });
    expect(sqlOf(queries, "SET settled_at = now()")).toHaveLength(0);
  });

  it("releases a hold for a stream that died before its first token", async () => {
    const { client: pool, queries } = client({});
    await releaseMeteredAI(pool, "req-1", "relay_unreachable");
    const [released] = sqlOf(queries, "SET released_at = now()");
    expect(released?.params).toEqual(["req-1", "relay_unreachable"]);
    // Guarded so a release racing a settle cannot un-charge a call that was billed.
    expect(released?.sql).toContain("settled_at IS NULL");
  });

  it("claims the request id on the free local CLI path too", async () => {
    const { client: pool, queries } = client({});
    const authorized = await authorizeMeteredAI(
      input(pool, { keySource: "local_cli" }),
      { reserve: true },
    );
    expect(authorized.keySource).toBe("local_cli");
    expect(authorized.reserved).toBe(true);

    const [reservation] = sqlOf(queries, "INSERT INTO ai_usage_reservations");
    // A $0 path must be unreplayable without holding cap space it does not consume.
    expect(reservation?.params).toContain(0);

    await settleMeteredAI(input(pool, { keySource: "local_cli" }), authorized, {
      value: "done",
      promptTokens: 5,
      completionTokens: 5,
      costUsd: 0,
      model: "m",
      provider: "p",
    });
    expect(sqlOf(queries, "SET settled_at = now()")).toHaveLength(1);
  });

  it("expires holds rather than trusting a reaper to run", async () => {
    const { client: pool, queries } = client({});
    await authorizeMeteredAI(input(pool), { reserve: true, reservationTtlMs: 60_000 });
    const [reservation] = sqlOf(queries, "INSERT INTO ai_usage_reservations");
    expect(reservation?.params).toContain(60_000);
    expect(reservation?.sql).toContain("interval '1 millisecond'");
  });

  it("ignores expired holds when summing in-flight spend", async () => {
    const { client: pool, queries } = client({});
    await authorizeMeteredAI(input(pool), { reserve: true });
    const [totals] = sqlOf(queries, "AS used");
    expect(totals?.sql).toContain("expires_at > now()");
    expect(totals?.sql).toContain("settled_at IS NULL");
  });
});
