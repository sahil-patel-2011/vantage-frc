import type { PoolClient } from "@neondatabase/serverless";

/**
 * Queue mechanics for assembly-manual runs.
 *
 * Only the mechanics live here: claim, lease, heartbeat, release, fail. The
 * engine that actually reads Onshape and builds the book lives in the web app
 * (`apps/web/lib/assembly-manual`), because it needs the org's OAuth tokens,
 * the KMS, and the billing path. Domain packages must not import apps/web — so
 * the runner is injected, and a relay that has no runner wired in reports that
 * honestly instead of pretending the queue is empty.
 *
 * WHY A LEASE AND NOT JUST A STATUS
 *
 * A run can be in `running` for hours. If `status = 'running'` were the only
 * guard, a relay that lost power would leave the run wedged forever, and a
 * second relay would have no safe way to tell "someone is working on this" from
 * "someone died holding this". The lease makes that decidable: a run is
 * claimable when its lease has expired, and every checkpoint renews it. Two
 * relays therefore cannot advance the same run, and a dead relay's work is
 * picked up by the next one at its last checkpoint rather than from scratch.
 */

export type AssemblyManualClaim = {
  runId: string;
  orgId: string;
  startedBy: string;
  teamName: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  assemblyName: string;
  stage: string;
};

export type AssemblyManualRunnerInput = AssemblyManualClaim & {
  client: PoolClient;
  /** Wall-clock time this slice may use. */
  deadlineMs: number;
  heartbeat: () => Promise<void>;
  isCancelled: () => Promise<boolean>;
};

export type AssemblyManualRunnerResult = {
  finished: boolean;
  cancelled: boolean;
  stage: string;
};

export type AssemblyManualRunner = (input: AssemblyManualRunnerInput) => Promise<AssemblyManualRunnerResult>;

let installedRunner: AssemblyManualRunner | null = null;

/**
 * Install the engine. The web app's worker route calls this at module load;
 * the Pi relay leaves it unset unless it is running the full app.
 */
export function registerAssemblyManualRunner(runner: AssemblyManualRunner | null): void {
  installedRunner = runner;
}

export function assemblyManualRunnerInstalled(): boolean {
  return installedRunner !== null;
}

const DEFAULT_LEASE_SECONDS = 600;

/**
 * Take the next run this relay is allowed to work on.
 *
 * `FOR UPDATE SKIP LOCKED` plus the lease predicate is what makes this safe to
 * run from several relays at once: two of them racing pick different rows, and
 * a row whose lease is still live is invisible to everyone but its holder.
 */
