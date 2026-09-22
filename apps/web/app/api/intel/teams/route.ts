import { IntelResearchRepository } from "@vantage/intel-research/repository";
import { intelErrorResponse, intelSession, withIntelRequest } from "../../../../lib/intel-auth";
import type { EventRatingRow } from "../../../../lib/intel/lovat-lookup";
import { canEditLookupNotes, parseLookupNote } from "../../../../lib/intel/lookup-notes";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const query = url.searchParams.get("q")?.trim();
    const teamNumber = Number(url.searchParams.get("team"));
    return Response.json(
      await withIntelRequest(orgId, async (client) => {
        const repository = new IntelResearchRepository(client);
        const activeEvent = await repository.getActiveEvent(orgId!);
        if (Number.isInteger(teamNumber) && teamNumber > 0) {
          const intel = await repository.getTeamIntel(orgId!, teamNumber);
          if (!intel) return { team: null, activeEvent };
          const [observations, similarTeams, field] = await Promise.all([
            repository.getScoutObservations(orgId!, intel.team.teamKey),
            repository.getSimilarTeams(intel.team.teamKey),
            activeEvent?.eventKey
              ? client.query<EventRatingRow>(
                  `SELECT DISTINCT ON (m.team_key)
                      m.team_key AS "teamKey",
                      m.epa_total AS "epaTotal",
                      m.epa_auto AS "epaAuto",
                      m.epa_teleop AS "epaTeleop",
                      m.epa_endgame AS "epaEndgame",
                      m.rank, m.wins, m.opr, m.dpr, m.ccwm
                   FROM team_event_metrics m
                   WHERE m.event_key = $1::text
                   ORDER BY m.team_key,
                     CASE m.source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
                     m.synced_at DESC NULLS LAST`,
                  [activeEvent.eventKey],
                )
              : Promise.resolve({ rows: [] as EventRatingRow[] }),
          ]);
          const session = await intelSession();
          const role = await client.query<{ role: string }>(
            `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
            [orgId, session.user.id],
          );
          const canEdit = canEditLookupNotes(role.rows[0]?.role ?? null);
          let lookupNote;
          try {
            const note = await client.query<{ body: string; updatedAt: string; updatedBy: string }>(
              `SELECT body, updated_at AS "updatedAt", updated_by::text AS "updatedBy"
                 FROM team_lookup_notes
                WHERE org_id = $1::uuid AND team_key = $2::text`,
              [orgId, intel.team.teamKey],
            );
            lookupNote = parseLookupNote(note.rows[0] ?? null, intel.team.teamKey, canEdit);
          } catch {
            // Keep the empty note — the table is setup-required on some deploys.
          }
          return {
            team: intel,
            scoutObservations: observations,
            similarTeams,
            activeEvent,
            fieldRatings: field.rows,
            lookupNote,
          };
        }
        if (!query) {
          // No search yet: the event's teams, so the page opens on something
          // to tap instead of an empty box.
          const roster = activeEvent?.eventKey ? await repository.eventRoster(orgId!, activeEvent.eventKey) : [];
          return { teams: [], roster, activeEvent };
        }
        return { teams: await repository.searchTeams(orgId!, query), activeEvent };
      }),
    );
  } catch (error) {
    return intelErrorResponse(error);
  }
}
