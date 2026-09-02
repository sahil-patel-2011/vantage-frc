import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureText, renderFeatureValue, renderOutcomeOf, type RenderOutcome } from "../ai-render/render";
import { buildDeckSections, buildRoiNarrative, computeGoalProgress, summarizeRoiLines } from ".";
import type {
  SponsorSuiteDeck,
  SponsorSuiteDeckKind,
  SponsorSuiteGoalProgress,
  SponsorSuiteReminder,
  SponsorSuiteReminderKind,
  SponsorSuiteRoiReport,
} from "./types";

export type SponsorSuiteSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SponsorOption = { id: string; name: string; tier: string; status: string };

export type SponsorSuiteView =
  | {
      status: "setup_required";
      message: string;
      steps: SponsorSuiteSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      sponsors: SponsorOption[];
      goal: SponsorSuiteGoalProgress;
      decks: SponsorSuiteDeck[];
      roiReports: SponsorSuiteRoiReport[];
      reminders: SponsorSuiteReminder[];
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

type DeckRow = {
  id: string;
  sponsorId: string | null;
  sponsorName: string | null;
  kind: SponsorSuiteDeckKind;
  seasonYear: number;
  title: string;
  sections: SponsorSuiteDeck["sections"];
  createdAt: string;
};

function mapDeck(row: DeckRow): SponsorSuiteDeck {
  return {
    id: row.id,
    sponsorId: row.sponsorId,
    sponsorName: row.sponsorName,
    kind: row.kind,
    seasonYear: row.seasonYear,
    title: row.title,
    sections: Array.isArray(row.sections) ? row.sections : [],
    createdAt: row.createdAt,
  };
}

type RoiReportRow = {
  id: string;
  seasonYear: number;
  totalRaisedUsd: string;
  totalSponsors: number;
  goalUsd: string | null;
  goalAttainmentPct: string | null;
  lines: SponsorSuiteRoiReport["lines"];
  narrative: string;
  createdAt: string;
};

function mapRoiReport(row: RoiReportRow): SponsorSuiteRoiReport {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    totalRaisedUsd: Number(row.totalRaisedUsd) || 0,
    totalSponsors: Number(row.totalSponsors) || 0,
    goalUsd: row.goalUsd != null ? Number(row.goalUsd) || 0 : null,
    goalAttainmentPct: row.goalAttainmentPct != null ? Number(row.goalAttainmentPct) || 0 : null,
    lines: Array.isArray(row.lines) ? row.lines : [],
    narrative: row.narrative,
    createdAt: row.createdAt,
  };
}

type ReminderRow = {
  id: string;
  sponsorId: string;
  sponsorName: string;
  kind: SponsorSuiteReminderKind;
  dueOn: string;
  status: SponsorSuiteReminder["status"];
  note: string | null;
  createdAt: string;
};

function mapReminder(row: ReminderRow): SponsorSuiteReminder {
  return {
    id: row.id,
    sponsorId: row.sponsorId,
    sponsorName: row.sponsorName,
    kind: row.kind,
    dueOn: row.dueOn,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
  };
}

async function loadGoalProgress(client: PoolClient, orgId: string, seasonYear: number): Promise<SponsorSuiteGoalProgress> {
  const [goalResult, actualResult] = await Promise.all([
    client.query<{ goalUsd: string }>(
      `SELECT goal_usd::text AS "goalUsd" FROM sponsor_suite_goals WHERE org_id = $1 AND season_year = $2`,
      [orgId, seasonYear],
    ),
    client.query<{ actualUsd: string }>(
      `SELECT COALESCE(SUM(amount_usd), 0)::text AS "actualUsd"
       FROM sponsor_contributions WHERE org_id = $1 AND season_year = $2`,
      [orgId, seasonYear],
    ),
  ]);
  const goalUsd = goalResult.rows[0]?.goalUsd != null ? Number(goalResult.rows[0].goalUsd) : null;
  const actualUsd = Number(actualResult.rows[0]?.actualUsd ?? 0) || 0;
  return computeGoalProgress(seasonYear, goalUsd, actualUsd);
}

