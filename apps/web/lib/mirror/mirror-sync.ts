/**
 * Postgres → Google Sheets AND Excel, as one sync.
 *
 * Postgres is the source of truth; the two spreadsheets are identical copies of it. One
 * read of Postgres and one build of the tables feed both copies, so they cannot drift
 * because of timing. Each copy is then written on its own:
 *
 *   - One copy failing never stops the other. If Microsoft is down, Google still updates,
 *     and the reverse.
 *   - A copy whose provider asked Vantage to back off (HTTP 429 / quota) is marked
 *     `throttled_until` and skipped until then — the other copy carries the load, and the
 *     skipped one is rewritten in full on the next sync, so nothing is lost.
 *   - A copy is only stamped with the content hash when every table landed. Two copies
 *     with the same stamp hold the same data; a copy without it is "catching up".
 *
 * Runs inside the caller's withRls transaction, under the same per-team advisory lock as
 * the Excel-only sync and the import, so two writers never interleave on one team's copies.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { BuiltTable } from "../microsoft/workbook-schema";
import { buildWorkbookTables } from "../microsoft/workbook-schema";
import { type TableOutcome, type WorkbookTarget, loadWorkbookSource, summarizeOutcomes } from "../microsoft/workbook-sync";
import { type MirrorCopy, contentHash, withMirrorInfo } from "./mirror-hash";

/** How long a copy rests after a throttle with no Retry-After. */
export const DEFAULT_THROTTLE_MS = 10 * 60_000;
export const MAX_THROTTLE_MS = 60 * 60_000;

export type MirrorTargetDef = {
  copy: MirrorCopy;
  /** Connect, refresh the sign-in, open (or create) the file. */
  open: () => Promise<WorkbookTarget>;
  /** Plain words for an error from this provider. */
  describe: (error: unknown) => string;
  /** The sign-in is gone: every later call to this provider fails the same way. */
  isFatal: (error: unknown) => boolean;
  /** Provider asked to slow down: how long to rest (ms), or null when it did not. */
  throttle: (error: unknown) => number | null;
  /** From the connection row: skip this copy until then. */
  throttledUntil: string | null;
};

export type CopyResult = {
  copy: MirrorCopy;
  status: "succeeded" | "partial" | "failed" | "deferred";
  rowsWritten: number;
  error: string | null;
  runId: string | null;
};

export type MirrorSyncResult = { status: "busy" } | { status: "done"; hash: string; copies: CopyResult[] };

const CONNECTION_TABLE: Record<MirrorCopy, string> = {
  excel: "org_microsoft_connections",
  google: "org_google_sheets_connections",
};

/**
 * Write every table to one copy. One table failing does not stop the rest, unless the
 * provider says the sign-in is gone. Returns the outcomes and the longest back-off asked for.
 */
export async function writeTablesToCopy(
  target: WorkbookTarget,
  tables: BuiltTable[],
  def: Pick<MirrorTargetDef, "describe" | "isFatal" | "throttle">,
): Promise<{ outcomes: TableOutcome[]; throttleMs: number | null }> {
  const outcomes: TableOutcome[] = [];
  let fatal: string | null = null;
  let throttleMs: number | null = null;
  for (const table of tables) {
    if (fatal) {
      outcomes.push({ entity: table.spec.entity, rows: 0, ok: false, error: fatal });
      continue;
    }
    try {
      await target.ensureTable(table.spec);
      await target.replaceRows(table.spec, table.rows);
      outcomes.push({ entity: table.spec.entity, rows: table.rows.length, ok: true });
    } catch (error) {
      const message = def.describe(error);
      outcomes.push({ entity: table.spec.entity, rows: 0, ok: false, error: message });
      const wait = def.throttle(error);
      if (wait !== null) {
        throttleMs = Math.max(throttleMs ?? 0, wait);
        // Throttled: every further write would be refused too. Stop and let the other copy work.
        fatal = message;
      }
      if (def.isFatal(error)) fatal = message;
    }
  }
  // A batching target (Google Sheets) writes everything here, so a failure here means no
  // table of this copy landed.
  if (!fatal && target.flush) {
    try {
      await target.flush();
    } catch (error) {
      const message = def.describe(error);
      const wait = def.throttle(error);
      if (wait !== null) throttleMs = Math.max(throttleMs ?? 0, wait);
      for (const outcome of outcomes) {
        if (!outcome.ok) continue;
        outcome.ok = false;
        outcome.rows = 0;
        outcome.error = message;
      }
    }
  }
  return { outcomes, throttleMs };
}

