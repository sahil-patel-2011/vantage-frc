/**
 * Applying the forgot-to-sign-out sweep to `hour_logs`.
 *
 * The decision of what to close and how much to credit lives entirely in the pure `planAutoClose`;
 * this is only the write side, shared so that every "close the open sessions" entry point behaves
 * the same way. The Hours board's `close_all_open` used to do `clock_out = now()` on every open
 * row, which credits a student who scanned in at 6pm and forgot to scan out with eighteen hours —
 * exactly the fabricated attendance the sweep exists to prevent.
 *
 * Migration 0457 added `hour_logs.auto_closed` / `auto_closed_reason`. Where those columns are not
 * present yet the sweep still caps the credit; it just cannot flag the row. Degrading to "capped
 * but unflagged" is safe. Degrading to "credit the full elapsed time" would not be.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { cachedSchemaSupport } from "../schema-probe";
import {
  describeAutoClosePlan,
  normalizeAutoClosePolicy,
  planAutoClose,
  type AutoClosePlan,
  type OpenSession,
} from "./auto-close";

let flagColumnsCache: boolean | null = null;

/** Test seam: the capability probe is cached per process like the other schema probes. */
export function resetSweepCapabilityCache(): void {
  flagColumnsCache = null;
}

export async function supportsAutoCloseFlags(client: PoolClient): Promise<boolean> {
  return cachedSchemaSupport(
    client,
    {
      read: () => flagColumnsCache,
      write: (value) => {
        flagColumnsCache = value;
      },
    },
    `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'hour_logs'
         AND column_name = 'auto_closed'
       LIMIT 1`,
  );
}

async function readPolicy(client: PoolClient, orgId: string) {
  // No policy columns yet: the documented defaults, not a credit-nothing sweep.
  // The savepoint is what makes that promise true — the plain catch that used to
  // be here aborted the shared transaction, so every UPDATE the sweep went on to
  // issue failed and nothing was closed at all.
  return withSavepoint(
    client,
    async () => {
      const row = await client.query<{ afterHours: number | null; creditHours: number | null }>(
        `SELECT auto_close_after_hours::float8 AS "afterHours",
                auto_close_credit_hours::float8 AS "creditHours"
         FROM hour_policies WHERE org_id = $1::uuid`,
        [orgId],
      );
      return normalizeAutoClosePolicy({
        afterHours: row.rows[0]?.afterHours ?? null,
        creditHours: row.rows[0]?.creditHours ?? null,
      });
    },
    normalizeAutoClosePolicy({}),
  );
}

export type SweepResult = {
  /** Sessions capped by the policy because they were past the forgot-to-sign-out cutoff. */
  applied: number;
  /** Sessions closed at the mentor-attested end-of-meeting time. */
  attested: number;
  keptOpen: number;
  policy: AutoClosePlan["policy"];
  summary: string;
  closures: AutoClosePlan["closures"];
  flagged: boolean;
};

/**
 * Close the open sessions in this org.
 *
 * Two different things are happening here and they must not be conflated:
 *
 * - A session past the policy cutoff was *forgotten*. Nobody can attest to when that member left,
 *   so it is capped at the policy credit and flagged for mentor review.
 * - A session inside the cutoff, when a mentor pressed "end meeting", is *attested*. A human is
 *   asserting everyone left now, so it closes at `attestedCloseAt` with the real elapsed time.
 *
 * Without `attestedCloseAt` this is the unattended sweep: recent sessions are left open.
 *
 * `orgId` scopes the read and every write, so a sweep can never reach another team's rows.
 */
export async function sweepOpenSessions(
  client: PoolClient,
  input: { orgId: string; callerId: string; now?: number; attestedCloseAt?: Date | null },
): Promise<SweepResult> {
  const [policy, openRows, flagged] = await Promise.all([
    readPolicy(client, input.orgId),
    client.query<OpenSession>(
      `SELECT l.id, l.user_id AS "userId", u.name AS "userName", l.clock_in::text AS "clockIn"
       FROM hour_logs l
       JOIN users u ON u.id = l.user_id
       WHERE l.org_id = $1::uuid AND l.clock_out IS NULL`,
      [input.orgId],
    ),
    supportsAutoCloseFlags(client),
  ]);

  const plan = planAutoClose({
    sessions: openRows.rows,
    policy,
    now: input.now ?? Date.now(),
  });

  let applied = 0;
  for (const closure of plan.closures) {
    // hour_logs has CHECK (clock_out > clock_in); GREATEST keeps a zero-credit policy legal.
    const updated = flagged
      ? await client.query(
          `UPDATE hour_logs
           SET clock_out = GREATEST($3::timestamptz, clock_in + interval '1 minute'),
               closed_by = $4::uuid,
               auto_closed = true,
               auto_closed_reason = $5
           WHERE id = $1::uuid AND org_id = $2::uuid AND clock_out IS NULL`,
          [closure.id, input.orgId, closure.clockOut, input.callerId, closure.reason],
        )
      : await client.query(
          `UPDATE hour_logs
           SET clock_out = GREATEST($3::timestamptz, clock_in + interval '1 minute'),
               closed_by = $4::uuid,
               note = COALESCE(NULLIF(note, ''), $5)
           WHERE id = $1::uuid AND org_id = $2::uuid AND clock_out IS NULL`,
          [closure.id, input.orgId, closure.clockOut, input.callerId, closure.reason],
        );
    applied += updated.rowCount ?? 0;
  }

  let attested = 0;
  if (input.attestedCloseAt) {
    // Everything the sweep did not cap is closed at the attested time. Scoped to rows that are
    // still open so this cannot walk back a clock_out the sweep just capped.
    const closed = await client.query(
      `UPDATE hour_logs
       SET clock_out = GREATEST($2::timestamptz, clock_in + interval '1 minute'),
           closed_by = $3::uuid
       WHERE org_id = $1::uuid AND clock_out IS NULL`,
      [input.orgId, input.attestedCloseAt.toISOString(), input.callerId],
    );
    attested = closed.rowCount ?? 0;
  }

  return {
    applied,
    attested,
    keptOpen: input.attestedCloseAt ? 0 : plan.keptOpen,
    policy: plan.policy,
    summary: describeAutoClosePlan(plan),
    closures: plan.closures,
    flagged,
  };
}
