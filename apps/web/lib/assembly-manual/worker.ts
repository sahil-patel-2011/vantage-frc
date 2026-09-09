import type { PoolClient } from "@neondatabase/serverless";
import type { OnshapeHttp } from "@vantage/cad";
import {
  registerAssemblyManualRunner,
  sweepAssemblyManualRuns,
  freeRelayLeaseOwner,
  type AssemblyManualRunner,
  type AssemblyManualSweep,
} from "@vantage/free-relay";
import { loadCadAgentOnshape } from "../cad/onshape-tokens";
import { loadCotsCatalogFromDb, registerCotsCatalog } from "./cots";
import { advanceRun } from "./run";
import type { MeteredInvoke } from "./write";

/**
 * Wiring the engine to the queue.
 *
 * The queue mechanics live in `@vantage/free-relay` (a domain package, which
 * may not import the web app). The engine lives here, because it needs the
 * org's Onshape OAuth tokens, the KMS that decrypts them, and the parts
 * catalog. This module is the join: it builds a runner and registers it.
 *
 * WHICH MODEL THE WORKER USES
 *
 * The free-relay adapter — the same one `memory-dream` uses. Writing a step
 * sentence from facts that are already decided is exactly the kind of
 * low-stakes overnight work the free pool exists for, and it means a team's
 * paid credits are not spent on prose. When no free backend is configured the
 * runner passes `null` and every sentence is the deterministic one; the manual
 * still completes, with the report saying which.
 */

async function onshapeForRun(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<{ http: OnshapeHttp } | { error: string }> {
  try {
    const connection = await loadCadAgentOnshape(client, orgId, userId);
    return { http: connection.http };
  } catch (error) {
    return {
      error:
        error instanceof Error && error.message
          ? error.message
          : "Onshape is not connected for the account that started this run, so the assembly could not be read.",
    };
  }
}

/** The free-tier writer, or null when no free backend is configured. */
export async function freeRelayInvoke(): Promise<MeteredInvoke | null> {
  try {
    const { createFreeRelayChatAdapter } = await import("@vantage/free-relay");
    const adapter = createFreeRelayChatAdapter("assembly_manual");
    return async ({ prompt }) => {
      const completion = await adapter.complete({ message: prompt, context: [] });
      return completion.text;
    };
  } catch {
    return null;
  }
}

export const assemblyManualRunner: AssemblyManualRunner = async (input) => {
  const access = await onshapeForRun(input.client, input.orgId, input.startedBy);
  if ("error" in access) {
    // Not a crash: a run started before Onshape was connected (or after the
    // token was revoked) has to say so, and stay failed rather than retrying
    // forever against a connection that is not coming back.
    throw new Error(access.error);
  }

  // The COTS catalog is optional and may not exist on this deployment. When it
  // does not, hardware lines fall back to the CAD's own part names.
  try {
    const catalog = await loadCotsCatalogFromDb(input.client);
    registerCotsCatalog(catalog);
  } catch {
    registerCotsCatalog(null);
  }

  const result = await advanceRun({
    client: input.client,
    runId: input.runId,
    orgId: input.orgId,
    teamName: input.teamName || "This team",
    http: access.http,
    invoke: await freeRelayInvoke(),
    deadlineMs: input.deadlineMs,
    isCancelled: input.isCancelled,
    heartbeat: input.heartbeat,
  });

  return { finished: result.finished, cancelled: result.cancelled, stage: result.stage };
};

let registered = false;

/** Idempotent — route modules can call this at import time. */
export function ensureAssemblyManualRunnerRegistered(): void {
  if (registered) return;
  registerAssemblyManualRunner(assemblyManualRunner);
  registered = true;
}

export type AssemblyManualTick = AssemblyManualSweep & { leaseOwner: string };

/**
 * One worker tick against the worker connection.
 *
 * Called from the cron route, and safe to call from several instances at once:
 * the lease in `sweepAssemblyManualRuns` is what stops two of them advancing
 * the same run.
 */
export async function tickAssemblyManualQueue(options?: {
  sliceMs?: number;
  maxRuns?: number;
}): Promise<AssemblyManualTick | { skipped: true; reason: string }> {
  ensureAssemblyManualRunnerRegistered();

  const { createSqlPool } = await import("@vantage/db/pool");
  const { firstConfiguredEnv } = await import("@vantage/db/postgres-url");
  const connectionString = firstConfiguredEnv(
    "DATABASE_ADMIN_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL",
    "POSTGRES_URL",
  );
  if (!connectionString) {
    return { skipped: true, reason: "No worker database URL is configured, so no run can be advanced." };
  }

  const leaseOwner = freeRelayLeaseOwner();
  const pool = createSqlPool(connectionString, { max: 2 });
  const client = await pool.connect();
  try {
    const sweep = await sweepAssemblyManualRuns(client, {
      leaseOwner,
      ...(options?.sliceMs !== undefined ? { sliceMs: options.sliceMs } : {}),
      ...(options?.maxRuns !== undefined ? { maxRuns: options.maxRuns } : {}),
    });
    return { ...sweep, leaseOwner };
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}
