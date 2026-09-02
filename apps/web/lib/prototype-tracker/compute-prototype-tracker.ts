import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureValue, type RenderOutcome } from "../ai-render/render";
import { DECISION_RECOMMENDATIONS, DECISION_STATUSES, TEST_OUTCOMES, draftDecision } from ".";
import type {
  DecisionRecommendation,
  DecisionStatus,
  PrototypeDecision,
  PrototypeTest,
  TestOutcome,
} from "./types";

export { DECISION_RECOMMENDATIONS, DECISION_STATUSES, TEST_OUTCOMES };

export type PrototypeTrackerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type PrototypeTrackerView =
  | {
      status: "setup_required";
      message: string;
      steps: PrototypeTrackerSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      tests: PrototypeTest[];
      decisions: PrototypeDecision[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isOutcome(value: unknown): value is TestOutcome {
  return typeof value === "string" && (TEST_OUTCOMES as string[]).includes(value);
}

function isRecommendation(value: unknown): value is DecisionRecommendation {
  return typeof value === "string" && (DECISION_RECOMMENDATIONS as string[]).includes(value);
}

function isStatus(value: unknown): value is DecisionStatus {
  return typeof value === "string" && (DECISION_STATUSES as string[]).includes(value);
}

type TestRow = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  title: string;
  hypothesis: string;
  testDate: string;
  outcome: string;
  resultSummary: string;
  metricLabel: string | null;
  metricValue: string | null;
  metricTarget: string | null;
  createdAt: string;
};

function mapTest(row: TestRow): PrototypeTest {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystemName: row.subsystemName,
    title: row.title,
    hypothesis: row.hypothesis,
    testDate: row.testDate,
    outcome: isOutcome(row.outcome) ? row.outcome : "inconclusive",
    resultSummary: row.resultSummary,
    metricLabel: row.metricLabel,
    metricValue: row.metricValue == null ? null : Number(row.metricValue),
    metricTarget: row.metricTarget == null ? null : Number(row.metricTarget),
    createdAt: row.createdAt,
  };
}

