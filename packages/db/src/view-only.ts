/**
 * View only = read-only, enforced by Postgres (migration 0715).
 *
 * The 0715 policies refuse a viewer's write with SQLSTATE 42501, detail
 * `vantage:view_only` and the product sentence below. A viewer refused by an
 * older, narrower policy (an owner/admin-only table) gets Postgres' generic
 * "new row violates row-level security policy" instead; withRls() asks the
 * database whether this person is View only and, if so, says the same sentence.
 *
 * Pool-free on purpose, so browser-adjacent code and unit tests can import the
 * message and the predicates without opening a database connection.
 */

export const VIEW_ONLY_MESSAGE =
  "View only — you can look but not change this. Ask a team owner or admin for Team member access.";

/** `reason` on the 403 body, and the DETAIL the 0715 policy function raises with. */
export const VIEW_ONLY_REASON = "view_only";
const VIEW_ONLY_DETAIL = "vantage:view_only";

/** What a viewer's refused write becomes once it leaves withRls(): a plain 403. */
export class ViewOnlyError extends Error {
  readonly status = 403;
  readonly reason = VIEW_ONLY_REASON;
  constructor(options?: { cause?: unknown }) {
    super(VIEW_ONLY_MESSAGE, options);
    this.name = "ViewOnlyError";
  }
}

type PgErrorLike = { code?: unknown; detail?: unknown; message?: unknown };

function pgError(error: unknown): PgErrorLike | null {
  return error && typeof error === "object" ? (error as PgErrorLike) : null;
}

/** True for ViewOnlyError and for the raw 0715 refusal straight from Postgres. */
export function isViewOnlyRefusal(error: unknown): boolean {
  if (error instanceof ViewOnlyError) return true;
  const pg = pgError(error);
  if (!pg || pg.code !== "42501") return false;
  return pg.detail === VIEW_ONLY_DETAIL || pg.message === VIEW_ONLY_MESSAGE;
}

/** Any row-level-security refusal (42501 "…violates row-level security policy…"). */
export function isRowSecurityRefusal(error: unknown): boolean {
  const pg = pgError(error);
  if (!pg || pg.code !== "42501") return false;
  return typeof pg.message === "string" && /row-level security/i.test(pg.message);
}

type QueryClient = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

/**
 * Refuse up front, inside withRls(), when the caller is View only in `orgId`.
 * RLS refuses the write anyway; this is for routes that write many rows behind
 * per-row savepoints (scouting sync) and would otherwise report each row as
 * "rejected" instead of answering once with a 403.
 */
export async function assertNotViewOnly(client: QueryClient, orgId: string): Promise<void> {
  const result = await client.query(`SELECT is_org_viewer($1::uuid) AS viewer`, [orgId]);
  if (result.rows[0]?.viewer === true) throw new ViewOnlyError();
}

/**
 * Turn a viewer's refused write into ViewOnlyError; return anything else as it was.
 *
 * Call it AFTER the failed transaction was rolled back, on the same client. For a
 * generic RLS refusal it opens one short read-only transaction as the same person
 * to ask is_org_viewer(): for the request's org when withRls() was given one,
 * otherwise "View only on every team they belong to". It never throws: when it
 * cannot tell, the original error stands.
 */
export async function explainWriteRefusal(
  client: QueryClient,
  context: { userId: string; orgId?: string },
  error: unknown,
): Promise<unknown> {
  if (error instanceof ViewOnlyError) return error;
  if (isViewOnlyRefusal(error)) return new ViewOnlyError({ cause: error });
  if (!isRowSecurityRefusal(error) || !context.userId) return error;
  try {
    await client.query("BEGIN READ ONLY");
    try {
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id', $1, true)", [context.userId]);
      const result = await client.query(
        context.orgId
          ? `SELECT is_org_viewer($1::uuid) AS viewer`
          : `SELECT COALESCE(bool_and(is_org_viewer(m.org_id)), false) AS viewer
               FROM memberships m
              WHERE m.user_id = current_app_user_id()`,
        context.orgId ? [context.orgId] : [],
      );
      return result.rows[0]?.viewer === true ? new ViewOnlyError({ cause: error }) : error;
    } finally {
      await client.query("ROLLBACK");
    }
  } catch {
    return error;
  }
}
