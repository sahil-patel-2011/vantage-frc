import { requestPool } from "@vantage/db";

export async function GET(request: Request) {
  const url = new URL(request.url); const orgId = url.searchParams.get("orgId"); const surface = url.searchParams.get("surface");
  if (!orgId || !surface) return Response.json([]);
  try { const result = await requestPool.query<{ placements: unknown }>("SELECT get_public_partner_placements($1::uuid,$2) AS placements", [orgId, surface]); return Response.json({ placements: result.rows[0]?.placements ?? [] }); }
  catch { return Response.json({ placements: [] }); }
}
