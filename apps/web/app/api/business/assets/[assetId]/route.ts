import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  const { assetId } = await params;
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  try {
    const asset = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query<{ imageBytes: Uint8Array; mediaType: string }>(
        `SELECT bytes AS "imageBytes", media_type AS "mediaType" FROM sponsor_assets WHERE id = $1 AND org_id = $2`, [assetId, orgId],
      );
      return result.rows[0] ?? null;
    });
    if (!asset) return new Response(null, { status: 404 });
    const body = new ArrayBuffer(asset.imageBytes.byteLength);
    new Uint8Array(body).set(asset.imageBytes);
    return new Response(body, { headers: { "content-type": asset.mediaType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch {
    return Response.json({ error: "Artwork unavailable" }, { status: 400 });
  }
}
