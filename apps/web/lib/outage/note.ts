import { isDatabaseFailure } from "./classify";
import { deferOutageWork } from "./defer";
import { reportDatabaseFailure } from "./incident";

/**
 * For a request path that caught an error: when it says the database itself is unavailable
 * (not a bug, a missing session or a refusal), record it for the outage tracker after the
 * response. Never throws, never delays the response.
 */
export function noteDatabaseFailure(error: unknown, source: string): void {
  try {
    if (isDatabaseFailure(error)) deferOutageWork(() => reportDatabaseFailure(error, source));
  } catch {
    // Outage bookkeeping must never become the request's failure.
  }
}
