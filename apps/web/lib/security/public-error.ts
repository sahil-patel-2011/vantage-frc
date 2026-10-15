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

import { isViewOnlyRefusal, VIEW_ONLY_MESSAGE, VIEW_ONLY_REASON } from "@vantage/db/view-only";

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * The 403 a route returns when a View only member tried to change something, or
 * null for any other error. Routes with their own catch call this first.
 */
export function viewOnlyResponse(error: unknown): Response | null {
  if (!isViewOnlyRefusal(error)) return null;
  return Response.json({ error: VIEW_ONLY_MESSAGE, reason: VIEW_ONLY_REASON }, { status: 403 });
}

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
  /\bmigration\b|\(0\d{3}\)|database update/i, // "needs migration 0719", "(0733)"
];

/**
 * Messages the server throws on purpose, worded for code ("Organization access denied",
 * "orgId is required"). Routes still match on the original text to choose a status code, so
 * it is only reworded here, on the way to the page, in the words the rest of the app uses.
 */
const PLAIN_WORDING: Array<[RegExp, string]> = [
  [/^Organization (access denied|membership required)\.?$/i, "You're not on this team."],
  [/^Organization (administrator|admin) access required\.?$/i, "Only the team's owners and admins can do this."],
  [/^orgId is required\.?$/i, "Choose your team first."],
  [/^(A valid )?organization (id )?is required\.?$/i, "Choose your team first."],
];

/** The page-facing wording of a message the server threw on purpose. */
export function plainWording(message: string): string {
  const text = message.trim();
  for (const [pattern, words] of PLAIN_WORDING) if (pattern.test(text)) return words;
  return message;
}

export function isPlainMessage(message: string): boolean {
  const text = message.trim();
  return text.length > 0 && text.length <= 240 && !TECHNICAL.some((pattern) => pattern.test(text));
}

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  // A View only member's refused write (0715) is the one database refusal the
  // page should read verbatim: it says why and who can change it.
  if (isViewOnlyRefusal(error)) return VIEW_ONLY_MESSAGE;
  if (isDatabaseError(error)) {
    console.error("[api] database error", (error as { code?: string }).code, error.message);
    return fallback;
  }
  if (!isPlainMessage(error.message ?? "")) {
    console.error("[api] technical error hidden from the page", error.name, error.message?.slice(0, 300));
    return fallback;
  }
  return plainWording(error.message);
}
