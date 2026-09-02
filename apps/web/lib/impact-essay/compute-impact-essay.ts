import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureText, renderOutcomeOf, type RenderOutcome } from "../ai-render/render";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { awardPrompt, composeEssay, round1, wordCount } from ".";
import type {
  ImpactEssayAward,
  ImpactEssayAwardSubmission,
  ImpactEssayDraft,
  ImpactEssayGroundedFacts,
  ImpactEssayOutreachActivity,
  ImpactEssaySponsor,
  ImpactEssayTeamEvent,
} from "./types";

export type ImpactEssaySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO essay metrics. */
function setupStepsFor(orgId: string | null): ImpactEssaySetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Impact Essay is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Outreach claims stay blank until real activities exist — never DEMO hours.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "evidence",
      label: "Open Awards",
      detail: "Award packets stay blank until your team uploads evidence — never DEMO packets.",
      href: hubHref("/business", "evidence", orgId),
    },
    {
      id: "writer",
      label: "Open Writer",
      detail: "Grant and sponsor copy stays empty until you draft it — never DEMO awards.",
      href: hubHref("/ai", "writer", orgId),
    },
  ];
}

export type ImpactEssayView =
  | {
      status: "setup_required";
      message: string;
      steps: ImpactEssaySetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      facts: ImpactEssayGroundedFacts;
      drafts: ImpactEssayDraft[];
      /** Award submissions a draft can be attached to (0504 attach_to_award). */
      awardSubmissions: ImpactEssayAwardSubmission[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
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

async function gatherGroundedFacts(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<ImpactEssayGroundedFacts> {
  const [activityResult, hoursResult, sponsorResult, eventResult] = await Promise.all([
    client.query<{
      id: string;
      title: string;
      category: string;
      occurredOn: string;
      peopleReached: number;
      durationMinutes: number;
    }>(
      `SELECT id, title, category, occurred_on::text AS "occurredOn",
              people_reached AS "peopleReached", duration_minutes AS "durationMinutes"
       FROM impact_activities
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC, created_at DESC`,
      [orgId, seasonYear],
    ),
    client.query<{ totalHours: string | number | null; contributorCount: string | number | null }>(
      `SELECT
         COALESCE(SUM(extract(epoch FROM (clock_out - clock_in)) / 3600.0), 0) AS "totalHours",
         COUNT(DISTINCT user_id) AS "contributorCount"
       FROM hour_logs
       WHERE org_id = $1 AND clock_out IS NOT NULL AND extract(year FROM clock_in) = $2`,
      [orgId, seasonYear],
    ),
    client.query<{ id: string; name: string; tier: string; status: string }>(
      `SELECT id, name, tier::text AS tier, status::text AS status
       FROM sponsors
       WHERE org_id = $1 AND status = 'active'
       ORDER BY name`,
      [orgId],
    ),
    client.query<{ id: string; title: string; kind: string; occurredOn: string; creditHours: string | number }>(
      `SELECT id, title, kind, occurred_on::text AS "occurredOn", credit_hours AS "creditHours"
       FROM attendance_events
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC`,
      [orgId, seasonYear],
    ),
  ]);

  const outreachActivities: ImpactEssayOutreachActivity[] = activityResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    occurredOn: row.occurredOn,
    peopleReached: Number(row.peopleReached) || 0,
    durationMinutes: Number(row.durationMinutes) || 0,
  }));
  const totalOutreachHours = round1(
    outreachActivities.reduce((sum, activity) => sum + activity.durationMinutes, 0) / 60,
  );
  const totalPeopleReached = outreachActivities.reduce((sum, activity) => sum + activity.peopleReached, 0);

  const hoursRow = hoursResult.rows[0];
  const buildHours = {
    totalHours: round1(Number(hoursRow?.totalHours) || 0),
    contributorCount: Number(hoursRow?.contributorCount) || 0,
  };

  const sponsors: ImpactEssaySponsor[] = sponsorResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    tier: row.tier,
    status: row.status,
  }));

  const events: ImpactEssayTeamEvent[] = eventResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    occurredOn: row.occurredOn,
    creditHours: Number(row.creditHours) || 0,
  }));

  const hasGroundedData =
    outreachActivities.length > 0 || buildHours.totalHours > 0 || sponsors.length > 0 || events.length > 0;

  return {
    seasonYear,
    outreachActivities,
    totalOutreachHours,
    totalPeopleReached,
    buildHours,
    sponsors,
    events,
    hasGroundedData,
  };
}

