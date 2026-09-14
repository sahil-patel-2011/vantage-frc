import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  DEFAULT_ANALYTICS_SOURCE,
  parseAnalyticsSource,
  parseEventKeyList,
  parseTeamKeyList,
  serializeAnalyticsSource,
  type AnalyticsSourceMode,
} from "../../../../lib/analytics/lovat-data-source";
import { canEditLookupNotes } from "../../../../lib/intel/lookup-notes";

function noStore(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

async function requireSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return noStore({ error: "Authentication required" }, 401);
  const orgId = new URL(request.url).searchParams.get("orgId")?.trim() ?? "";
  if (!orgId) return noStore({ error: "orgId is required" }, 400);
  try {
    const settings = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const row = await client.query<{ mode: string; teamKeys: string[]; eventKeys: string[] }>(
        `SELECT mode, team_keys AS "teamKeys", event_keys AS "eventKeys"
           FROM org_analytics_source WHERE org_id = $1::uuid`,
        [orgId],
      );
      return parseAnalyticsSource(row.rows[0] ?? DEFAULT_ANALYTICS_SOURCE);
    });
    return noStore({ settings });
  } catch (error) {
    return noStore({ settings: DEFAULT_ANALYTICS_SOURCE, error: error instanceof Error ? error.message : "Could not load" });
  }
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) return noStore({ error: "Authentication required" }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return noStore({ error: "Invalid JSON body" }, 400);
  }
  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) return noStore({ error: "orgId is required" }, 400);
  const parsed = serializeAnalyticsSource({
    mode: (body.mode as AnalyticsSourceMode) ?? "all",
    teamKeys: parseTeamKeyList(body.teamKeys),
    eventKeys: parseEventKeyList(body.eventKeys),
  });
  try {
    const settings = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const membership = await client.query<{ role: string }>(
        `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
        [orgId, session.user.id],
      );
      if (!canEditLookupNotes(membership.rows[0]?.role ?? null)) {
        throw Object.assign(new Error("Coach role required to change the data source."), { status: 403 });
      }
      const row = await client.query<{ mode: string; teamKeys: string[]; eventKeys: string[] }>(
        `INSERT INTO org_analytics_source (org_id, mode, team_keys, event_keys, updated_by)
         VALUES ($1::uuid, $2::text, $3::text[], $4::text[], $5::uuid)
         ON CONFLICT (org_id)
         DO UPDATE SET mode = excluded.mode, team_keys = excluded.team_keys,
           event_keys = excluded.event_keys, updated_by = excluded.updated_by, updated_at = now()
         RETURNING mode, team_keys AS "teamKeys", event_keys AS "eventKeys"`,
        [orgId, parsed.mode, parsed.teamKeys, parsed.eventKeys, session.user.id],
      );
      return parseAnalyticsSource(row.rows[0] ?? parsed);
    });
    return noStore({ settings });
  } catch (error) {
    const status = error instanceof Error && "status" in error && error.status === 403 ? 403 : 400;
    return noStore({ error: error instanceof Error ? error.message : "Could not save" }, status);
  }
}
