/**
 * Several reads started together on one request client become one network round trip.
 *
 * `serializeClientQueries` ran those reads one after another, so each paid the full
 * round trip to Postgres. A page that fires twenty widget reads was twenty trips even
 * though none of them needed the previous answer. This collector waits until the
 * current turn has queued every read, then sends the batch as one simple-protocol
 * script. Postgres still runs the statements in order. The wait is one round trip
 * plus execution, not one round trip per statement.
 *
 * A failed statement aborts a multi-statement script. The batch is wrapped in a
 * savepoint inside that same script; on failure we roll back to it and run each
 * statement on its own, so one optional read cannot blank the rest of the page.
 * Transaction control (BEGIN, SAVEPOINT, COMMIT) is never mixed into a batch.
 * The request prelude (BEGIN, role, identity) rides along on the first script so
 * opening the transaction is not its own round trip.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

type QueryArgs = unknown[];

type Queued = {
  text: string;
  values: unknown[] | undefined;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

type OriginalQuery = (...args: QueryArgs) => Promise<unknown>;

const escapeLiteral: (value: string) => string = pg.escapeLiteral;

function isPassThrough(args: QueryArgs): boolean {
  const first = args[0] as { submit?: unknown } | null | undefined;
  return typeof args[args.length - 1] === "function" || (first != null && typeof first === "object" && typeof first.submit === "function");
}

function readText(args: QueryArgs): { text: string; values: unknown[] | undefined } | null {
  const first = args[0];
  if (typeof first === "string") {
    const values = Array.isArray(args[1]) ? (args[1] as unknown[]) : undefined;
    return { text: first, values };
  }
  if (first != null && typeof first === "object" && typeof (first as { text?: unknown }).text === "string") {
    const config = first as { text: string; values?: unknown[] };
    if (Object.keys(first as object).some((key) => key !== "text" && key !== "values")) return null;
    return { text: config.text, values: config.values };
  }
  return null;
}

/** Selects and writes can share a script. Transaction control must run alone. */
export function isBatchableStatement(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes(";")) return false;
  return /^(select|with|values|table|show|explain|insert|update|delete)\b/i.test(trimmed);
}

export function formatQueryValue(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot inline a non-finite number");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return escapeLiteral(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Cannot inline an invalid date");
    return `${escapeLiteral(value.toISOString())}::timestamptz`;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return `'\\x${value.toString("hex")}'::bytea`;
  if (Array.isArray(value)) {
    if (value.length === 0) return "ARRAY[]::text[]";
    return `ARRAY[${value.map((item) => formatQueryValue(item)).join(",")}]`;
  }
  if (typeof value === "object") return `${escapeLiteral(JSON.stringify(value))}::jsonb`;
  throw new Error("Cannot inline this query value");
}

/** `$1` style placeholders become literals. One pass, so a literal cannot contain a later placeholder. */
export function inlinePlaceholders(text: string, values: unknown[] | undefined): string {
  if (!values || values.length === 0) return text;
  return text.replace(/\$(\d+)\b/g, (match, digits: string) => {
    const index = Number(digits) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= values.length) return match;
    return formatQueryValue(values[index]);
  });
}

let waveSeq = 0;

const roundTripCount = new AsyncLocalStorage<{ n: number }>();

/** Counts scripts actually sent to Postgres while `work` runs (one batched wave is one). */
export async function countRoundTrips<T>(work: () => Promise<T>): Promise<{ result: T; roundTrips: number }> {
  const box = { n: 0 };
  const result = await roundTripCount.run(box, work);
  return { result, roundTrips: box.n };
}

function noteRoundTrip(): void {
  const box = roundTripCount.getStore();
  if (box) box.n += 1;
}

function resultList(result: unknown): unknown[] {
  return Array.isArray(result) ? result : [result];
}

async function dispatch(
  original: OriginalQuery,
  text: string,
  values: unknown[] | undefined,
  takePrelude: () => string | null,
): Promise<unknown> {
  const prelude = takePrelude();
  if (!prelude) return original(text, values);
  let statement: string;
  try {
    statement = inlinePlaceholders(text, values);
  } catch {
    await original(prelude);
    return original(text, values);
  }
  const result = await original(`${prelude};\n${statement}`);
  const rows = resultList(result);
  return rows[rows.length - 1];
}

async function runIndividuals(
  original: OriginalQuery,
  batch: Queued[],
  takePrelude: () => string | null,
): Promise<void> {
  for (const item of batch) {
    try {
      item.resolve(await dispatch(original, item.text, item.values, takePrelude));
    } catch (error) {
      item.reject(error);
    }
  }
}

