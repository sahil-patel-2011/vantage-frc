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

/**
 * Messages that read as engineering, not as something a team member can act on: environment
 * variable names, migration file ids, runtime crashes, network internals, raw HTTP status
 * lines, or a wall of text. These get the route's plain fallback; the real message is logged.
 */
const TECHNICAL = [
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/, // ENV_VAR_NAMES
  /\b\d{4}_[a-z0-9_]+(\.sql)?\b/, // 0145_duty_roster migrations
  /Cannot read propert|is not a function|is not defined|undefined|Unexpected token|JSON\.parse|stack/i,
  /\bE(CONN|NOTFOUND|TIMEDOUT|ADDRINUSE)|fetch failed|socket hang up|getaddrinfo/i,
  /\bHTTP \d{3}\b|\bstatus \d{3}\b|\(\d{3}\)$/,
  /\bsql\b|relation "|column "|constraint "|violates|syntax error/i,
];

export function isPlainMessage(message: string): boolean {
  const text = message.trim();
  return text.length > 0 && text.length <= 240 && !TECHNICAL.some((pattern) => pattern.test(text));
}

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (isDatabaseError(error)) {
    console.error("[api] database error", (error as { code?: string }).code, error.message);
    return fallback;
  }
  if (!isPlainMessage(error.message ?? "")) {
    console.error("[api] technical error hidden from the page", error.name, error.message?.slice(0, 300));
    return fallback;
  }
  return error.message;
}
