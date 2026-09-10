import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import {
  briefDateKey,
  buildEpaMovers,
  buildOvernightSummaryText,
  mapBriefRow,
  summarizeResearchFindings,
  summarizeScoutingActivity,
  type RawEpaRow,
  type RawEpaSnapshotRow,
  type RawResearchFindingRow,
  type RawScoutingActivityRow,
} from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { OvernightIntelBrief, OvernightIntelSetupStep, OvernightIntelSignals } from "./types";

export const OVERNIGHT_INTEL_FEATURE = "overnight_intel";
export const OVERNIGHT_INTEL_MODEL = "vantage-overnight-intel-v1";

export type OvernightIntelView =
  | {
      status: "setup_required";
      message: string;
      steps: OvernightIntelSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string;
      eventName: string;
      seasonYear: number;
      latestBrief: OvernightIntelBrief | null;
      briefs: OvernightIntelBrief[];
      signals: OvernightIntelSignals;
      computedAt: string;
    };

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO overnight metrics. */
function workspaceSetupSteps(orgId: string | null): OvernightIntelSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open Overnight Intel.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Event Day stays blank until real schedule data exists.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists stay empty until real metrics exist.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ];
}

function activeEventSetupSteps(orgId: string): OvernightIntelSetupStep[] {
  return [
    {
      id: "active-event",
      label: "Set active event",
      detail: "Choose the event your team is competing at.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Confirm schedule context once an active event is set.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Event strategy stays available beside overnight digests.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ];
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

async function resolveActiveEvent(
  client: PoolClient,
  orgId: string,
): Promise<{ eventKey: string; eventName: string; seasonYear: number } | null> {
  const row = await client.query<{ eventKey: string; eventName: string; seasonYear: number }>(
    `SELECT c.active_event_key AS "eventKey", e.name AS "eventName", e.year AS "seasonYear"
     FROM org_active_context c
     JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE c.org_id = $1 AND c.active_event_key IS NOT NULL`,
    [orgId],
  );
  return row.rows[0] ?? null;
}

/** Pulls the raw "what changed" signals for an org's active event, scoped by the caller's RLS session. */
async function gatherOvernightSignals(
  client: PoolClient,
  input: { orgId: string; eventKey: string; sinceIso: string },
): Promise<OvernightIntelSignals> {
  const [researchResult, currentEpaResult, previousEpaResult, scoutingResult] = await Promise.all([
    client.query<RawResearchFindingRow>(
      `SELECT rf.team_key AS "teamKey", t.team_number AS "teamNumber", rf.source_title AS "title",
              rf.summary, rf.source_type::text AS "sourceType", rf.source_url AS "sourceUrl",
              rf.found_at::text AS "foundAt"
       FROM research_findings rf
       JOIN teams_ref t ON t.team_key = rf.team_key
       WHERE rf.found_at > $2::timestamptz
         AND rf.team_key IN (SELECT team_key FROM team_event_metrics WHERE event_key = $1)
       ORDER BY rf.found_at DESC
       LIMIT 50`,
      [input.eventKey, input.sinceIso],
    ),
    client.query<RawEpaRow>(
      `SELECT DISTINCT ON (tem.team_key) tem.team_key AS "teamKey", t.team_number AS "teamNumber",
              tem.epa_total AS "epaTotal"
       FROM team_event_metrics tem
       JOIN teams_ref t ON t.team_key = tem.team_key
       WHERE tem.event_key = $1 AND tem.epa_total IS NOT NULL
       ORDER BY tem.team_key, tem.synced_at DESC`,
      [input.eventKey],
    ),
    client.query<RawEpaSnapshotRow>(
      `SELECT DISTINCT ON (team_key) team_key AS "teamKey", epa_total AS "epaTotal", captured_at::text AS "capturedAt"
       FROM overnight_intel_epa_snapshots
       WHERE org_id = $1 AND event_key = $2
       ORDER BY team_key, captured_at DESC`,
      [input.orgId, input.eventKey],
    ),
    client.query<RawScoutingActivityRow>(
      `SELECT mse.team_key AS "teamKey", t.team_number AS "teamNumber", COUNT(*)::int AS "newEntries",
              MAX(mse.created_at)::text AS "lastScoutedAt"
       FROM match_scout_entries mse
       JOIN teams_ref t ON t.team_key = mse.team_key
       WHERE mse.org_id = $1 AND mse.event_key = $2 AND mse.created_at > $3::timestamptz
       GROUP BY mse.team_key, t.team_number`,
      [input.orgId, input.eventKey, input.sinceIso],
    ),
  ]);

  return {
    researchHighlights: summarizeResearchFindings(researchResult.rows),
    epaMovers: buildEpaMovers(currentEpaResult.rows, previousEpaResult.rows),
    scoutingHighlights: summarizeScoutingActivity(scoutingResult.rows),
  };
}

type BriefRow = {
  id: string;
  eventKey: string;
  seasonYear: number;
  briefDate: string;
  summary: string;
  researchHighlights: unknown;
  epaMovers: unknown;
  scoutingHighlights: unknown;
  generatedAt: string;
};

const BRIEF_SELECT = `SELECT id, event_key AS "eventKey", season_year AS "seasonYear", brief_date::text AS "briefDate",
       summary, research_highlights AS "researchHighlights", epa_movers AS "epaMovers",
       scouting_highlights AS "scoutingHighlights", created_at::text AS "generatedAt"
       FROM overnight_intel_briefs`;

export async function computeOvernightIntelView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<OvernightIntelView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to view the overnight event-intel brief.",
      steps: workspaceSetupSteps(null),
      orgId: null,
    };
  }

  const activeEvent = await resolveActiveEvent(client, org.orgId);
  if (!activeEvent) {
    return {
      status: "setup_required",
      message: "Set your active event to compile an overnight intel brief.",
      steps: activeEventSetupSteps(org.orgId),
      orgId: org.orgId,
    };
  }

  const [briefsResult] = await Promise.all([
    client.query<BriefRow>(
      `${BRIEF_SELECT} WHERE org_id = $1 AND event_key = $2 ORDER BY brief_date DESC LIMIT 14`,
      [org.orgId, activeEvent.eventKey],
    ),
  ]);
  const briefs = briefsResult.rows.map(mapBriefRow);
  const latestBrief = briefs[0] ?? null;

  const sinceIso = latestBrief?.generatedAt ?? new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const signals = await gatherOvernightSignals(client, { orgId: org.orgId, eventKey: activeEvent.eventKey, sinceIso });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey: activeEvent.eventKey,
    eventName: activeEvent.eventName,
    seasonYear: activeEvent.seasonYear,
    latestBrief,
    briefs,
    signals,
    computedAt: new Date().toISOString(),
  };
}

