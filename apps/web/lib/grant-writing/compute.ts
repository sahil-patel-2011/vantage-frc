import type { PoolClient } from "@neondatabase/serverless";
import { loadGrantOrgEvidence } from "../grant-assist/load-evidence";
import { composeGrantNarrative, validateGuidedFields } from "./compose";
import { GRANT_TEMPLATES, grantTemplateByKey, isGrantTemplateKey } from "./templates";
import {
  GRANT_DRAFT_STATUSES,
  type GrantDraftStatus,
  type GrantTemplateKey,
  type GrantWritingDraft,
  type GrantWritingView,
  type GuidedFields,
} from "./types";

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type DraftRow = {
  id: string;
  templateKey: GrantTemplateKey;
  title: string;
  funderName: string | null;
  askAmountUsd: string | number | null;
  needText: string;
  impactText: string;
  budgetText: string;
  timelineText: string;
  body: string;
  status: GrantDraftStatus;
  source: string;
  provenance: unknown;
  seasonYear: number;
  updatedAt: string;
};

function num(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToDraft(row: DraftRow): GrantWritingDraft {
  return {
    id: row.id,
    templateKey: row.templateKey,
    title: row.title,
    funderName: row.funderName,
    askAmountUsd: num(row.askAmountUsd),
    fields: {
      need: row.needText,
      impact: row.impactText,
      budget: row.budgetText,
      timeline: row.timelineText,
    },
    body: row.body,
    status: row.status,
    source: row.source,
    provenance: Array.isArray(row.provenance) ? (row.provenance as GrantWritingDraft["provenance"]) : [],
    seasonYear: row.seasonYear,
    updatedAt: row.updatedAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; orgName: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; orgName: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber"
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

async function loadDrafts(client: PoolClient, orgId: string, seasonYear: number): Promise<GrantWritingDraft[]> {
  const result = await client.query<DraftRow>(
    `SELECT id, template_key AS "templateKey", title, funder_name AS "funderName",
            ask_amount_usd AS "askAmountUsd", need_text AS "needText", impact_text AS "impactText",
            budget_text AS "budgetText", timeline_text AS "timelineText", body, status, source,
            provenance, season_year AS "seasonYear", updated_at::text AS "updatedAt"
     FROM grant_writing_drafts
     WHERE org_id = $1::uuid AND season_year = $2
     ORDER BY updated_at DESC`,
    [orgId, seasonYear],
  );
  return result.rows.map(rowToDraft);
}

async function loadSeasons(client: PoolClient, orgId: string, seasonYear: number): Promise<number[]> {
  const result = await client.query<{ seasonYear: number }>(
    `SELECT DISTINCT season_year AS "seasonYear"
     FROM grant_writing_drafts
     WHERE org_id = $1::uuid
     ORDER BY season_year DESC`,
    [orgId],
  );
  const seasons = result.rows.map((row) => row.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);
  return seasons;
}

export async function computeGrantWritingView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<GrantWritingView> {
  const seasonYear =
    input.seasonYear && input.seasonYear > 2000 && input.seasonYear < 3000
      ? input.seasonYear
      : currentSeasonYear();
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to compose grant narratives.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  try {
    const [evidence, drafts, seasons] = await Promise.all([
      loadGrantOrgEvidence(client, { orgId: org.orgId, seasonYear }),
      loadDrafts(client, org.orgId, seasonYear),
      loadSeasons(client, org.orgId, seasonYear),
    ]);

    if (!evidence || evidence.orgId !== org.orgId) {
      return {
        status: "setup_required",
        message: "Could not load organization profile for grant writing.",
        steps: [
          { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
        ],
        orgId: org.orgId,
        seasonYear,
      };
    }

    return {
      status: "live",
      orgId: org.orgId,
      orgName: evidence.orgName,
      teamNumber: evidence.teamNumber,
      seasonYear,
      seasons,
      templates: GRANT_TEMPLATES,
      drafts,
      impactSummary: evidence.impact,
      communityHours: evidence.communityHours,
      seasonGoals: evidence.seasonGoals,
      awardCount: evidence.awards.length,
      location: evidence.location,
      computedAt: new Date().toISOString(),
    };
  } catch {
    return {
      status: "setup_required",
      message: "Grant writing engine is not available yet. Run database migrations.",
      steps: [
        { id: "migrations", label: "Database setup", detail: "Apply latest migrations", href: "/workspace" },
      ],
      orgId: org.orgId,
      seasonYear,
    };
  }
}

function draftTitle(templateKey: GrantTemplateKey, funderName: string | null): string {
  const template = grantTemplateByKey(templateKey);
  const funder = funderName?.trim();
  return funder ? `${template.label} — ${funder}` : template.label;
}

export async function saveGrantWritingDraft(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    templateKey: GrantTemplateKey;
    title?: string;
    funderName?: string | null;
    askAmountUsd?: number | null;
    fields: GuidedFields;
    body: string;
    provenance: unknown[];
    source?: string;
    grantApplicationId?: string | null;
  },
): Promise<string> {
  const title = input.title?.trim() || draftTitle(input.templateKey, input.funderName ?? null);
  const result = await client.query<{ id: string }>(
    `INSERT INTO grant_writing_drafts (
       org_id, grant_application_id, season_year, template_key, title, funder_name, ask_amount_usd,
       need_text, impact_text, budget_text, timeline_text, body, status, source, provenance,
       created_by, updated_by
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4, $5, $6, $7::numeric,
       $8, $9, $10, $11, $12, 'draft', $13, $14::jsonb,
       $15::uuid, $15::uuid
     )
     RETURNING id`,
    [
      input.orgId,
      input.grantApplicationId ?? null,
      input.seasonYear,
      input.templateKey,
      title.slice(0, 240),
      input.funderName?.trim() || null,
      input.askAmountUsd ?? null,
      input.fields.need,
      input.fields.impact,
      input.fields.budget,
      input.fields.timeline,
      input.body,
      input.source ?? "template",
      JSON.stringify(input.provenance ?? []),
      input.userId,
    ],
  );
  return result.rows[0]!.id;
}

export async function deleteGrantWritingDraft(
  client: PoolClient,
  input: { orgId: string; draftId: string },
): Promise<void> {
  const result = await client.query(
    `DELETE FROM grant_writing_drafts WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.draftId, input.orgId],
  );
  if (!result.rowCount) throw new Error("Grant writing draft not found");
}

export async function setGrantDraftStatus(
  client: PoolClient,
  input: { orgId: string; userId: string; draftId: string; status: GrantDraftStatus },
): Promise<void> {
  const result = await client.query(
    `UPDATE grant_writing_drafts
     SET status = $1, updated_by = $2::uuid, updated_at = now()
     WHERE id = $3::uuid AND org_id = $4::uuid`,
    [input.status, input.userId, input.draftId, input.orgId],
  );
  if (!result.rowCount) throw new Error("Grant writing draft not found");
}

export async function composeAndSaveGrantDraft(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    templateKey: GrantTemplateKey;
    funderName?: string | null;
    askAmountUsd?: number | null;
    fields: GuidedFields;
  },
): Promise<void> {
  const validation = validateGuidedFields(input.fields);
  if (!validation.ok) throw new Error(validation.error);

  const evidence = await loadGrantOrgEvidence(client, { orgId: input.orgId, seasonYear: input.seasonYear });
  if (!evidence || evidence.orgId !== input.orgId) throw new Error("Organization scope mismatch");

  const composed = composeGrantNarrative({
    templateKey: input.templateKey,
    funderName: input.funderName,
    askAmountUsd: input.askAmountUsd,
    fields: input.fields,
    ctx: evidence,
  });

  await saveGrantWritingDraft(client, {
    orgId: input.orgId,
    userId: input.userId,
    seasonYear: input.seasonYear,
    templateKey: input.templateKey,
    funderName: input.funderName,
    askAmountUsd: input.askAmountUsd,
    fields: input.fields,
    body: composed.body,
    provenance: composed.provenance,
    source: "template",
  });
}

export function parseGrantTemplateKey(value: unknown): GrantTemplateKey | null {
  return isGrantTemplateKey(value) ? value : null;
}

export function parseGrantDraftStatus(value: unknown): GrantDraftStatus | null {
  return typeof value === "string" && (GRANT_DRAFT_STATUSES as readonly string[]).includes(value)
    ? (value as GrantDraftStatus)
    : null;
}
