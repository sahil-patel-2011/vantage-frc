import type { PoolClient } from "@neondatabase/serverless";
import type { OnshapeHttp } from "@vantage/cad";
import { loadCadAgentOnshape } from "../cad/onshape-tokens";

/**
 * Getting an Onshape client for the caller, without ever hard-failing.
 *
 * Onshape is setup-required by design: an org with no OAuth client configured,
 * or a student who has not connected their account, must see a clear "connect
 * Onshape" state and not a stack trace. `loadCadAgentOnshape` throws with the
 * right sentence in both cases; this turns that into a value the grader can
 * report alongside "and so nothing was graded".
 *
 * There is deliberately no fallback path. Without a real Onshape read there is
 * no grade — not a zero, not a provisional score.
 */
export type OnshapeAccess =
  | { ok: true; http: OnshapeHttp }
  | { ok: false; message: string };

export async function acquireOnshape(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<OnshapeAccess> {
  try {
    const connection = await loadCadAgentOnshape(client, orgId, userId);
    return { ok: true, http: connection.http };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message
          ? error.message
          : "Onshape is not connected for this account, so nothing could be measured.",
    };
  }
}
