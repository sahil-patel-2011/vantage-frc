import {
  intelErrorResponse,
  IntelHttpError,
  intelSession,
  withIntelRequest,
} from "../../../../lib/intel-auth";
import { requestOrigin } from "../../../../lib/products/products";
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function response(body: unknown) {
  return Response.json(body, {
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId || !isUuid(orgId))
      throw new IntelHttpError(400, "Choose a valid team.");
    return response(
      await withIntelRequest(orgId, async (client) => {
        const result = await client.query<{
          enabled: boolean;
          canManage: boolean;
        }>(
          `SELECT COALESCE((SELECT enabled FROM org_scouting_sharing WHERE org_id=$1),true) AS enabled,
          has_org_capability($1, 'manage_scouting'::org_capability) AS "canManage"`,
          [orgId],
        );
        return result.rows[0];
      }),
    );
  } catch (error) {
    return intelErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== requestOrigin(request))
      throw new IntelHttpError(403, "Open Vantage to change this setting.");
    const body = await request.json().catch(() => null);
    if (!body || !isUuid(body.orgId) || typeof body.enabled !== "boolean")
      throw new IntelHttpError(400, "A team and sharing choice are required.");
    const session = await intelSession();
    return response(
      await withIntelRequest(body.orgId, async (client) => {
        const permission = await client.query<{ allowed: boolean }>(
          "SELECT has_org_capability($1, 'manage_scouting'::org_capability) AS allowed",
          [body.orgId],
        );
        if (!permission.rows[0]?.allowed)
          throw new IntelHttpError(
            403,
            "Scouting lead access is required to change scouting sharing.",
          );
        const result = await client.query(
          `INSERT INTO org_scouting_sharing(org_id,enabled,updated_by) VALUES($1,$2,$3)
         ON CONFLICT(org_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING enabled`,
          [body.orgId, body.enabled, session.user.id],
        );
        return { ...result.rows[0], canManage: true };
      }),
    );
  } catch (error) {
    return intelErrorResponse(error);
  }
}
