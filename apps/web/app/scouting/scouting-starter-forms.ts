import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { bootstrapForEvent } from "../../lib/scouting/bootstrap-event";
import type { Bootstrap } from "./scouting-model";

/**
 * Asks the server for the starter match and pit forms, and returns the fresh bootstrap only when
 * it proves both forms now exist for this team (and event, when one was asked for). Throws with
 * a message to show otherwise: the request may still have reached the server.
 */
export async function ensureStarterForms(orgId: string, requestedEventKey: string | null): Promise<Bootstrap> {
  const response = await fetch("/api/scouting/schemas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orgId, action: "ensure_defaults", ...(requestedEventKey ? { eventKey: requestedEventKey } : {}) }),
    signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => null)) as (Bootstrap & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? "Starter forms could not be created.");
  const team = orgId.toLowerCase();
  const confirmed =
    body &&
    bootstrapForEvent(body, requestedEventKey) &&
    Array.isArray(body.schemas) &&
    ["match", "pit"].every((type) =>
      body.schemas.some((schema) => schema && schema.type === type && typeof schema.orgId === "string" && schema.orgId.toLowerCase() === team),
    );
  if (!confirmed) {
    throw new Error("Starter form creation could not be confirmed. Refresh to check the saved forms before retrying.");
  }
  return body;
}
