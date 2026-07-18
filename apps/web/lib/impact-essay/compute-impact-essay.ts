import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { awardPrompt, composeEssay, round1, wordCount } from ".";
import type {
  ImpactEssayAward,
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
  };
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
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [facts, draftResult, seasonResult] = await Promise.all([
    gatherGroundedFacts(client, org.orgId, seasonYear),
    client.query<DraftRow>(
      `SELECT id, season_year AS "seasonYear", award, prompt, essay_text AS "essayText",
              word_count AS "wordCount", citations, created_at::text AS "createdAt"
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
): Promise<ImpactEssayDraft> {
  const facts = await gatherGroundedFacts(client, input.orgId, input.seasonYear);
  const prompt = awardPrompt(input.award);
  const { text, citations } = composeEssay(input.award, facts);

  const metered = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "impact_essay",
    requestId: `impact-essay-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      award: input.award,
      seasonYear: input.seasonYear,
      citationCount: citations.length,
      note: "Deterministic impact-essay synthesis grounded in logged records — no external model call",
    },
    invoke: async () => ({
      value: text,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-impact-essay-v1",
      provider: "vantage-local",
    }),
  });

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
    seasonYear: input.seasonYear,
    award: input.award,
    prompt,
    essayText: metered,
    wordCount: wordCount(metered),
    citations,
    createdAt: row.createdAt,
  };
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
