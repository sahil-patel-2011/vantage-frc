import type { PoolClient } from "@neondatabase/serverless";
import type { ContextItem } from "./index";

/**
 * Real org/session facts injected into product chat prompts.
 * Only fields present in the DB row are formatted. Missing sources stay absent.
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
  /**
   * The team's public dossier (TBA + Statbotics), when one has been built.
   * Only fields a source actually returned; a missing source is absent here,
   * not zero-filled.
   */
  dossier?: {
    nickname: string | null;
    location: string | null;
    rookieYear: number | null;
    seasonsCompeted: number;
    awards: Array<{ year: number; name: string }>;
    recentEvents: Array<{ year: number; name: string | null; rank: number | null; teams: number | null; record: string | null }>;
    normEpa: number | null;
    latestYear: { year: number; epa: number | null; rankWorld: number | null; teamsWorld: number | null } | null;
    computedAt: string;
  } | null;
  /** Recent CAD vault rows. Titles and links only — no fabricated mass. */
  cadVault?: Array<{
    title: string;
    kind: string;
    externalUrl: string | null;
    hasUpload: boolean;
  }>;
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

  const d = facts.dossier;
  if (d) {
    if (d.nickname) parts.push(`Team nickname: ${d.nickname}`);
    if (d.location) parts.push(`Location: ${d.location}`);
    if (d.rookieYear !== null) {
      parts.push(`Rookie year: ${d.rookieYear} (${d.seasonsCompeted} season${d.seasonsCompeted === 1 ? "" : "s"} competed per TBA)`);
    }
    if (d.normEpa !== null) parts.push(`Statbotics normalised EPA: ${d.normEpa}`);
    if (d.latestYear) {
      const y = d.latestYear;
      const rank = y.rankWorld !== null && y.teamsWorld !== null ? `, world rank ${y.rankWorld} of ${y.teamsWorld}` : "";
      parts.push(`Latest season ${y.year}: EPA ${y.epa ?? "not on record"}${rank}`);
    }
    if (d.recentEvents.length > 0) {
      parts.push(
        `Recent events: ${d.recentEvents
          .slice(0, 4)
          .map((e) => `${e.year} ${e.name ?? "event"}${e.rank !== null && e.teams !== null ? ` (rank ${e.rank}/${e.teams}${e.record ? `, ${e.record}` : ""})` : ""}`)
          .join("; ")}`,
      );
    }
    if (d.awards.length > 0) {
      parts.push(`Awards on record: ${d.awards.slice(0, 8).map((a) => `${a.year} ${a.name}`).join("; ")}${d.awards.length > 8 ? ` (+${d.awards.length - 8} more)` : ""}`);
    }
    parts.push(`Dossier from The Blue Alliance and Statbotics, as of ${d.computedAt.slice(0, 10)}`);
  }

  if (facts.cadVault && facts.cadVault.length > 0) {
    parts.push(
      `CAD vault: ${facts.cadVault
        .map((doc) => {
          const how = doc.externalUrl ? ` link ${doc.externalUrl}` : doc.hasUpload ? " uploaded file" : "";
          return `${doc.title} (${doc.kind}${how})`;
        })
        .join("; ")}`,
    );
  }

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
    dossierProfile: Record<string, unknown> | null;
    dossierYears: number[] | null;
    dossierAwards: Array<Record<string, unknown>> | null;
    dossierEvents: Array<Record<string, unknown>> | null;
    dossierStats: Record<string, unknown> | null;
    dossierAt: string | null;
  }>(
    `SELECT o.name AS "orgName",
            o.team_number AS "teamNumber",
            o.team_affiliation AS "teamAffiliation",
            o.school_funded AS "schoolFunded",
            o.sponsors_allowed AS "sponsorsAllowed",
            c.active_event_key AS "activeEventKey",
            e.year AS "seasonYear",
            d.profile AS "dossierProfile",
            d.years_participated AS "dossierYears",
            d.awards AS "dossierAwards",
            d.events AS "dossierEvents",
            d.stats AS "dossierStats",
            to_char(d.computed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "dossierAt"
       FROM organizations o
       LEFT JOIN org_active_context c ON c.org_id = o.id
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
       -- Public team dossier (0644). LEFT JOIN so a team that has not built one
       -- gets the same facts it always did, with dossier = null.
       LEFT JOIN team_dossiers d ON d.org_id = o.id AND d.status = 'ready'
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
  let cadVault: OrgSessionFacts["cadVault"];
  try {
    const vault = await client.query<{
      title: string;
      kind: string;
      externalUrl: string | null;
      currentVersion: number | null;
    }>(
      `SELECT title, kind, external_url AS "externalUrl", current_version AS "currentVersion"
         FROM cad_documents
        WHERE org_id = $1::uuid AND status = 'active'
        ORDER BY updated_at DESC
        LIMIT 8`,
      [orgId],
    );
    cadVault = vault.rows
      .map((doc) => ({
        title: doc.title.trim(),
        kind: doc.kind.trim() || "part",
        externalUrl: doc.externalUrl?.trim() || null,
        hasUpload: Number(doc.currentVersion ?? 0) > 0,
      }))
      .filter((doc) => doc.title.length > 0);
    if (cadVault.length === 0) cadVault = undefined;
  } catch {
    cadVault = undefined;
  }
  return {
    orgName: row.orgName?.trim() || null,
    teamNumber: teamNumber !== null && Number.isFinite(teamNumber) ? teamNumber : null,
    activeEventKey: row.activeEventKey?.trim() || null,
    seasonYear: seasonYear !== null && Number.isFinite(seasonYear) ? seasonYear : null,
    teamAffiliation: row.teamAffiliation?.trim() || null,
    schoolFunded: row.schoolFunded ?? null,
    sponsorsAllowed: row.sponsorsAllowed ?? null,
    dossier: dossierFacts(row),
    cadVault,
  };
}

const n = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
};
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Compact the stored dossier to the handful of facts a prompt can use. */
function dossierFacts(row: {
  dossierProfile: Record<string, unknown> | null;
  dossierYears: number[] | null;
  dossierAwards: Array<Record<string, unknown>> | null;
  dossierEvents: Array<Record<string, unknown>> | null;
  dossierStats: Record<string, unknown> | null;
  dossierAt: string | null;
}): OrgSessionFacts["dossier"] {
  if (!row.dossierAt) return null;
  const p = row.dossierProfile ?? {};
  const location = [s(p.city), s(p.stateProv), s(p.country)].filter(Boolean).join(", ") || null;
  const years = Array.isArray(row.dossierYears) ? row.dossierYears.map(n).filter((y): y is number => y !== null) : [];
  const stats = row.dossierStats ?? {};
  const statYears = Array.isArray(stats.years) ? (stats.years as Array<Record<string, unknown>>) : [];
  const latest = statYears[0];
  return {
    nickname: s(p.nickname),
    location,
    rookieYear: n(p.rookieYear),
    seasonsCompeted: new Set(years).size,
    awards: (row.dossierAwards ?? [])
      .map((a) => ({ year: n(a.year) ?? 0, name: s(a.name) ?? "" }))
      .filter((a) => a.year > 0 && a.name),
    recentEvents: (row.dossierEvents ?? []).slice(0, 6).map((e) => {
      const w = n(e.wins);
      const l = n(e.losses);
      const t = n(e.ties);
      return {
        year: n(e.year) ?? 0,
        name: s(e.name),
        rank: n(e.rank),
        teams: n(e.teams),
        record: w !== null && l !== null ? `${w}-${l}-${t ?? 0}` : null,
      };
    }),
    normEpa: n(stats.normEpa),
    latestYear: latest
      ? { year: n(latest.year) ?? 0, epa: n(latest.epa), rankWorld: n(latest.rankWorld), teamsWorld: n(latest.teamsWorld) }
      : null,
    computedAt: row.dossierAt,
  };
}
