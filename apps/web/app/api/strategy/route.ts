import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import {
  buildStrategyPlaybook,
  predictMatch,
  type MatchPrediction,
  type TeamSeasonSignal,
} from "@vantage/prediction-strategy";
import { headers } from "next/headers";
import type { StrategyView } from "../../../lib/strategy/types";

export type { StrategyView };

function allianceKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: string[] }).teamKeys;
  return Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const tbaConfigured = Boolean(process.env.TBA_AUTH_KEY?.trim());

  try {
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        teamNumber: number | null;
        eventKey: string | null;
        eventName: string | null;
      }>(
        `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber",
                c.active_event_key AS "eventKey", e.name AS "eventName"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         LEFT JOIN org_active_context c ON c.org_id = o.id
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE m.user_id = $1
           AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      const baseSteps = [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Choose your team organization",
          href: "/workspace",
          done: Boolean(row?.orgId),
        },
        {
          id: "event",
          label: "Select event / location",
          detail: "Set the active competition context",
          href: "/workspace",
          done: Boolean(row?.eventKey),
        },
        {
          id: "tba",
          label: "Sync TBA",
          detail: "Match schedule and team metrics from TBA/Statbotics",
          href: "/admin/connectors",
          done: tbaConfigured,
        },
      ];

      if (!row?.orgId) {
        return {
          status: "setup_required",
          message: "Select a team workspace before running win/loss strategy.",
          steps: baseSteps,
          orgId: null,
          eventKey: null,
          eventName: null,
          teamNumber: null,
          tbaConfigured,
        } satisfies StrategyView;
      }

      if (!row.eventKey || !row.teamNumber) {
        return {
          status: "setup_required",
          message: "Select an active event and team number to load a match schedule.",
          steps: baseSteps,
          orgId: row.orgId,
          eventKey: row.eventKey,
          eventName: row.eventName,
          teamNumber: row.teamNumber,
          tbaConfigured,
        } satisfies StrategyView;
      }

      if (!tbaConfigured) {
        return {
          status: "setup_required",
          message: "TBA is not configured. Set TBA_AUTH_KEY or save a platform TBA credential before expecting live schedule/metrics.",
          steps: baseSteps,
          orgId: row.orgId,
          eventKey: row.eventKey,
          eventName: row.eventName,
          teamNumber: row.teamNumber,
          tbaConfigured,
        } satisfies StrategyView;
      }

      const teamKey = `frc${row.teamNumber}`;
      const match = await client.query<{
        matchKey: string;
        compLevel: string;
        matchNumber: number;
        year: number | null;
        redAlliance: unknown;
        blueAlliance: unknown;
      }>(
        `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
                e.year, m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
         FROM matches_ref m
         JOIN events_ref e ON e.event_key = m.event_key
         WHERE m.event_key = $1
           AND (
             m.red_alliance->'teamKeys' ? $2
             OR m.blue_alliance->'teamKeys' ? $2
           )
           AND COALESCE(m.actual_time, m.predicted_time, m.event_time) > now() - interval '6 hours'
         ORDER BY COALESCE(m.actual_time, m.predicted_time, m.event_time)
         LIMIT 1`,
        [row.eventKey, teamKey],
      );

      const upcoming = match.rows[0];
      if (!upcoming) {
        return {
          status: "empty",
          message:
            "No prediction yet — need a match schedule for your team at this event from TBA, plus team metrics.",
          steps: baseSteps.map((step) => ({ ...step, done: true })),
          orgId: row.orgId,
          eventKey: row.eventKey,
          eventName: row.eventName,
          teamNumber: row.teamNumber,
          tbaConfigured,
        } satisfies StrategyView;
      }

      const red = allianceKeys(upcoming.redAlliance);
      const blue = allianceKeys(upcoming.blueAlliance);
      const allTeams = [...new Set([...red, ...blue])];
      if (red.length < 1 || blue.length < 1) {
        return {
          status: "empty",
          message: "Match alliances are incomplete in the synced schedule. Wait for TBA sync or pick another match.",
          steps: baseSteps,
          orgId: row.orgId,
          eventKey: row.eventKey,
          eventName: row.eventName,
          teamNumber: row.teamNumber,
          tbaConfigured,
        } satisfies StrategyView;
      }

      const year = upcoming.year ?? new Date().getFullYear();
      const metrics = await client.query<{
        teamKey: string;
        epaTotal: number | null;
        epaAuto: number | null;
        epaEndgame: number | null;
        source: string;
        syncedAt: string | null;
        matchesHint: number | null;
      }>(
        `SELECT DISTINCT ON (team_key)
            team_key AS "teamKey",
            epa_total AS "epaTotal",
            epa_auto AS "epaAuto",
            epa_endgame AS "epaEndgame",
            source,
            synced_at::text AS "syncedAt",
            NULLIF((source_payload->>'matches')::int, 0) AS "matchesHint"
         FROM team_event_metrics
         WHERE event_key = $1 AND team_key = ANY($2::text[])
         ORDER BY team_key,
           CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END,
           synced_at DESC NULLS LAST`,
        [row.eventKey, allTeams],
      );

      const seasons: TeamSeasonSignal[] = [];
      const sources: Array<{ source: string; syncedAt: string | null; teamKey: string }> = [];
      for (const metric of metrics.rows) {
        if (metric.epaTotal == null) continue;
        seasons.push({
          teamKey: metric.teamKey,
          year,
          matches: metric.matchesHint && metric.matchesHint > 0 ? metric.matchesHint : 8,
          epa: metric.epaTotal,
          autoEpa: metric.epaAuto ?? undefined,
          endgameEpa: metric.epaEndgame ?? undefined,
        });
        sources.push({
          source: metric.source,
          syncedAt: metric.syncedAt,
          teamKey: metric.teamKey,
        });
      }

      if (seasons.length < Math.min(4, allTeams.length)) {
        return {
          status: "empty",
          message:
            "No prediction yet — need match schedule + team metrics from TBA/Statbotics/scouting before the model can run.",
          steps: baseSteps,
          orgId: row.orgId,
          eventKey: row.eventKey,
          eventName: row.eventName,
          teamNumber: row.teamNumber,
          tbaConfigured,
        } satisfies StrategyView;
      }

      const stored = await client.query<{
        matchKey: string;
        pRed: number;
        pBlue: number;
        confidenceLow: number;
        confidenceHigh: number;
        modelVersion: string;
        keyFactors: unknown;
        caveats: unknown;
        effectiveSampleSize: number | null;
        scoredAt: string;
      }>(
        `SELECT match_key AS "matchKey", p_red AS "pRed", p_blue AS "pBlue",
                confidence_low AS "confidenceLow", confidence_high AS "confidenceHigh",
                model_version AS "modelVersion", key_factors AS "keyFactors",
                caveats, effective_sample_size AS "effectiveSampleSize",
                scored_at::text AS "scoredAt"
         FROM predictions
         WHERE org_id = $1 AND match_key = $2
         ORDER BY scored_at DESC
         LIMIT 1`,
        [row.orgId, upcoming.matchKey],
      );

      const storedRow = stored.rows[0];
      const prediction: MatchPrediction =
        storedRow && storedRow.modelVersion === "weighted-current-v1"
          ? {
              matchKey: storedRow.matchKey,
              modelVersion: "weighted-current-v1",
              pRed: storedRow.pRed,
              pBlue: storedRow.pBlue,
              confidenceLow: storedRow.confidenceLow,
              confidenceHigh: storedRow.confidenceHigh,
              effectiveSampleSize: storedRow.effectiveSampleSize ?? 0,
              keyFactors: Array.isArray(storedRow.keyFactors)
                ? (storedRow.keyFactors as MatchPrediction["keyFactors"])
                : [],
              caveats: asStringArray(storedRow.caveats).length
                ? asStringArray(storedRow.caveats)
                : ["Stored organization prediction."],
            }
          : predictMatch({
              matchKey: upcoming.matchKey,
              currentYear: year,
              red,
              blue,
              seasons,
            });

      const ourAlliance = red.includes(teamKey) ? "red" : "blue";
      const playbook = buildStrategyPlaybook({
        prediction,
        ourAlliance,
        opponentFoulRisk: "unknown",
      });

      return {
        status: "live",
        orgId: row.orgId,
        eventKey: row.eventKey,
        eventName: row.eventName,
        teamNumber: row.teamNumber,
        tbaConfigured,
        matchKey: upcoming.matchKey,
        compLevel: upcoming.compLevel,
        matchNumber: upcoming.matchNumber,
        prediction,
        playbook,
        sources,
        computedAt: storedRow?.scoredAt ?? new Date().toISOString(),
      } satisfies StrategyView;
    });

    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load strategy context. Select a workspace and confirm database access.",
        steps: [
          { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
          { id: "event", label: "Select event / location", detail: "Set the active competition context", href: "/workspace" },
          { id: "tba", label: "Sync TBA", detail: "Match schedule and team metrics", href: "/admin/connectors" },
        ],
        orgId: null,
        eventKey: null,
        eventName: null,
        teamNumber: null,
        tbaConfigured,
      } satisfies StrategyView,
      { status: 200 },
    );
  }
}