type DraftRow = {
  id: string;
  seasonYear: number;
  award: ImpactEssayAward;
  prompt: string;
  essayText: string;
  wordCount: number;
  citations: unknown;
  createdAt: string;
  awardSubmissionId?: string | null;
  awardItemId?: string | null;
};

function mapDraft(row: DraftRow): ImpactEssayDraft {
  const citations = Array.isArray(row.citations) ? row.citations : [];
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    award: row.award,
    prompt: row.prompt,
    essayText: row.essayText,
    wordCount: Number(row.wordCount) || 0,
    citations: citations as ImpactEssayDraft["citations"],
    createdAt: row.createdAt,
    awardSubmissionId: row.awardSubmissionId ?? null,
    awardItemId: row.awardItemId ?? null,
  };
}

async function loadAwardSubmissions(client: PoolClient, orgId: string): Promise<ImpactEssayAwardSubmission[]> {
  const result = await client.query<ImpactEssayAwardSubmission>(
    `SELECT id, award_type AS "awardType", title, season_year AS "seasonYear", status::text AS status
     FROM award_submissions
     WHERE org_id = $1
     ORDER BY season_year DESC, created_at DESC
     LIMIT 100`,
    [orgId],
  );
  return result.rows.map((row) => ({ ...row, seasonYear: Number(row.seasonYear) }));
}