/** Compiles and stores tonight's brief (metered) for the org's active event. Run from the API `generate-brief` action or a cron worker. */
export async function generateOvernightIntelBrief(
  client: PoolClient,
  input: { orgId: string; userId: string; requestId: string },
): Promise<OvernightIntelBrief> {
  const activeEvent = await resolveActiveEvent(client, input.orgId);
  if (!activeEvent) throw new Error("Set an active event before generating an overnight intel brief");

  const lastBrief = await client.query<{ generatedAt: string }>(
    `SELECT created_at::text AS "generatedAt" FROM overnight_intel_briefs
     WHERE org_id = $1 AND event_key = $2 ORDER BY brief_date DESC LIMIT 1`,
    [input.orgId, activeEvent.eventKey],
  );
  const sinceIso = lastBrief.rows[0]?.generatedAt ?? new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const signals = await gatherOvernightSignals(client, {
    orgId: input.orgId,
    eventKey: activeEvent.eventKey,
    sinceIso,
  });

  const briefDate = briefDateKey();
  const promptTokens = Math.ceil(
    (signals.researchHighlights.length + signals.epaMovers.length + signals.scoutingHighlights.length) * 40 + 200,
  );

  const summary = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: OVERNIGHT_INTEL_FEATURE,
    requestId: input.requestId,
    estimatedCostUsd: 0,
    estimatedPromptTokens: promptTokens,
    estimatedCompletionTokens: 180,
    provider: "local",
    model: OVERNIGHT_INTEL_MODEL,
    metadata: {
      eventKey: activeEvent.eventKey,
      briefDate,
      researchCount: signals.researchHighlights.length,
      epaMoverCount: signals.epaMovers.length,
      scoutingCount: signals.scoutingHighlights.length,
    },
    invoke: async () => {
      const text = buildOvernightSummaryText({
        eventName: activeEvent.eventName,
        briefDate,
        researchHighlights: signals.researchHighlights,
        epaMovers: signals.epaMovers,
        scoutingHighlights: signals.scoutingHighlights,
      });
      return {
        value: text,
        promptTokens,
        completionTokens: Math.ceil(text.length / 4),
        costUsd: 0,
        model: OVERNIGHT_INTEL_MODEL,
        provider: "local",
      };
    },
  });

  const inserted = await client.query<BriefRow>(
    `INSERT INTO overnight_intel_briefs
       (org_id, event_key, season_year, brief_date, summary, research_highlights, epa_movers, scouting_highlights, generated_by)
     VALUES ($1,$2,$3,$4::date,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)
     ON CONFLICT (org_id, event_key, brief_date) DO UPDATE SET
       summary = EXCLUDED.summary,
       research_highlights = EXCLUDED.research_highlights,
       epa_movers = EXCLUDED.epa_movers,
       scouting_highlights = EXCLUDED.scouting_highlights
     RETURNING id, event_key AS "eventKey", season_year AS "seasonYear", brief_date::text AS "briefDate",
       summary, research_highlights AS "researchHighlights", epa_movers AS "epaMovers",
       scouting_highlights AS "scoutingHighlights", created_at::text AS "generatedAt"`,
    [
      input.orgId,
      activeEvent.eventKey,
      activeEvent.seasonYear,
      briefDate,
      summary,
      JSON.stringify(signals.researchHighlights),
      JSON.stringify(signals.epaMovers),
      JSON.stringify(signals.scoutingHighlights),
      input.userId,
    ],
  );

  // Snapshot every team's current EPA (not just movers) so tomorrow's brief can diff against it.
  const currentEpaRows = await client.query<{ teamKey: string; epaTotal: number }>(
    `SELECT DISTINCT ON (team_key) team_key AS "teamKey", epa_total AS "epaTotal"
     FROM team_event_metrics
     WHERE event_key = $1 AND epa_total IS NOT NULL
     ORDER BY team_key, synced_at DESC`,
    [activeEvent.eventKey],
  );
  for (const row of currentEpaRows.rows) {
    await client.query(
      `INSERT INTO overnight_intel_epa_snapshots (org_id, event_key, team_key, epa_total)
       VALUES ($1,$2,$3,$4)`,
      [input.orgId, activeEvent.eventKey, row.teamKey, row.epaTotal],
    );
  }

  return mapBriefRow(inserted.rows[0]!);
}
