import type { PoolClient } from "@neondatabase/serverless";
import type { ContextItem } from "./index";

/**
 * Real org/session facts injected into Soft-UI chat prompts.
 * Never invents DEMO metrics — only fields present in the DB row.
 */

export type OrgSessionFacts = {
  orgName: string | null;
  teamNumber: number | null;
  activeEventKey: string | null;
  seasonYear: number | null;
  teamAffiliation: string | null;
  schoolFunded: boolean | null;
  sponsorsAllowed: boolean | null;
  privacyScope?: "private" | "team";
  capability?: string;
};

export type OrgSessionContextItem = ContextItem & {
  classification: "hard_metric";
};

/** Pure formatter — skips null/empty fields; no fabricated values. */
export function formatOrgSessionContext(facts: OrgSessionFacts): string | null {
  const parts: string[] = [];
  if (facts.orgName?.trim()) parts.push(`Organization: ${facts.orgName.trim()}`);
  if (facts.teamNumber !== null && Number.isFinite(facts.teamNumber)) {
    parts.push(`FRC team number: ${facts.teamNumber}`);
  }
  if (facts.activeEventKey?.trim()) {
    parts.push(`Active event: ${facts.activeEventKey.trim()}`);
  }
  if (facts.seasonYear !== null && Number.isFinite(facts.seasonYear)) {
    parts.push(`Season year: ${facts.seasonYear}`);
  }
  if (facts.teamAffiliation?.trim()) {
    parts.push(`Team affiliation: ${facts.teamAffiliation.trim()}`);
  }
  if (facts.schoolFunded !== null) {
    parts.push(`School-funded: ${facts.schoolFunded ? "yes" : "no"}`);
  }
  if (facts.sponsorsAllowed !== null) {
    parts.push(`Sponsors tools allowed: ${facts.sponsorsAllowed ? "yes" : "no"}`);
  }
  if (facts.privacyScope) parts.push(`Chat privacy scope: ${facts.privacyScope}`);
  if (facts.capability?.trim()) parts.push(`Capability: ${facts.capability.trim()}`);

  if (parts.length === 0) return null;
  return [
    "Workspace session context (authoritative org flags — do not invent competition results):",
    ...parts.map((line) => `- ${line}`),
  ].join("\n");
}

/** High-importance context item for buildUnifiedContext, or null when nothing real to inject. */
export function buildOrgSessionContextItem(facts: OrgSessionFacts): OrgSessionContextItem | null {
  const content = formatOrgSessionContext(facts);
  if (!content) return null;
  return {
    type: "module_data",
    id: "org-session",
    content,
    importance: 950,
    classification: "hard_metric",
  };
}

/** Load real org + active-event fields for prompt injection (RLS client). */
export async function loadOrgSessionFacts(
  client: PoolClient,
  orgId: string,
): Promise<OrgSessionFacts> {
  const result = await client.query<{
    orgName: string | null;
    teamNumber: number | null;
    teamAffiliation: string | null;
    schoolFunded: boolean | null;
    sponsorsAllowed: boolean | null;
    activeEventKey: string | null;
    seasonYear: number | null;
  }>(
    `SELECT o.name AS "orgName",
            o.team_number AS "teamNumber",
            o.team_affiliation AS "teamAffiliation",
            o.school_funded AS "schoolFunded",
            o.sponsors_allowed AS "sponsorsAllowed",
            c.active_event_key AS "activeEventKey",
            e.year AS "seasonYear"
       FROM organizations o
       LEFT JOIN org_active_context c ON c.org_id = o.id
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
      WHERE o.id = $1::uuid`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      orgName: null,
      teamNumber: null,
      activeEventKey: null,
      seasonYear: null,
      teamAffiliation: null,
      schoolFunded: null,
      sponsorsAllowed: null,
    };
  }
  const teamNumber =
    row.teamNumber === null || row.teamNumber === undefined ? null : Number(row.teamNumber);
  const seasonYear =
    row.seasonYear === null || row.seasonYear === undefined ? null : Number(row.seasonYear);
  return {
    orgName: row.orgName?.trim() || null,
    teamNumber: teamNumber !== null && Number.isFinite(teamNumber) ? teamNumber : null,
    activeEventKey: row.activeEventKey?.trim() || null,
    seasonYear: seasonYear !== null && Number.isFinite(seasonYear) ? seasonYear : null,
    teamAffiliation: row.teamAffiliation?.trim() || null,
    schoolFunded: row.schoolFunded ?? null,
    sponsorsAllowed: row.sponsorsAllowed ?? null,
  };
}