/** Three commands: BEGIN, SET LOCAL ROLE, and both set_config calls. */
const PRELUDE_COMMANDS = 3;

export type WaveControl = (() => void) & {
  setPrelude(sql: string | null): void;
  preludePending(): boolean;
};

/**
 * Queue `client.query` calls that start in the same turn and send them together.
 * Returns a restore function. The driver never sees two queries at once.
 * `setPrelude` arms a script that is prefixed onto the first statement only.
 */
export function installQueryWaves(client: { query: (...args: QueryArgs) => unknown }): WaveControl {
  const hadOwn = Object.prototype.hasOwnProperty.call(client, "query");
  const previous = client.query;
  const bound = previous.bind(client) as OriginalQuery;
  const original: OriginalQuery = (...args) => {
    noteRoundTrip();
    return bound(...args);
  };
  let queue: Queued[] = [];
  let flushing = false;
  let scheduled = false;
  let preludeSql: string | null = null;

  const takePrelude = (): string | null => {
    if (!preludeSql) return null;
    const sql = preludeSql;
    preludeSql = null;
    return sql;
  };

  const schedule = () => {
    if (scheduled || flushing) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void flush();
    });
  };

  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length > 0) {
        const pending = queue;
        queue = [];
        let start = 0;
        while (start < pending.length) {
          let end = start + 1;
          if (isBatchableStatement(pending[start]!.text)) {
            while (end < pending.length && isBatchableStatement(pending[end]!.text)) end += 1;
          }
          const group = pending.slice(start, end);
          start = end;
          if (group.length < 2) {
            await runIndividuals(original, group, takePrelude);
            continue;
          }
          await runBatch(original, group, takePrelude);
        }
      }
    } finally {
      flushing = false;
      if (queue.length > 0) schedule();
    }
  };

  client.query = ((...args: QueryArgs) => {
    if (isPassThrough(args)) return original(...args);
    const parsed = readText(args);
    if (!parsed) return original(...args);
    return new Promise((resolve, reject) => {
      queue.push({ text: parsed.text, values: parsed.values, resolve, reject });
      schedule();
    });
  }) as typeof client.query;

  const restore = (() => {
    if (hadOwn) client.query = previous;
    else delete (client as { query?: unknown }).query;
  }) as WaveControl;
  restore.setPrelude = (sql: string | null) => {
    preludeSql = sql;
  };
  restore.preludePending = () => preludeSql != null;
  return restore;
}

async function runBatch(
  original: OriginalQuery,
  batch: Queued[],
  takePrelude: () => string | null,
): Promise<void> {
  waveSeq += 1;
  const savepoint = `vantage_wave_${waveSeq % 1_000_000}`;
  const prelude = takePrelude();
  const skip = (prelude ? PRELUDE_COMMANDS : 0) + 1;
  let script: string;
  try {
    const statements = batch.map((item) => inlinePlaceholders(item.text, item.values));
    const head = prelude ? [prelude, `SAVEPOINT ${savepoint}`] : [`SAVEPOINT ${savepoint}`];
    script = [...head, ...statements, `RELEASE SAVEPOINT ${savepoint}`].join(";\n");
  } catch {
    if (prelude) await original(prelude);
    await runIndividuals(original, batch, () => null);
    return;
  }
  try {
    const result = await original(script);
    const rows = resultList(result);
    // Prelude commands (when present), SAVEPOINT, one result per statement, RELEASE.
    if (rows.length !== skip + batch.length + 1) {
      throw new Error(`Batch returned ${rows.length} results for ${batch.length} statements`);
    }
    batch.forEach((item, index) => item.resolve(rows[index + skip]));
  } catch (error) {
    try {
      await original(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } catch {
      // The script failed before the savepoint existed. Re-running would skip the
      // role and the identity settings, so a prelude failure is the caller's error.
      if (prelude) {
        batch.forEach((item) => item.reject(error));
        return;
      }
      await runIndividuals(original, batch, () => null);
      return;
    }
    for (const [index, item] of batch.entries()) {
      const isolate = `vantage_iso_${waveSeq}_${index}`;
      try {
        await original(`SAVEPOINT ${isolate}`);
        item.resolve(await original(item.text, item.values));
        await original(`RELEASE SAVEPOINT ${isolate}`);
      } catch (error) {
        try {
          await original(`ROLLBACK TO SAVEPOINT ${isolate}`);
        } catch {
          // Already outside this savepoint.
        }
        item.reject(error);
      }
    }
  }
}
