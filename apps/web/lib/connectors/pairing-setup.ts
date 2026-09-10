/**
 * Setup answers for the two connectors a person pairs from another machine —
 * the team storage node and the Fusion 360 relay.
 *
 * Neither has an OAuth dance: a program running on the team's own computer
 * prints a code, and an owner approves it in the browser. What they share with
 * the OAuth connectors is the failure mode. Both pairing endpoints run on a
 * separate least-privilege Postgres role, `DATABASE_CAD_RELAY_URL`, and when
 * that variable is absent in production `getCadRelayPool()` throws
 * "DATABASE_CAD_RELAY_URL is required" — which the route then reported as a
 * 400. To the node that is indistinguishable from "your machine name was
 * rejected": it is a client error, so the agent stops and retries nothing, and
 * the person at the shop computer has no idea a deployment variable is missing.
 *
 * A setup problem is 503 and says which variable, where it goes, and what it
 * may be set to.
 */

export const RELAY_DB_ENV = "DATABASE_CAD_RELAY_URL";

export const RELAY_DB_SETUP_MESSAGE =
  `Pairing is not available on this deployment — set ${RELAY_DB_ENV} in your deployment environment ` +
  "(Vercel → Project → Settings → Environment Variables), then redeploy. It is the connection string for " +
  "the least-privilege `vantage_pairing` Postgres role; until a dedicated role exists it may be set to the " +
  "same pooled URL as DATABASE_URL. Pairing needs no callback URL and no account with Autodesk or anyone else.";

/**
 * True when a thrown error is the relay pool refusing to build for want of its
 * connection string, rather than a real database failure. Matched on the
 * message because `getCadRelayPool` throws a plain Error; the variable name is
 * distinctive enough that a false positive would have to be a database whose
 * own error text names it.
 */
export function isRelayDatabaseUnconfigured(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes(RELAY_DB_ENV);
}

/**
 * The response a pairing endpoint should return for a setup problem: 503, so
 * the agent on the team's machine treats it as "come back later" rather than
 * "you sent something wrong", and a body that names the variable.
 */
export function relaySetupResponse(): Response {
  return Response.json({ error: RELAY_DB_SETUP_MESSAGE, missingEnv: [RELAY_DB_ENV] }, { status: 503 });
}
