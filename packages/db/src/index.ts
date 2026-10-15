import type { PoolClient } from "@neondatabase/serverless";
import { createDrizzle } from "./drizzle-client";
import { resolveAppDatabaseUrl } from "./postgres-url";
import { serializeClientQueries } from "./serial-queries";
import { explainWriteRefusal } from "./view-only";

const connectionString = resolveAppDatabaseUrl();

const { pool, db: drizzleDb } = createDrizzle(connectionString);
export const requestPool = pool;
export const db = drizzleDb;

export type RequestContext = {
  userId: string;
  orgId?: string;
};

/** Commits an intentional audit/denial row, then surfaces the public error. */
export class CommitAndThrowError extends Error {
  constructor(readonly publicError: Error) {
    super(publicError.message);
    this.name = "CommitAndThrowError";
  }
}

/**
 * When each (user, team) last ran the scheduled-competition activation, per server instance.
 * Activation turns a planned competition on when it starts; checking it inside every single
 * transaction (a page makes several) cost a round trip each time for an answer that changes a
 * few times a season. Once a minute per user and team is soon enough. Production only, so tests
 * that move the clock still see activation on every call.
 */
const activationCheckedAt = new Map<string, number>();
const ACTIVATION_INTERVAL_MS = 60_000;

function activationDue(context: RequestContext, now = Date.now()): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const key = `${context.userId}|${context.orgId?.trim() ?? ""}`;
  const last = activationCheckedAt.get(key);
  if (last !== undefined && now - last < ACTIVATION_INTERVAL_MS) return false;
  if (activationCheckedAt.size > 5_000) activationCheckedAt.clear();
  activationCheckedAt.set(key, now);
  return true;
}

/**
 * The only request-path transaction entry point. SET LOCAL ensures pooled
 * connections cannot leak identity between requests — including across teams.
 * Queries on the client run one at a time, in the order they are made (serial-queries.ts).
 */
export async function withRls<T>(
  context: RequestContext,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await requestPool.connect();
  const unserialize = serializeClientQueries(client as unknown as Parameters<typeof serializeClientQueries>[0]);
  const beginRequest = async () => {
    // One round trip for the two fixed statements (no parameters, so the simple protocol
    // runs both); the identity settings stay parameterized.
    await client.query("BEGIN; SET LOCAL ROLE vantage_app");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)", [context.userId, context.orgId ?? ""]);
  };
  try {
    // Even a misconfigured owner URL must never bypass tenant policies. Restricted
    // logins are members of vantage_app; SET LOCAL also resets on commit/rollback.
    await beginRequest();
    const activation = activationDue(context)
      ? await client.query<{ attempted: boolean }>("SELECT activate_scheduled_competition_events($1::uuid) AS attempted", [context.orgId?.trim() || null])
      : null;
    if (activation?.rows[0]?.attempted) {
      // Release context row locks before any long feature/provider work. The
      // approved calendar plan is independent of that subsequent operation.
      await client.query("COMMIT");
      await beginRequest();
    }
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (error instanceof CommitAndThrowError) {
      await client.query("COMMIT");
      throw error.publicError;
    }
    await client.query("ROLLBACK");
    // A View only member's refused write (0715) leaves as ViewOnlyError: one
    // sentence and a 403, not a database error the route hides behind "failed".
    throw await explainWriteRefusal(client, context, error);
  } finally {
    unserialize();
    client.release();
  }
}

export * from "./savepoint";
export * from "./view-only";
export * from "./schema";
export * from "./postgres-url";
