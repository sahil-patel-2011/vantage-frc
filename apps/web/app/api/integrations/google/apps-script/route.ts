import { withRls } from "@vantage/db";
import { aiKeysEncryptionStatus } from "../../../../../lib/ai-keys/kms-status";
import { checkAppsScript, saveAppsScriptConnection } from "../../../../../lib/google-sheets/connect-apps-script";
import { mirrorFailJson } from "../../../../../lib/google-sheets/route-helpers";
import { HttpError, isUuid, requireWorkbookManager } from "../../../../../lib/microsoft/authz";
import { json, requireUser } from "../../../../../lib/microsoft/route-helpers";
import { createRateLimiter, rateLimitedResponse } from "../../../../../lib/rate-limit";

export const maxDuration = 60;

/* Each attempt is one signed ping to Google. Ten per team per ten minutes covers typos. */
const connectLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, namespace: "google-apps-script-connect" });

/**
 * POST /api/integrations/google/apps-script  { orgId, url, secret }  — owner/admin.
 *
 * Connects the Google Sheets copy through the team's own Apps Script web app. The script is
 * pinged with a signed request before anything is stored; the secret is saved encrypted and
 * never returned. Works whether or not Google sign-in (OAuth) is configured on the server.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { orgId?: unknown; url?: unknown; secret?: unknown };
    const orgId = body.orgId;
    if (!isUuid(orgId)) throw new HttpError(400, "A valid orgId is required.", "invalid_team");

    const encryption = aiKeysEncryptionStatus();
    if (!encryption.ok) return json({ error: encryption.message, code: "encryption_unavailable", setupRequired: true }, 503);

    // Role first, so the rate limit is not a way to probe other teams.
    await withRls({ userId: user.id, orgId }, (client) => requireWorkbookManager(client, orgId, user.id));
    if (!(await connectLimiter.allow(orgId))) {
      return rateLimitedResponse("This team has tried to connect several times in the last few minutes. Wait a little and try again.");
    }

    // The network check runs outside the transaction.
    const check = await checkAppsScript({ url: body.url, secret: body.secret });
    if (!check.ok) return json({ error: check.error, code: check.code }, check.code === "unreachable" ? 502 : 400);

    await withRls({ userId: user.id, orgId }, async (client) => {
      await requireWorkbookManager(client, orgId, user.id);
      await saveAppsScriptConnection(client, { orgId, userId: user.id, check });
    });
    return json({ ok: true, name: check.name, fileUrl: check.fileUrl });
  } catch (error) {
    return mirrorFailJson(error);
  }
}