type DecisionRow = {
  id: string;
  testId: string;
  decisionTitle: string;
  recommendation: string;
  confidence: string;
  decisionRecord: string;
  notebookEntry: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

function mapDecision(row: DecisionRow): PrototypeDecision {
  return {
    id: row.id,
    testId: row.testId,
    decisionTitle: row.decisionTitle,
    recommendation: isRecommendation(row.recommendation) ? row.recommendation : "needs_more_data",
    confidence: Number(row.confidence) || 0,
    decisionRecord: row.decisionRecord,
    notebookEntry: row.notebookEntry,
    status: isStatus(row.status) ? row.status : "draft",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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

export async function computePrototypeTrackerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<PrototypeTrackerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track prototype tests and decisions.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [testResult, decisionResult, seasonResult] = await Promise.all([
    client.query<TestRow>(
      `SELECT id, season_year AS "seasonYear", subsystem_name AS "subsystemName", title, hypothesis,
              test_date::text AS "testDate", outcome, result_summary AS "resultSummary",
              metric_label AS "metricLabel", metric_value::text AS "metricValue",
              metric_target::text AS "metricTarget", created_at AS "createdAt"
       FROM prototype_tracker_tests
       WHERE org_id = $1 AND season_year = $2
       ORDER BY test_date DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<DecisionRow>(
      `SELECT d.id, d.test_id AS "testId", d.decision_title AS "decisionTitle", d.recommendation,
              d.confidence::text AS confidence, d.decision_record AS "decisionRecord",
              d.notebook_entry AS "notebookEntry", d.status,
              d.created_at AS "createdAt", d.updated_at AS "updatedAt"
       FROM prototype_tracker_decisions d
       JOIN prototype_tracker_tests t ON t.id = d.test_id
       WHERE d.org_id = $1 AND t.season_year = $2
       ORDER BY d.created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM prototype_tracker_tests WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    tests: testResult.rows.map(mapTest),
    decisions: decisionResult.rows.map(mapDecision),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logTest(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    subsystemName: string;
    title: string;
    hypothesis: string;
    testDate: string;
    outcome: TestOutcome;
    resultSummary: string;
    metricLabel: string | null;
    metricValue: number | null;
    metricTarget: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO prototype_tracker_tests (
       org_id, season_year, subsystem_name, title, hypothesis, test_date, outcome, result_summary,
       metric_label, metric_value, metric_target, logged_by
     ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12)`,
    [
      input.orgId,
      input.seasonYear,
      input.subsystemName,
      input.title,
      input.hypothesis,
      input.testDate,
      input.outcome,
      input.resultSummary,
      input.metricLabel,
      input.metricValue,
      input.metricTarget,
      input.userId,
    ],
  );
}

export async function draftDecisionForTest(
  client: PoolClient,
  input: { orgId: string; userId: string; testId: string; decisionTitle: string },
): Promise<RenderOutcome> {
  const testResult = await client.query<TestRow>(
    `SELECT id, season_year AS "seasonYear", subsystem_name AS "subsystemName", title, hypothesis,
            test_date::text AS "testDate", outcome, result_summary AS "resultSummary",
            metric_label AS "metricLabel", metric_value::text AS "metricValue",
            metric_target::text AS "metricTarget", created_at AS "createdAt"
     FROM prototype_tracker_tests WHERE id = $1 AND org_id = $2`,
    [input.testId, input.orgId],
  );
  const testRow = testResult.rows[0];
  if (!testRow) throw new Error("Prototype test not found");
  const test = mapTest(testRow);

  // Real model call on the org's adapter with the deterministic draft as fallback: the
  // decision record and notebook entry prose may be rewritten; recommendation and
  // confidence stay computed from the logged outcome and metric attainment.
  const { value: draft, render } = await renderFeatureValue({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "prototype_tracker",
    value: draftDecision({
      subsystemName: test.subsystemName,
      title: test.title,
      hypothesis: test.hypothesis,
      outcome: test.outcome,
      resultSummary: test.resultSummary,
      metricLabel: test.metricLabel,
      metricValue: test.metricValue,
      metricTarget: test.metricTarget,
    }),
    editableKeys: ["decisionRecord", "notebookEntry"],
    instructions: `Prototype test "${test.title}" on the ${test.subsystemName} subsystem (${test.seasonYear}). Hypothesis: ${test.hypothesis ?? "not stated"}. Outcome: ${test.outcome}. Result: ${test.resultSummary ?? "not summarized"}. Rewrite decisionRecord as a 2-3 sentence design-decision entry and notebookEntry as an engineering-notebook paragraph, both consistent with the recommendation in the document; keep every metric value exactly as given.`,
    metadata: { testId: input.testId, subsystemName: test.subsystemName, seasonYear: test.seasonYear },
  });

  await client.query(
    `INSERT INTO prototype_tracker_decisions (
       org_id, test_id, decision_title, recommendation, confidence, decision_record, notebook_entry, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.testId,
      input.decisionTitle,
      draft.recommendation,
      draft.confidence,
      draft.decisionRecord,
      draft.notebookEntry,
      input.userId,
    ],
  );
  return render;
}

export async function updateDecisionStatus(
  client: PoolClient,
  input: { orgId: string; decisionId: string; status: DecisionStatus },
): Promise<void> {
  await client.query(
    `UPDATE prototype_tracker_decisions SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.decisionId, input.orgId],
  );
}

export async function deleteTest(
  client: PoolClient,
  input: { orgId: string; testId: string },
): Promise<void> {
  await client.query(`DELETE FROM prototype_tracker_tests WHERE id = $1 AND org_id = $2`, [
    input.testId,
    input.orgId,
  ]);
}

export async function deleteDecision(
  client: PoolClient,
  input: { orgId: string; decisionId: string },
): Promise<void> {
  await client.query(`DELETE FROM prototype_tracker_decisions WHERE id = $1 AND org_id = $2`, [
    input.decisionId,
    input.orgId,
  ]);
}
