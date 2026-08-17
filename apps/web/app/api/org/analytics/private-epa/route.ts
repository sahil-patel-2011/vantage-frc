import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const eventParam = url.searchParams.get("event");

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; eventKey: string | null }>(
        `SELECT m.org_id AS "orgId", c.active_event_key AS "eventKey"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         LEFT JOIN org_active_context c ON c.org_id = o.id
         WHERE m.user_id = $1
           AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const orgId = membership.rows[0]?.orgId;
      const eventKey = eventParam?.trim() || membership.rows[0]?.eventKey;
      if (!orgId || !eventKey) {
        return {
          status: "setup_required" as const,
          message: "Select a workspace and event before reading org-private analytics.",
          orgId: orgId ?? null,
          eventKey: eventKey ?? null,
          teams: [],
        };
      }

      const [snapshots, calibrations, pit] = await Promise.all([
        client.query<{
          teamKey: string;
          publicEpa: number;
          pepa: number;
          scoutComponentEpa: number;
          scoutSample: number;
          components: Record<string, unknown>;
          computedAt: string;
        }>(
          `SELECT team_key AS "teamKey", public_epa::float AS "publicEpa", pepa::float AS pepa,
                  scout_component_epa::float AS "scoutComponentEpa", scout_sample AS "scoutSample",
                  components, computed_at::text AS "computedAt"
           FROM private_epa_snapshots
           WHERE org_id = $1 AND event_key = $2
           ORDER BY pepa DESC`,
          [orgId, eventKey],
        ),
        client.query<{
          fieldKey: string;
          scoutUserId: string;
          agreementRate: number;
          nSamples: number;
        }>(
          `SELECT field_key AS "fieldKey", scout_user_id::text AS "scoutUserId",
                  agreement_rate::float AS "agreementRate", n_samples AS "nSamples"
           FROM scout_field_reliability
           WHERE org_id = $1 AND event_key = $2
           ORDER BY n_samples DESC
           LIMIT 40`,
          [orgId, eventKey],
        ),
        client.query<{
          teamKey: string;
          matchKey: string | null;
          signalKind: string;
          note: string;
          createdAt: string;
        }>(
          `SELECT team_key AS "teamKey", match_key AS "matchKey", signal_kind AS "signalKind",
                  note, created_at::text AS "createdAt"
           FROM scout_pit_signals
           WHERE org_id = $1 AND event_key = $2
           ORDER BY created_at DESC
           LIMIT 40`,
          [orgId, eventKey],
        ),
      ]);

      if (!snapshots.rows.length) {
        return {
          status: "empty" as const,
          message:
            "No org pEPA snapshots yet. Scout 3+ matches per team and open Strategy — pEPA is never invented from public scores alone.",
          orgId,
          eventKey,
          teams: [],
          calibrations: calibrations.rows,
          pitSignals: pit.rows,
        };
      }

      return {
        status: "live" as const,
        message: "Org-private analytics. Not shared. Not Statbotics.",
        orgId,
        eventKey,
        teams: snapshots.rows.map((row) => ({
          team: Number(row.teamKey.replace(/^frc/i, "")) || row.teamKey,
          teamKey: row.teamKey,
          pEPA: row.pepa,
          publicEpa: row.publicEpa,
          scoutComponentEpa: row.scoutComponentEpa,
          climb_reliability: typeof row.components?.endgameRate === "number" ? row.components.endgameRate : null,
          cycle_time_p50:
            typeof row.components?.cycleTimeSeconds === "number" ? row.components.cycleTimeSeconds : null,
          scoutSample: row.scoutSample,
          computedAt: row.computedAt,
        })),
        calibrations: calibrations.rows,
        pitSignals: pit.rows,
      };
    });
    return Response.json(view);
  } catch {
    return Response.json({
      status: "setup_required",
      message: "Private analytics tables are not available yet. Apply migration 0430.",
      orgId: null,
      eventKey: null,
      teams: [],
    });
  }
}
