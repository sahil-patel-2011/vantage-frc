import { isMirrorNotMigrated, MIRROR_NOT_MIGRATED_MESSAGE } from "./connection-store";
import { HttpError } from "../microsoft/authz";
import { json } from "../microsoft/route-helpers";

/** Where Connect Google Sheets lands afterwards: Connectors, scrolled to the mirror card. */
export function googleConnectorsRedirect(
  base: string,
  orgId: string | null,
  status: "connected" | "error",
  reason?: string,
): Response {
  const params = new URLSearchParams();
  if (orgId) params.set("orgId", orgId);
  params.set("google", status);
  if (reason) params.set("reason", reason);
  return Response.redirect(`${base}/connectors?${params.toString()}#spreadsheet-mirror`, 303);
}

/** failJson, plus the mirror's own "migration 0682 is not applied yet" state. */
export function mirrorFailJson(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, code: error.code }, error.status);
  if (isMirrorNotMigrated(error)) {
    return json({ error: MIRROR_NOT_MIGRATED_MESSAGE, code: "not_migrated", setupRequired: true }, 503);
  }
  console.error("[spreadsheet-mirror]", error instanceof Error ? error.name : typeof error);
  return json({ error: "The request failed. Try again in a moment.", code: "failed" }, 500);
}
