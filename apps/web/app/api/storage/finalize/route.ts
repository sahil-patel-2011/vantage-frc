// Upload finalize: the browser reports that the node accepted (and hash-
// verified) the bytes. The grant is consumed (idempotent — retries are safe),
// the node item flips to 'stored' with verified_at NULL, and the feature row
// becomes 'ready'. The node's own heartbeat scrub then independently confirms
// the bytes exist — a client that lies here is corrected within minutes and
// the item honestly shows as missing.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { finalizeUploadGrant } from "../../../../lib/storage-routing/store";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = typeof body.orgId === "string" ? body.orgId.trim().slice(0, 64) : "";
  const grantId = typeof body.grantId === "string" ? body.grantId.trim().slice(0, 64) : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (!grantId) return Response.json({ error: "grantId is required" }, { status: 400 });

  const userId = session.user.id;
  try {
    const result = await withRls({ userId, orgId }, (client) =>
      finalizeUploadGrant(client, { orgId, grantId, userId }),
    );
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true, purpose: result.purpose, targetId: result.targetId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finalize failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
