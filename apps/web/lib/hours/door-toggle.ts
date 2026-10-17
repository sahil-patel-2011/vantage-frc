import type { PoolClient } from "@neondatabase/serverless";
import { DOOR_WINDOW_MS } from "./door-code";

export type DoorToggle = {
  state: "in" | "out";
  clockIn: string;
  clockOut: string | null;
  /** True when this scan repeated one that already moved the member (nothing changed). */
  repeat: boolean;
};

/**
 * Check the member in, or out if they were in — at most once per door code. The same code can be
 * opened twice (a scanner that opens links twice, a reload, a retry after the first request
 * already landed), so a scan whose code is older than the member's last clock change answers
 * with where they are now instead of toggling them straight back. The advisory lock makes two
 * scans in flight at once take turns, so they can't both open a row.
 */
export async function toggleDoorCheckin(
  client: PoolClient,
  input: { orgId: string; userId: string; codeWindow: number },
): Promise<DoorToggle> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `door-checkin:${input.orgId.toLowerCase()}:${input.userId}`,
  ]);
  const last = await client.query<{ clockIn: string; clockOut: string | null; spent: boolean }>(
    `SELECT clock_in::text AS "clockIn", clock_out::text AS "clockOut",
            COALESCE(clock_out, clock_in) >= to_timestamp($3::double precision) AS spent
       FROM hour_logs
      WHERE org_id = $1::uuid AND user_id = $2::uuid
      ORDER BY clock_in DESC
      LIMIT 1`,
    [input.orgId, input.userId, (input.codeWindow * DOOR_WINDOW_MS) / 1000],
  );
  const latest = last.rows[0];
  if (latest?.spent) {
    return { state: latest.clockOut ? "out" : "in", clockIn: latest.clockIn, clockOut: latest.clockOut, repeat: true };
  }
  const closed = await client.query<{ clockIn: string; clockOut: string }>(
    `UPDATE hour_logs SET clock_out = now(), closed_by = $2::uuid
      WHERE org_id = $1::uuid AND user_id = $2::uuid AND clock_out IS NULL
      RETURNING clock_in::text AS "clockIn", clock_out::text AS "clockOut"`,
    [input.orgId, input.userId],
  );
  if (closed.rows[0]) return { state: "out", clockIn: closed.rows[0].clockIn, clockOut: closed.rows[0].clockOut, repeat: false };
  const opened = await client.query<{ clockIn: string }>(
    `INSERT INTO hour_logs (org_id, user_id, kind, note, created_by)
     VALUES ($1::uuid, $2::uuid, 'build', 'Door check-in', $2::uuid)
     RETURNING clock_in::text AS "clockIn"`,
    [input.orgId, input.userId],
  );
  return { state: "in", clockIn: opened.rows[0]!.clockIn, clockOut: null, repeat: false };
}
