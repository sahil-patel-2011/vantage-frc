import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { randomUUID } from "node:crypto";
import {
  buildCounterBookSummary,
  buildCounterPlan,
  computeFailureTriggers,
  computeTendencies,
} from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { CounterBookFailureTrigger, CounterBookReport, CounterBookTendency } from "./types";

export const COUNTER_BOOK_AI_MODEL = "vantage-counter-book-v1";
export const COUNTER_BOOK_USAGE_FEATURE = "counter_book.generate";

export type CounterBookSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO opponent metrics. */
function setupSteps(orgId: string | null): CounterBookSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open Counter-book.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists stay empty until real metrics exist.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout rows stay blank until your team enters them.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

export type CounterBookView =
  | {
      status: "setup_required";
      message: string;
      steps: CounterBookSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      reports: CounterBookReport[];
      computedAt: string;
    };

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

type ReportRow = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  eventKey: string | null;
  title: string;
  matchesScouted: number;
  tendencies: CounterBookTendency[] | null;
  failureTriggers: CounterBookFailureTrigger[] | null;
  counterPlan: string;
  summary: string;
  createdAt: string;
};

function mapReport(row: ReportRow): CounterBookReport {
  return {
    id: row.id,
    teamKey: row.teamKey,
    teamNumber: row.teamNumber,
    eventKey: row.eventKey,
    title: row.title,
    matchesScouted: Number(row.matchesScouted) || 0,
    tendencies: Array.isArray(row.tendencies) ? row.tendencies : [],
    failureTriggers: Array.isArray(row.failureTriggers) ? row.failureTriggers : [],
    counterPlan: row.counterPlan,
    summary: row.summary,
    createdAt: row.createdAt,
  };
}

export async function computeCounterBookView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<CounterBookView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to generate opponent counter-books.",
      steps: setupSteps(null),
      orgId: null,
    };
  }

  const reportResult = await client.query<ReportRow>(
    `SELECT id, team_key AS "teamKey", team_number AS "teamNumber", event_key AS "eventKey",
            title, matches_scouted AS "matchesScouted", tendencies, failure_triggers AS "failureTriggers",
            counter_plan AS "counterPlan", summary, created_at::text AS "createdAt"
     FROM counter_book_reports
     WHERE org_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [org.orgId],
  );

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    reports: reportResult.rows.map(mapReport),
    computedAt: new Date().toISOString(),
  };
}

/** Generate a one-page counter-book for `teamKey`, grounded ONLY in this org's own scouted payloads. */
export async function generateCounterBookReport(
  client: PoolClient,
  input: { orgId: string; userId: string; teamKey: string; eventKey: string | null },
): Promise<CounterBookReport> {
  const teamRow = (
    await client.query<{ teamNumber: number | null }>(
      `SELECT team_number AS "teamNumber" FROM teams_ref WHERE team_key = $1`,
      [input.teamKey],
    )
  ).rows[0];
  const teamNumber = teamRow?.teamNumber ?? null;
  const teamLabel = teamNumber ? `Team ${teamNumber}` : input.teamKey;

  const matchRows = await client.query<{ payload: Record<string, unknown> }>(
    `SELECT payload
     FROM match_scout_entries
     WHERE org_id = $1 AND team_key = $2 AND ($3::text IS NULL OR event_key = $3)
     ORDER BY updated_at DESC
     LIMIT 200`,
    [input.orgId, input.teamKey, input.eventKey],
  );

  if (matchRows.rowCount === 0) {
    throw new Error(`No scouted matches for ${teamLabel} yet — log match scouting entries before generating a counter-book.`);
  }

  const payloads = matchRows.rows.map((row) => row.payload ?? {});
  const tendencies = computeTendencies(payloads);
  const failureTriggers = computeFailureTriggers(tendencies);
  const counterPlan = buildCounterPlan(teamLabel, tendencies, failureTriggers);
  const summary = buildCounterBookSummary(teamLabel, payloads.length, tendencies);
  const requestId = `counter-book-${randomUUID()}`;

  const generated = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: COUNTER_BOOK_USAGE_FEATURE,
    requestId,
    estimatedCostUsd: 0,
    model: COUNTER_BOOK_AI_MODEL,
    provider: "local",
    metadata: { teamKey: input.teamKey, eventKey: input.eventKey, matchesScouted: payloads.length },
    invoke: async () => {
      const text = counterPlan;
      return {
        value: { counterPlan, summary, tendencies, failureTriggers },
        promptTokens: Math.ceil(JSON.stringify(payloads).length / 4),
        completionTokens: Math.ceil(text.length / 4),
        costUsd: 0,
        model: COUNTER_BOOK_AI_MODEL,
        provider: "local",
      };
    },
  });

  const title = `Counter-book — ${teamLabel}${input.eventKey ? ` @ ${input.eventKey}` : ""}`;
  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO counter_book_reports(
       org_id, team_key, team_number, event_key, title, matches_scouted,
       tendencies, failure_triggers, counter_plan, summary, ai_model, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)
     RETURNING id, created_at::text AS "createdAt"`,
    [
      input.orgId,
      input.teamKey,
      teamNumber,
      input.eventKey,
      title,
      payloads.length,
      JSON.stringify(generated.tendencies),
      JSON.stringify(generated.failureTriggers),
      generated.counterPlan,
      generated.summary,
      COUNTER_BOOK_AI_MODEL,
      input.userId,
    ],
  );

  return {
    id: inserted.rows[0]!.id,
    teamKey: input.teamKey,
    teamNumber,
    eventKey: input.eventKey,
    title,
    matchesScouted: payloads.length,
    tendencies: generated.tendencies,
    failureTriggers: generated.failureTriggers,
    counterPlan: generated.counterPlan,
    summary: generated.summary,
    createdAt: inserted.rows[0]!.createdAt,
  };
}

export async function deleteCounterBookReport(
  client: PoolClient,
  input: { orgId: string; reportId: string },
): Promise<void> {
  await client.query(`DELETE FROM counter_book_reports WHERE id = $1 AND org_id = $2`, [
    input.reportId,
    input.orgId,
  ]);
}
