// Tokenized public read of a published Sponsor Wall — same mechanism as /api/support/[publicId]:
// no session, dedicated SECURITY DEFINER function, unguessable uuid public_id. Read-only.
import { requestPool } from "@vantage/db";

export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  try {
    const result = await requestPool.query<{ wall: unknown }>(
      "SELECT get_public_sponsor_wall($1::uuid) AS wall",
      [publicId],
    );
    if (!result.rows[0]?.wall) {
      return Response.json({ error: "This sponsor wall is unavailable." }, { status: 404 });
    }
    return Response.json(result.rows[0].wall, { headers: { "cache-control": "public, max-age=60" } });
  } catch {
    return Response.json({ error: "This sponsor wall is unavailable." }, { status: 404 });
  }
}
