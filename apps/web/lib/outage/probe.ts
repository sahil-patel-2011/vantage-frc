import { withRls } from "@vantage/db";
import { deferOutageWork } from "./defer";
import { reportDatabaseFailure, reportDatabaseHealthy } from "./incident";

/** No one's identity: the check reads nothing but the clock. */
const NOBODY = "00000000-0000-0000-0000-000000000000";
export const PROBE_TIMEOUT_MS = 4_000;
/** The NAS pool gives up after 10 s; wait a little longer than that for its real reason. */
const SETTLE_LIMIT_MS = 12_000;

export class ProbeTimeoutError extends Error {
  readonly code = "ETIMEDOUT";
  constructor(ms: number) {
    super(`The database did not answer within ${Math.round(ms / 1000)} s`);
    this.name = "ProbeTimeoutError";
  }
}

export type ProbeResult =
  | { ok: true; ms: number }
  | {
      ok: false;
      ms: number;
      error: unknown;
      /**
       * Resolves to the database's own answer once the slow attempt finishes: `null` when it
       * finally succeeded, or the real error (refused, DNS, TLS…) instead of the 4 s timeout.
       */
      settled: Promise<unknown>;
    };

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** SELECT 1 through the normal request path, answered within `timeoutMs` either way. */
export async function probeDatabase(timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const started = Date.now();
  const attempt = withRls({ userId: NOBODY }, async (client) => {
    await client.query("SELECT 1");
  });
  const outcome = attempt.then(
    () => null as unknown,
    (error: unknown) => error ?? new Error("Database check failed"),
  );
  const timedOut = new ProbeTimeoutError(timeoutMs);
  const first = await Promise.race([outcome, wait(timeoutMs).then(() => timedOut)]);
  const ms = Date.now() - started;
  if (first === null) return { ok: true, ms };
  const settled =
    first === timedOut
      ? Promise.race([outcome, wait(SETTLE_LIMIT_MS).then(() => timedOut)])
      : Promise.resolve(first);
  return { ok: false, ms, error: first, settled };
}

/**
 * After the response: tell the incident tracker what the probe found. A 4 s timeout waits for
 * the database's own answer first, so the owner reads "Postgres isn't accepting connections"
 * rather than "it timed out" when the real reason arrives a few seconds later.
 */
export function reportProbeOutcome(result: ProbeResult, source: string): void {
  deferOutageWork(async () => {
    if (result.ok) return reportDatabaseHealthy(source);
    const real = await result.settled;
    if (real === null) return reportDatabaseHealthy(source);
    return reportDatabaseFailure(real, source);
  });
}
