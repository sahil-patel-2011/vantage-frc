import { json } from "../../../../../lib/microsoft/route-helpers";
import type { ImportFailure } from "../../../../../lib/microsoft/run-import";

/** Plain-language responses for the ways an import can stop before it starts. */
export function importFailureResponse(result: Exclude<ImportFailure, { status: "not_migrated" }>): Response {
  switch (result.status) {
    case "not_connected":
      return json({ error: "Connect a Microsoft account first.", code: "not_connected" }, 409);
    case "no_workbook":
      return json(
        { error: "Vantage cannot find the team's workbook in OneDrive. Press Sync now to create it, then import.", code: "no_workbook" },
        409,
      );
    case "reconnect_required":
    case "encryption_unavailable":
      return json({ error: result.error, code: result.status }, 409);
    case "microsoft_unavailable":
    case "microsoft_error":
      return json({ error: result.error, code: result.status }, 502);
  }
}
