import type { PoolClient } from "@neondatabase/serverless";
import {
  coerceAchievementList,
  preferAchievements,
  preferMission,
  preferRegion,
} from "../team-background";
import type { DraftKind, DraftStatus, WriterDraft, WriterProfile, WriterTone } from "./types";

export const DRAFT_KINDS: DraftKind[] = [
  "grant",
  "cold_intro",
  "sponsorship_ask",
  "renewal",
  "thank_you",
  "grant_followup",
];
export const DRAFT_STATUSES: DraftStatus[] = ["draft", "final", "sent"];
export const WRITER_TONES: WriterTone[] = ["warm", "professional", "concise"];

export type WriterSetupStep = { id: string; label: string; detail: string; href: string };

export type WriterView =
  | {
      status: "setup_required";
      message: string;
      steps: WriterSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      profile: WriterProfile;
      drafts: WriterDraft[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type ProfileRow = {
  teamName: string | null;
  teamNumber: number | null;
  region: string | null;
  mission: string | null;
  achievements: unknown;
  fundingNeed: string | null;
  fundingAskUsd: string | number | null;
  tone: WriterTone | null;
};

type DraftRow = {
  id: string;
  kind: DraftKind;
  title: string;
  targetName: string | null;
  subject: string | null;
  body: string;
  status: DraftStatus;
  source: string;
  seasonYear: number;
  createdAt: string;
};

function num(value: string | number | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function coerceStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{
  orgId: string;
  teamNumber: number | null;
  orgName: string | null;
  city: string | null;
  stateProv: string | null;
  description: string | null;
} | null> {
  const membership = await client.query<{
    orgId: string;
    teamNumber: number | null;
    orgName: string | null;
    city: string | null;
    stateProv: string | null;
    description: string | null;
  }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", o.name AS "orgName",
            o.city, o.state_prov AS "stateProv", o.description
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

export async function computeWriterView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<WriterView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to draft grants and sponsor emails.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [profileResult, draftResult, seasonResult, backgroundResult] = await Promise.all([
    client.query<ProfileRow>(
      `SELECT team_name AS "teamName", team_number AS "teamNumber", region, mission, achievements,
              funding_need AS "fundingNeed", funding_ask_usd AS "fundingAskUsd", tone
       FROM writer_profile WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<DraftRow>(
      `SELECT id, kind, title, target_name AS "targetName", subject, body, status, source,
              season_year AS "seasonYear", created_at::text AS "createdAt"
       FROM writer_drafts
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM (
         SELECT season_year FROM writer_profile WHERE org_id = $1
         UNION SELECT season_year FROM writer_drafts WHERE org_id = $1
       ) s ORDER BY season_year DESC`,
      [org.orgId],
    ),
    // THIS org only — never join another team's background.
    client.query<{ mission: string | null; achievements: unknown }>(
      `SELECT mission, achievements FROM team_background_profile WHERE org_id = $1::uuid`,
      [org.orgId],
    ),
  ]);

  const row = profileResult.rows[0];
  const background = backgroundResult.rows[0];
  const profile: WriterProfile = {
    teamName: row?.teamName ?? org.orgName ?? (org.teamNumber ? `Team ${org.teamNumber}` : "Our team"),
    teamNumber: row?.teamNumber ?? org.teamNumber ?? null,
    region: preferRegion(row?.region, org.city, org.stateProv),
    mission: preferMission(background?.mission, org.description, row?.mission),
    achievements: preferAchievements(
      coerceAchievementList(background?.achievements),
      coerceStrings(row?.achievements),
    ),
    fundingNeed: row?.fundingNeed ?? null,
    fundingAskUsd: row ? num(row.fundingAskUsd) : null,
    tone: row?.tone ?? "warm",
  };

  const drafts: WriterDraft[] = draftResult.rows.map((draft) => ({
    id: draft.id,
    kind: draft.kind,
    title: draft.title,
    targetName: draft.targetName,
    subject: draft.subject,
    body: draft.body,
    status: draft.status,
    source: draft.source,
    seasonYear: draft.seasonYear,
    createdAt: draft.createdAt,
  }));

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    profile,
    drafts,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function setProfile(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    teamName: string;
    teamNumber: number | null;
    region: string | null;
    mission: string | null;
    achievements: string[];
    fundingNeed: string | null;
    fundingAskUsd: number | null;
    tone: WriterTone;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO writer_profile
       (org_id, season_year, team_name, team_number, region, mission, achievements, funding_need, funding_ask_usd, tone, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::numeric,$10,$11)
     ON CONFLICT (org_id, season_year) DO UPDATE SET
       team_name = EXCLUDED.team_name,
       team_number = EXCLUDED.team_number,
       region = EXCLUDED.region,
       mission = EXCLUDED.mission,
       achievements = EXCLUDED.achievements,
       funding_need = EXCLUDED.funding_need,
       funding_ask_usd = EXCLUDED.funding_ask_usd,
       tone = EXCLUDED.tone,
       updated_at = now()`,
    [
      input.orgId,
      input.seasonYear,
      input.teamName,
      input.teamNumber,
      input.region,
      input.mission,
      JSON.stringify(input.achievements ?? []),
      input.fundingNeed,
      input.fundingAskUsd,
      input.tone,
      input.userId,
    ],
  );
}

export async function saveDraft(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    kind: DraftKind;
    title: string;
    targetName: string | null;
    subject: string | null;
    body: string;
    source: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO writer_drafts (org_id, season_year, kind, title, target_name, subject, body, status, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9)`,
    [
      input.orgId,
      input.seasonYear,
      input.kind,
      input.title,
      input.targetName,
      input.subject,
      input.body,
      input.source,
      input.userId,
    ],
  );
}

export async function updateDraft(
  client: PoolClient,
  input: {
    orgId: string;
    draftId: string;
    title?: string;
    subject?: string | null;
    body?: string;
    status?: DraftStatus;
  },
): Promise<void> {
  await client.query(
    `UPDATE writer_drafts SET
       title = COALESCE($3, title),
       subject = CASE WHEN $4::boolean THEN $5 ELSE subject END,
       body = COALESCE($6, body),
       status = COALESCE($7, status),
       updated_at = now()
     WHERE id = $1 AND org_id = $2`,
    [
      input.draftId,
      input.orgId,
      input.title ?? null,
      input.subject !== undefined,
      input.subject ?? null,
      input.body ?? null,
      input.status ?? null,
    ],
  );
}

export async function deleteDraft(
  client: PoolClient,
  input: { orgId: string; draftId: string },
): Promise<void> {
  await client.query(`DELETE FROM writer_drafts WHERE id = $1 AND org_id = $2`, [input.draftId, input.orgId]);
}