export async function computeSponsorSuiteView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SponsorSuiteView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build sponsor decks, ROI reports, and reminders.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [sponsorResult, seasonResult, deckResult, roiResult, reminderResult, goal] = await Promise.all([
    client.query<SponsorOption>(
      `SELECT id, name, tier::text AS tier, status::text AS status
       FROM sponsors WHERE org_id = $1 ORDER BY name`,
      [org.orgId],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM sponsor_contributions WHERE org_id = $1
       UNION SELECT DISTINCT season_year FROM sponsor_suite_goals WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
    client.query<DeckRow>(
      `SELECT d.id, d.sponsor_id AS "sponsorId", s.name AS "sponsorName", d.kind, d.season_year AS "seasonYear",
              d.title, d.sections, d.created_at AS "createdAt"
       FROM sponsor_suite_decks d
       LEFT JOIN sponsors s ON s.id = d.sponsor_id
       WHERE d.org_id = $1 AND d.season_year = $2
       ORDER BY d.created_at DESC
       LIMIT 20`,
      [org.orgId, seasonYear],
    ),
    client.query<RoiReportRow>(
      `SELECT id, season_year AS "seasonYear", total_raised_usd AS "totalRaisedUsd",
              total_sponsors AS "totalSponsors", goal_usd AS "goalUsd", goal_attainment_pct AS "goalAttainmentPct",
              lines, narrative, created_at AS "createdAt"
       FROM sponsor_suite_roi_reports
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [org.orgId, seasonYear],
    ),
    client.query<ReminderRow>(
      `SELECT r.id, r.sponsor_id AS "sponsorId", s.name AS "sponsorName", r.kind,
              r.due_on::text AS "dueOn", r.status::text AS status, r.note, r.created_at AS "createdAt"
       FROM sponsor_suite_reminders r
       JOIN sponsors s ON s.id = r.sponsor_id
       WHERE r.org_id = $1 AND r.status = 'pending'
       ORDER BY r.due_on ASC
       LIMIT 30`,
      [org.orgId],
    ),
    loadGoalProgress(client, org.orgId, seasonYear),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    sponsors: sponsorResult.rows,
    goal,
    decks: deckResult.rows.map(mapDeck),
    roiReports: roiResult.rows.map(mapRoiReport),
    reminders: reminderResult.rows.map(mapReminder),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Generate a deterministic pitch/renewal deck outline grounded only in the sponsor's own recorded
 * contribution history and the season's fundraising goal. Rendered through renderWithModel (real model call, template fallback) so the run is billed
 * and audited through the standard usage-ledger path, matching every other metered feature.
 */
export async function generateDeck(
  client: PoolClient,
  input: { orgId: string; userId: string; sponsorId: string | null; kind: SponsorSuiteDeckKind; seasonYear: number },
): Promise<SponsorSuiteDeck & { render: RenderOutcome }> {
  let sponsorName: string | null = null;
  let priorContributionsUsd = 0;
  let priorContributionCount = 0;
  if (input.sponsorId) {
    const sponsorRow = await client.query<{ name: string }>(`SELECT name FROM sponsors WHERE id = $1 AND org_id = $2`, [
      input.sponsorId,
      input.orgId,
    ]);
    sponsorName = sponsorRow.rows[0]?.name ?? null;
    const priorResult = await client.query<{ totalUsd: string; count: string }>(
      `SELECT COALESCE(SUM(amount_usd), 0)::text AS "totalUsd", COUNT(*)::text AS count
       FROM sponsor_contributions WHERE sponsor_id = $1 AND org_id = $2`,
      [input.sponsorId, input.orgId],
    );
    priorContributionsUsd = Number(priorResult.rows[0]?.totalUsd ?? 0) || 0;
    priorContributionCount = Number(priorResult.rows[0]?.count ?? 0) || 0;
  }

  const orgRow = await client.query<{ teamNumber: number | null }>(
    `SELECT team_number AS "teamNumber" FROM organizations WHERE id = $1`,
    [input.orgId],
  );
  const teamNumber = orgRow.rows[0]?.teamNumber ?? null;
  const goal = await loadGoalProgress(client, input.orgId, input.seasonYear);

  // Real model call on the org's adapter with the deterministic deck as fallback: each
  // section body may be rewritten as pitch prose; headings, prior-contribution figures and
  // the season goal come from the sponsor's records.
  const { value: result, render } = await renderFeatureValue({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "sponsor_suite_deck",
    value: buildDeckSections({
      kind: input.kind,
      sponsorName,
      teamNumber,
      seasonYear: input.seasonYear,
      priorContributionsUsd,
      priorContributionCount,
      goal,
    }),
    editableKeys: ["body"],
    instructions: `${input.kind === "renewal" ? "Renewal" : "Pitch"} deck for ${sponsorName ?? "a prospective sponsor"} from ${teamNumber != null ? `FRC Team ${teamNumber}` : "our FRC team"}, ${input.seasonYear} season. Rewrite each section body as one persuasive but factual paragraph, keeping every dollar amount, count and goal figure exactly as given and inventing no past support, awards or reach numbers.`,
    metadata: { sponsorId: input.sponsorId, kind: input.kind, seasonYear: input.seasonYear },
  });

  const title = `${sponsorName ?? "Prospect"} ${input.kind === "renewal" ? "renewal" : "pitch"} deck — ${input.seasonYear}`;
  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO sponsor_suite_decks (org_id, sponsor_id, kind, season_year, title, sections, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING id, created_at AS "createdAt"`,
    [input.orgId, input.sponsorId, input.kind, input.seasonYear, title, JSON.stringify(result), input.userId],
  );

  return {
    id: inserted.rows[0]!.id,
    render,
    sponsorId: input.sponsorId,
    sponsorName,
    kind: input.kind,
    seasonYear: input.seasonYear,
    title,
    sections: result,
    createdAt: inserted.rows[0]!.createdAt,
  };
}

/**
 * Generate a deterministic end-of-season ROI report grounded only in recorded sponsor_contributions
 * and the season goal. Rendered through renderWithModel (real model call, template fallback) to go through the standard usage-ledger path.
 */
export async function generateRoiReport(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number },
): Promise<SponsorSuiteRoiReport & { render: RenderOutcome }> {
  const contributionResult = await client.query<{ sponsorId: string; sponsorName: string; tier: string; amountUsd: string }>(
    `SELECT c.sponsor_id AS "sponsorId", s.name AS "sponsorName", s.tier::text AS tier,
            COALESCE(c.amount_usd, 0)::text AS "amountUsd"
     FROM sponsor_contributions c
     JOIN sponsors s ON s.id = c.sponsor_id
     WHERE c.org_id = $1 AND c.season_year = $2`,
    [input.orgId, input.seasonYear],
  );
  const rows = contributionResult.rows.map((r) => ({
    sponsorId: r.sponsorId,
    sponsorName: r.sponsorName,
    tier: r.tier,
    amountUsd: Number(r.amountUsd) || 0,
  }));
  const goal = await loadGoalProgress(client, input.orgId, input.seasonYear);

  const lines = summarizeRoiLines(rows);
  const totalRaisedUsd = lines.reduce((sum, l) => sum + l.totalContributedUsd, 0);
  const templateNarrative = () =>
    buildRoiNarrative({
      seasonYear: input.seasonYear,
      lines,
      totalRaisedUsd,
      goalUsd: goal.goalUsd,
      attainmentPct: goal.attainmentPct,
    });
  // The per-sponsor lines and totals are computed from recorded contributions; a real model
  // call on the org's adapter writes the narrative, with the template standing in on failure.
  const rendered = await renderFeatureText({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "sponsor_suite_roi_report",
    prompt: [
      `End-of-season sponsor ROI narrative for the ${input.seasonYear} season, for the team's booster meeting. Write 1-2 short paragraphs in the template's structure: total raised, top sponsors, and progress against the season goal.`,
      `Total raised: $${totalRaisedUsd.toLocaleString()} across ${lines.length} sponsor(s).`,
      goal.goalUsd != null ? `Season goal: $${goal.goalUsd.toLocaleString()}${goal.attainmentPct != null ? ` (${Math.round(goal.attainmentPct * 100)}% attained)` : ""}.` : "Season goal: not set.",
      ...lines.slice(0, 6).map((line) => `- ${line.sponsorName}: $${line.totalContributedUsd.toLocaleString()}`),
      `Template: ${templateNarrative()}`,
      "Use only these figures; invent no sponsors, amounts or outcomes.",
    ].join("\n"),
    template: templateNarrative,
    metadata: { seasonYear: input.seasonYear, contributionCount: rows.length },
  });
  const narrative = rendered.text;
  const render = renderOutcomeOf(rendered);
  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO sponsor_suite_roi_reports (
       org_id, season_year, total_raised_usd, total_sponsors, goal_usd, goal_attainment_pct, lines, narrative, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING id, created_at AS "createdAt"`,
    [
      input.orgId,
      input.seasonYear,
      totalRaisedUsd,
      lines.length,
      goal.goalUsd,
      goal.attainmentPct,
      JSON.stringify(lines),
      narrative,
      input.userId,
    ],
  );

  return {
    id: inserted.rows[0]!.id,
    render,
    seasonYear: input.seasonYear,
    totalRaisedUsd,
    totalSponsors: lines.length,
    goalUsd: goal.goalUsd,
    goalAttainmentPct: goal.attainmentPct,
    lines,
    narrative,
    createdAt: inserted.rows[0]!.createdAt,
  };
}

export async function setGoal(
  client: PoolClient,
  input: { orgId: string; userId: string; seasonYear: number; goalUsd: number },
): Promise<void> {
  await client.query(
    `INSERT INTO sponsor_suite_goals (org_id, season_year, goal_usd, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id, season_year) DO UPDATE SET goal_usd = EXCLUDED.goal_usd, updated_at = now()`,
    [input.orgId, input.seasonYear, input.goalUsd, input.userId],
  );
}

export async function createReminder(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    sponsorId: string;
    kind: SponsorSuiteReminderKind;
    dueOn: string;
    note: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sponsor_suite_reminders (org_id, sponsor_id, kind, due_on, note, created_by)
     VALUES ($1,$2,$3,$4::date,$5,$6)`,
    [input.orgId, input.sponsorId, input.kind, input.dueOn, input.note, input.userId],
  );
}

export async function updateReminderStatus(
  client: PoolClient,
  input: { orgId: string; reminderId: string; status: "sent" | "dismissed" },
): Promise<void> {
  await client.query(
    `UPDATE sponsor_suite_reminders SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.reminderId, input.orgId],
  );
}

export async function deleteDeck(client: PoolClient, input: { orgId: string; deckId: string }): Promise<void> {
  await client.query(`DELETE FROM sponsor_suite_decks WHERE id = $1 AND org_id = $2`, [input.deckId, input.orgId]);
}
