/**
 * What an API route may tell a browser about a failure.
 *
 * Most routes answered `error instanceof Error ? error.message : "…failed"`.
 * That is right for errors the route throws on purpose ("A valid team is
 * required") and wrong for everything the database throws: a student opening
 * the calendar read "column s.series_id does not exist", and the same path
 * would print table names, constraint names and sometimes the conflicting
 * value of a unique key. Postgres errors carry a five-character SQLSTATE
 * `code`; those get the route's own plain fallback, and the real message is
 * logged on the server where someone can act on it.
 */

const SQLSTATE = /^[0-9A-Z]{5}$/;

export function isDatabaseError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && SQLSTATE.test(code);
}

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (isDatabaseError(error)) {
    console.error("[api] database error", (error as { code?: string }).code, error.message);
    return fallback;
  }
  return error.message || fallback;
}