export async function claimAssemblyManualRun(
  client: PoolClient,
  leaseOwner: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<AssemblyManualClaim | null> {
  const claimed = await client.query<AssemblyManualClaim>(
    `UPDATE assembly_manual_runs r
        SET status = 'running',
            lease_owner = $1::text,
            lease_expires_at = now() + make_interval(secs => $2::int),
            started_at = COALESCE(r.started_at, now()),
            updated_at = now()
      WHERE r.id = (
        SELECT id FROM assembly_manual_runs
         WHERE status IN ('queued', 'running', 'paused')
           AND (lease_expires_at IS NULL OR lease_expires_at < now())
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING r.id AS "runId", r.org_id AS "orgId", r.started_by AS "startedBy",
                (SELECT name FROM organizations WHERE id = r.org_id) AS "teamName",
                r.document_id AS "documentId", r.workspace_id AS "workspaceId",
                r.element_id AS "elementId", r.assembly_name AS "assemblyName",
                COALESCE(r.checkpoint->>'stage', 'ingest') AS stage`,
    [leaseOwner, Math.max(60, Math.min(3600, leaseSeconds))],
  );
  return claimed.rows[0] ?? null;
}

export async function renewAssemblyManualLease(
  client: PoolClient,
  runId: string,
  leaseOwner: string,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<void> {
  await client.query(
    `UPDATE assembly_manual_runs
        SET lease_expires_at = now() + make_interval(secs => $3::int), updated_at = now()
      WHERE id = $1::uuid AND lease_owner = $2::text`,
    [runId, leaseOwner, Math.max(60, Math.min(3600, leaseSeconds))],
  );
}

export async function isAssemblyManualCancelled(client: PoolClient, runId: string): Promise<boolean> {
  const result = await client.query<{ cancelled: boolean }>(
    `SELECT (cancel_requested_at IS NOT NULL) AS cancelled
       FROM assembly_manual_runs WHERE id = $1::uuid`,
    [runId],
  );
  return result.rows[0]?.cancelled ?? false;
}

/** Hand the run back to the queue, still unfinished. */
export async function pauseAssemblyManualRun(client: PoolClient, runId: string, leaseOwner: string): Promise<void> {
  await client.query(
    `UPDATE assembly_manual_runs
        SET status = 'paused', lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1::uuid AND lease_owner = $2::text AND status = 'running'`,
    [runId, leaseOwner],
  );
}

export async function cancelAssemblyManualRun(client: PoolClient, runId: string): Promise<void> {
  await client.query(
    `UPDATE assembly_manual_runs
        SET status = 'cancelled', completed_at = now(), lease_owner = NULL,
            lease_expires_at = NULL, updated_at = now()
      WHERE id = $1::uuid`,
    [runId],
  );
}

export async function failAssemblyManualRun(client: PoolClient, runId: string, message: string): Promise<void> {
  await client.query(
    `UPDATE assembly_manual_runs
        SET status = 'failed', error = $2::text, completed_at = now(),
            lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = $1::uuid`,
    [runId, message.slice(0, 2000)],
  );
}

export type AssemblyManualSweep = {
  claimed: number;
  finished: number;
  paused: number;
  cancelled: number;
  failed: number;
  skipped: boolean;
  reason?: string;
};

export type AssemblyManualSweepOptions = {
  leaseOwner: string;
  /** How long one claim may work before handing the run back. */
  sliceMs?: number;
  /** How many runs to advance in this sweep. */
  maxRuns?: number;
  leaseSeconds?: number;
  runner?: AssemblyManualRunner;
};

/**
 * Advance up to `maxRuns` runs by one slice each.
 *
 * Returning `skipped` with a reason rather than doing nothing quietly is
 * deliberate: "no runner is wired into this relay" and "there is nothing
 * queued" look identical from the outside, and a team waiting on a manual
 * deserves to be told which one it is.
 */
export async function sweepAssemblyManualRuns(
  client: PoolClient,
  options: AssemblyManualSweepOptions,
): Promise<AssemblyManualSweep> {
  const runner = options.runner ?? installedRunner;
  const empty: AssemblyManualSweep = {
    claimed: 0,
    finished: 0,
    paused: 0,
    cancelled: 0,
    failed: 0,
    skipped: true,
  };
  if (!runner) {
    return {
      ...empty,
      reason:
        "No assembly-manual engine is wired into this relay. The engine ships with the web app; run the sweep from there.",
    };
  }

  const sliceMs = Math.max(30_000, Math.min(15 * 60_000, options.sliceMs ?? 4 * 60_000));
  const leaseSeconds = options.leaseSeconds ?? Math.ceil((sliceMs * 3) / 1000);
  const maxRuns = Math.max(1, Math.min(5, options.maxRuns ?? 1));

  const result: AssemblyManualSweep = { claimed: 0, finished: 0, paused: 0, cancelled: 0, failed: 0, skipped: false };

  for (let index = 0; index < maxRuns; index += 1) {
    const claim = await claimAssemblyManualRun(client, options.leaseOwner, leaseSeconds);
    if (!claim) break;
    result.claimed += 1;

    try {
      if (await isAssemblyManualCancelled(client, claim.runId)) {
        await cancelAssemblyManualRun(client, claim.runId);
        result.cancelled += 1;
        continue;
      }

      const outcome = await runner({
        ...claim,
        client,
        deadlineMs: Date.now() + sliceMs,
        heartbeat: () => renewAssemblyManualLease(client, claim.runId, options.leaseOwner, leaseSeconds),
        isCancelled: () => isAssemblyManualCancelled(client, claim.runId),
      });

      if (outcome.cancelled) {
        await cancelAssemblyManualRun(client, claim.runId);
        result.cancelled += 1;
      } else if (outcome.finished) {
        // The engine writes its own completion row (pdf, report, status); all
        // that is left is to let go of the lease.
        await client.query(
          `UPDATE assembly_manual_runs SET lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
            WHERE id = $1::uuid`,
          [claim.runId],
        );
        result.finished += 1;
      } else {
        await pauseAssemblyManualRun(client, claim.runId, options.leaseOwner);
        result.paused += 1;
      }
    } catch (error) {
      await failAssemblyManualRun(
        client,
        claim.runId,
        error instanceof Error ? error.message : "The assembly manual run failed.",
      );
      result.failed += 1;
    }
  }

  return result;
}
