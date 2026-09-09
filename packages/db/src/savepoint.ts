/**
 * Savepoint helper, deliberately free of the pool that `@vantage/db` builds at
 * import time so packages which only need this (the agent, for one) can take it
 * without pulling a database connection into their module graph.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "@neondatabase/serverless";

let savepointSeq = 0;

/**
 * Savepoints on one client must not interleave, and callers cannot be trusted to
 * remember that.
 *
 * `SAVEPOINT a … SAVEPOINT b … RELEASE a` destroys b, so the later `RELEASE b`
 * raises "no such savepoint" — which itself aborts the transaction, exactly the
 * failure withSavepoint exists to prevent. The driver serializes *statements* on
 * a PoolClient but not the awaits between them, so any `Promise.all` holding two
 * protected reads on the same client used to produce that interleaving. Since
 * `Promise.all` over a shared client is the house style for loading a page's
 * sections, the safety belongs here rather than in every call site.
 *
 * Sibling calls therefore take turns on a per-client queue. A *nested* call (one
 * withSavepoint inside another's work, on the same client) must not wait on that
 * queue or it would deadlock on the lock its own caller holds — proper nesting is
 * legal in Postgres — so it takes a fresh queue scoped to that frame instead, and
 * `AsyncLocalStorage` is what carries the frame into the work callback.
 */
type SavepointFrame = { queue: Promise<unknown> };
const nestedSavepointFrames = new AsyncLocalStorage<Map<PoolClient, SavepointFrame>>();
const savepointQueues = new WeakMap<PoolClient, Promise<unknown>>();

function serializeOnClient<T>(client: PoolClient, run: () => Promise<T>): Promise<T> {
  const frames = nestedSavepointFrames.getStore();
  const frame = frames?.get(client);
  const previous = frame ? frame.queue : (savepointQueues.get(client) ?? Promise.resolve());
  // `.then(run, run)` so one caller's failure never wedges the queue behind it.
  const next = previous.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  if (frame) frame.queue = settled;
  else savepointQueues.set(client, settled);
  return next;
}

/**
 * Run a best-effort read or write so that a failure costs only that statement.
 *
 * `withRls` puts the whole request in one transaction, so a `try { … } catch {}`
 * around an optional query is a trap: Postgres marks the transaction aborted and
 * every later statement in the same request fails with "current transaction is
 * aborted", silently emptying features that had nothing to do with the failure.
 * Wrap the optional work in a savepoint instead — on failure only it rolls back
 * and the caller gets `fallback`.
 *
 * Safe to call concurrently on one client: see `serializeOnClient` above.
 */
export async function withSavepoint<T>(
  client: PoolClient,
  work: () => Promise<T>,
  fallback: T,
): Promise<T> {
  return serializeOnClient(client, () => {
    const frames = new Map(nestedSavepointFrames.getStore() ?? []);
    frames.set(client, { queue: Promise.resolve() });
    return nestedSavepointFrames.run(frames, () => runInSavepoint(client, work, fallback));
  });
}

async function runInSavepoint<T>(
  client: PoolClient,
  work: () => Promise<T>,
  fallback: T,
): Promise<T> {
  savepointSeq += 1;
  const name = `vantage_sp_${savepointSeq % 1_000_000}`;
  try {
    await client.query(`SAVEPOINT ${name}`);
  } catch {
    // Not inside a usable transaction; fall back to a plain guard.
    try {
      return await work();
    } catch {
      return fallback;
    }
  }
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    } catch {
      // Connection is unusable; withRls will roll the request back.
    }
    return fallback;
  }
}