export async function computeImpactEssayView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ImpactEssayView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to draft a grounded FIRST Impact essay.",
      steps: setupStepsFor(null),
      orgId: null,
      seasonYear,
    };
  }

  const [facts, draftResult, seasonResult, awardSubmissions] = await Promise.all([
    gatherGroundedFacts(client, org.orgId, seasonYear),
    client.query<DraftRow>(
      `SELECT id, season_year AS "seasonYear", award, prompt, essay_text AS "essayText",
              word_count AS "wordCount", citations, created_at::text AS "createdAt",
              award_submission_id AS "awardSubmissionId", award_item_id AS "awardItemId"
       FROM impact_essay_drafts
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM impact_essay_drafts WHERE org_id = $1
       UNION
       SELECT DISTINCT season_year AS "seasonYear" FROM impact_activities WHERE org_id = $1
       ORDER BY "seasonYear" DESC`,
      [org.orgId],
    ),
    loadAwardSubmissions(client, org.orgId),
  ]);

  const drafts = draftResult.rows.map(mapDraft);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    facts,
    drafts,
    awardSubmissions,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Generates a new essay draft strictly from this org's grounded records and persists it.
 * The composition is deterministic (templated from counted, real rows — no external model
 * call) but still runs through the standard AI-usage metering path, matching the
 * local/deterministic metering pattern used by other zero-provider-cost computed briefs
 * (see standup-digest's `generateDigest`).
 */
export async function generateEssayDraft(
  client: PoolClient,
  input: { orgId: string; userId: string; award: ImpactEssayAward; seasonYear: number },
): Promise<ImpactEssayDraft & { render: RenderOutcome }> {
  const facts = await gatherGroundedFacts(client, input.orgId, input.seasonYear);
  const prompt = awardPrompt(input.award);
  const { text, citations } = composeEssay(input.award, facts);

  // Real model call on the org's adapter; the deterministic, citation-marked draft is both
  // the fallback and the only source of facts. Output that drops a citation marker is
  // rejected so every claim in the essay stays traceable to a logged record.
  const rendered = await renderFeatureText({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "impact_essay",
    prompt: [
      prompt,
      "",
      "Grounded draft with citation markers — the ONLY source of truth:",
      text,
      "",
      `Rewrite this into a cohesive ${input.award} essay draft for the ${input.seasonYear} season (2-4 paragraphs, under 500 words). Keep every citation marker [n] next to the fact it cites, add no numbers, names, events or outcomes beyond those facts, and keep the paragraph order.`,
    ].join("\n"),
    template: () => text,
    accept: (candidate) => citations.every((_, index) => candidate.includes(`[${index + 1}]`)),
    maxTokens: 900,
    metadata: { award: input.award, seasonYear: input.seasonYear, citationCount: citations.length },
  });
  const metered = rendered.text;

  const result = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO impact_essay_drafts (
       org_id, season_year, award, prompt, essay_text, word_count, citations, generated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING id, created_at::text AS "createdAt"`,
    [
      input.orgId,
      input.seasonYear,
      input.award,
      prompt,
      metered,
      wordCount(metered),
      JSON.stringify(citations),
      input.userId,
    ],
  );
  const row = result.rows[0]!;

  return {
    id: row.id,
    render: renderOutcomeOf(rendered),
    seasonYear: input.seasonYear,
    award: input.award,
    prompt,
    essayText: metered,
    wordCount: wordCount(metered),
    citations,
    createdAt: row.createdAt,
    awardSubmissionId: null,
    awardItemId: null,
  };
}

/**
 * attach_to_award (0504): copy a grounded draft into the award workbench as an award_items
 * essay on the chosen submission, and remember where it went on the draft. Idempotent — a
 * draft already attached to that submission (and whose item still exists) is left alone.
 * award_items is admin-writable only (0036), so members get a clear error, not an RLS one.
 */
export async function attachDraftToAward(
  client: PoolClient,
  input: { orgId: string; userId: string; draftId: string; awardSubmissionId: string },
): Promise<{ awardItemId: string; created: boolean }> {
  const admin = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
    [input.orgId, input.userId],
  );
  if (!admin.rowCount) throw new Error("Organization administrator access required to attach an essay to an award");

  const draft = await client.query<{
    prompt: string;
    essayText: string;
    award: string;
    awardSubmissionId: string | null;
    awardItemId: string | null;
  }>(
    `SELECT prompt, essay_text AS "essayText", award,
            award_submission_id AS "awardSubmissionId", award_item_id AS "awardItemId"
     FROM impact_essay_drafts WHERE id = $1 AND org_id = $2`,
    [input.draftId, input.orgId],
  );
  const row = draft.rows[0];
  if (!row) throw new Error("Draft not found");

  if (row.awardSubmissionId === input.awardSubmissionId && row.awardItemId) {
    const existing = await client.query(`SELECT 1 FROM award_items WHERE id = $1 AND org_id = $2`, [
      row.awardItemId,
      input.orgId,
    ]);
    if (existing.rowCount) return { awardItemId: row.awardItemId, created: false };
  }

  const submission = await client.query(`SELECT 1 FROM award_submissions WHERE id = $1 AND org_id = $2`, [
    input.awardSubmissionId,
    input.orgId,
  ]);
  if (!submission.rowCount) throw new Error("Award submission not found");

  const order = await client.query<{ next: number }>(
    `SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM award_items WHERE submission_id = $1`,
    [input.awardSubmissionId],
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO award_items (submission_id, org_id, kind, prompt, content, sort_order)
     VALUES ($1, $2, 'essay', $3, $4, $5)
     RETURNING id`,
    [input.awardSubmissionId, input.orgId, row.prompt, row.essayText, Number(order.rows[0]?.next ?? 0)],
  );
  const awardItemId = inserted.rows[0]!.id;
  await client.query(
    `UPDATE impact_essay_drafts SET award_submission_id = $3, award_item_id = $4
     WHERE id = $1 AND org_id = $2`,
    [input.draftId, input.orgId, input.awardSubmissionId, awardItemId],
  );
  return { awardItemId, created: true };
}

export async function deleteEssayDraft(
  client: PoolClient,
  input: { orgId: string; draftId: string },
): Promise<void> {
  await client.query(`DELETE FROM impact_essay_drafts WHERE id = $1 AND org_id = $2`, [
    input.draftId,
    input.orgId,
  ]);
}