export function isDeferred(throttledUntil: string | null, now: Date): boolean {
  if (!throttledUntil) return false;
  const until = Date.parse(throttledUntil);
  return Number.isFinite(until) && until > now.getTime();
}

export function clampThrottle(ms: number | null): number {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return DEFAULT_THROTTLE_MS;
  return Math.min(Math.max(ms, 60_000), MAX_THROTTLE_MS);
}

export async function syncMirror(
  client: PoolClient,
  orgId: string,
  options: { targets: MirrorTargetDef[]; userId?: string | null; now?: () => Date },
): Promise<MirrorSyncResult> {
  const now = options.now ?? (() => new Date());
  const locked = (
    await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock(hashtextextended('microsoft-workbook-sync:' || $1::text, 0)) AS locked`,
      [orgId],
    )
  ).rows[0]?.locked;
  if (!locked) return { status: "busy" };

  // One read, one build: both copies get exactly these tables.
  const source = await loadWorkbookSource(client, orgId);
  const built = buildWorkbookTables(source, now());
  const hash = contentHash(built);
  const tables = withMirrorInfo(
    built,
    hash,
    options.targets.map((target) => target.copy),
  );

  const copies: CopyResult[] = [];
  for (const def of options.targets) {
    if (isDeferred(def.throttledUntil, now())) {
      copies.push({
        copy: def.copy,
        status: "deferred",
        rowsWritten: 0,
        error: "Resting after the provider asked Vantage to slow down; it catches up on the next sync.",
        runId: null,
      });
      continue;
    }

    const run = (
      await client.query<{ id: string }>(
        `INSERT INTO workbook_sync_runs (org_id, status, attempt, started_by, started_at, target, content_hash)
         VALUES ($1::uuid, 'running', 1, $2::uuid, $3::timestamptz, $4::text, $5::text)
         RETURNING id`,
        [orgId, options.userId ?? null, now().toISOString(), def.copy, hash],
      )
    ).rows[0]!;

    let outcomes: TableOutcome[];
    let throttleMs: number | null;
    let target: WorkbookTarget | null = null;
    try {
      target = await def.open();
      ({ outcomes, throttleMs } = await writeTablesToCopy(target, tables, def));
    } catch (error) {
      const message = def.describe(error);
      throttleMs = def.throttle(error);
      outcomes = tables.map((table) => ({ entity: table.spec.entity, rows: 0, ok: false, error: message }));
    } finally {
      await target?.close().catch(() => undefined);
    }

    const summary = summarizeOutcomes(outcomes);
    const finishedAt = now().toISOString();
    await client.query(
      `UPDATE workbook_sync_runs
          SET status = $2::text, finished_at = $3::timestamptz, tables_written = $4::jsonb,
              rows_written = $5::int, error = $6::text
        WHERE id = $1::uuid AND org_id = $7::uuid`,
      [run.id, summary.status, finishedAt, JSON.stringify(summary.tablesWritten), summary.rowsWritten, summary.error?.slice(0, 2000) ?? null, orgId],
    );

    const table = CONNECTION_TABLE[def.copy];
    const throttledUntil =
      throttleMs !== null ? new Date(now().getTime() + clampThrottle(throttleMs)).toISOString() : null;
    if (summary.status === "succeeded") {
      await client.query(
        `UPDATE ${table}
            SET last_sync_at = $2::timestamptz, last_sync_hash = $3::text, last_error = NULL, last_error_at = NULL,
                throttled_until = NULL, updated_at = now()
          WHERE org_id = $1::uuid`,
        [orgId, finishedAt, hash],
      );
    } else {
      await client.query(
        `UPDATE ${table}
            SET last_sync_at = CASE WHEN $3::text = 'partial' THEN $2::timestamptz ELSE last_sync_at END,
                last_error = $4::text, last_error_at = $2::timestamptz,
                throttled_until = COALESCE($5::timestamptz, throttled_until), updated_at = now()
          WHERE org_id = $1::uuid`,
        [orgId, finishedAt, summary.status, (summary.error ?? "The sync failed.").slice(0, 500), throttledUntil],
      );
    }

    copies.push({
      copy: def.copy,
      status: summary.status,
      rowsWritten: summary.rowsWritten,
      error: summary.error,
      runId: run.id,
    });
  }

  return { status: "done", hash, copies };
}
