import { assertPlatformAdmin, auth, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { RecipientsMigrationMissingError, refreshRecipientSnapshot } from "../../../../lib/outage/recipient-refresh";
import { readRecipientMeta, snapshotIsStale } from "../../../../lib/outage/recipients";
import { getOutageStore, OutageSecretMissingError } from "../../../../lib/outage/status-store";

export const dynamic = "force-dynamic";

/**
 * The outage contact list — the sealed copy of everyone's email address the outage console
 * sends from while the database is down. GET says how many and how fresh; POST refreshes it now.
 * Platform admins only.
 */
async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  await withRls({ userId: session.user.id }, (client) => assertPlatformAdmin(client));
  return session;
}

function view(meta: Awaited<ReturnType<typeof readRecipientMeta>>) {
  const store = getOutageStore();
  return {
    count: meta?.count ?? null,
    refreshedAt: meta?.refreshedAt ?? null,
    stale: snapshotIsStale(meta),
    sharedStore: store.kind === "upstash",
  };
}

export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
  const meta = await readRecipientMeta(getOutageStore()).catch(() => null);
  return Response.json(view(meta), { headers: { "cache-control": "private, no-store" } });
}

export async function POST() {
  let userId: string;
  try {
    userId = (await requireAdmin()).user.id;
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
  try {
    const meta = await refreshRecipientSnapshot(userId);
    return Response.json(view(meta), { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof RecipientsMigrationMissingError || error instanceof OutageSecretMissingError;
    return Response.json(
      { error: known ? error.message : "The contact list couldn't be refreshed. Try again in a minute." },
      { status: known ? 503 : 502, headers: { "cache-control": "private, no-store" } },
    );
  }
}
