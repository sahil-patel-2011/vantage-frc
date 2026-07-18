import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { buildGrantReportSections, buildGrantReportNarrative, summarizeOutreach, summarizeSpend } from ".";
import type { GrantReport, GrantReportEligibleGrant } from "./types";

export type GrantReportSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type GrantReportView =
  | {
      status: "setup_required";
      message: string;
      steps: GrantReportSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      eligibleGrants: GrantReportEligibleGrant[];
      reports: GrantReport[];
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

type EligibleGrantRow = {
  id: string;
  name: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: string | null;
  decisionAt: string | null;
  hasReport: boolean;
};

function mapEligibleGrant(row: EligibleGrantRow): GrantReportEligibleGrant {
  return {
    id: row.id,
    name: row.name,
    funder: row.funder,
    seasonYear: row.seasonYear,
    amountAwardedUsd: row.amountAwardedUsd != null ? Number(row.amountAwardedUsd) || 0 : 0,
    decisionAt: row.decisionAt,
    hasReport: row.hasReport,
  };
}

type ReportRow = {
  id: string;
  grantApplicationId: string;
  grantName: string;
  funder: string | null;
  seasonYear: number;
  amountAwardedUsd: string;
  totalSpendUsd: string;
  outreachCount: number;
  outreachByKind: GrantReport["outreachByKind"];
  spendByCategory: GrantReport["spendByCategory"];
  sections: GrantReport["sections"];
  narrative: string;
  createdAt: string;
};

function mapReport(row: ReportRow): GrantReport {
  return {
    id: row.id,
    grantApplicationId: row.grantApplicationId,
    grantName: row.grantName,
    funder: row.funder,
    seasonYear: row.seasonYear,
    amountAwardedUsd: Number(row.amountAwardedUsd) || 0,
    totalSpendUsd: Number(row.totalSpendUsd) || 0,
    outreachCount: Number(row.outreachCount) || 0,
    outreachByKind: Array.isArray(row.outreachByKind) ? row.outreachByKind : [],
    spendByCategory: Array.isArray(row.spendByCategory) ? row.spendByCategory : [],
    sections: Array.isArray(row.sections) ? row.sections : [],
    narrative: row.narrative,
    createdAt: row.createdAt,
  };
}

export async function computeGrantReportView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<GrantReportView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to generate post-grant impact reports.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [eligibleResult, seasonResult, reportResult] = await Promise.all([
    client.query<EligibleGrantRow>(
      `SELECT ga.id, go.name, go.funder, ga.season_year AS "seasonYear",
              ga.amount_awarded_usd::text AS "amountAwardedUsd",
              ga.decision_at::text AS "decisionAt",
              EXISTS(SELECT 1 FROM grant_report_reports r WHERE r.grant_application_id = ga.id) AS "hasReport"
       FROM grant_applications ga
       LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
       WHERE ga.org_id = $1 AND ga.status = 'awarded'
       ORDER BY ga.decision_at DESC NULLS LAST`,
      [org.orgId],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM grant_applications WHERE org_id = $1 AND status = 'awarded'
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
    client.query<ReportRow>(
      `SELECT r.id, r.grant_application_id AS "grantApplicationId",
              COALESCE(go.name, 'Grant') AS "grantName", go.funder,
              r.season_year AS "seasonYear", r.amount_awarded_usd::text AS "amountAwardedUsd",
              r.total_spend_usd::text AS "totalSpendUsd", r.outreach_count AS "outreachCount",
              r.outreach_by_kind AS "outreachByKind", r.spend_by_category AS "spendByCategory",
              r.sections, r.narrative, r.created_at AS "createdAt"
       FROM grant_report_reports r
       JOIN grant_applications ga ON ga.id = r.grant_application_id
       LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
       WHERE r.org_id = $1 AND r.season_year = $2
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [org.orgId, seasonYear],
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
    eligibleGrants: eligibleResult.rows.map(mapEligibleGrant),
    reports: reportResult.rows.map(mapReport),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Generate a deterministic post-grant impact report grounded only in the grant's recorded award
 * amount, outreach_messages linked to it, and finance_transactions expenses recorded for the
 * grant's season. Wrapped in meteredAI so the run is billed and audited through the standard
 * usage-ledger path, matching every other metered feature.
 */
export async function generateGrantReport(
  client: PoolClient,
  input: { orgId: string; userId: string; grantApplicationId: string },
): Promise<GrantReport> {
  const grantRow = await client.query<{
    name: string;
    funder: string | null;
    seasonYear: number;
    amountAwardedUsd: string | null;
    status: string;
  }>(
    `SELECT COALESCE(go.name, 'Grant') AS name, go.funder, ga.season_year AS "seasonYear",
            ga.amount_awarded_usd::text AS "amountAwardedUsd", ga.status::text AS status
     FROM grant_applications ga
     LEFT JOIN grant_opportunities go ON go.id = ga.grant_opportunity_id
     WHERE ga.id = $1 AND ga.org_id = $2`,
    [input.grantApplicationId, input.orgId],
  );
  const grant = grantRow.rows[0];
  if (!grant) throw new Error("Grant application not found");
  if (grant.status !== "awarded") throw new Error("Grant must be awarded before generating a report");

  const seasonYear = grant.seasonYear;
  const amountAwardedUsd = grant.amountAwardedUsd != null ? Number(grant.amountAwardedUsd) || 0 : 0;

  const [outreachResult, spendResult] = await Promise.all([
    client.query<{ kind: string }>(
      `SELECT kind::text AS kind FROM outreach_messages
       WHERE org_id = $1 AND grant_application_id = $2`,
      [input.orgId, input.grantApplicationId],
    ),
    client.query<{ category: string; amountUsd: string }>(
      `SELECT COALESCE(fc.name, 'Uncategorized') AS category, ft.amount_usd::text AS "amountUsd"
       FROM finance_transactions ft
       LEFT JOIN finance_categories fc ON fc.id = ft.category_id
       WHERE ft.org_id = $1 AND ft.season_year = $2 AND ft.type = 'expense'`,
      [input.orgId, seasonYear],
    ),
  ]);

  const outreachByKind = summarizeOutreach(outreachResult.rows);
  const spendByCategory = summarizeSpend(
    spendResult.rows.map((r) => ({ category: r.category, amountUsd: Number(r.amountUsd) || 0 })),
  );
  const outreachCount = outreachByKind.reduce((sum, line) => sum + line.count, 0);
  const totalSpendUsd = spendByCategory.reduce((sum, line) => sum + line.totalUsd, 0);

  const result = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "grant_report_generate",
    requestId: `grant-report-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: { grantApplicationId: input.grantApplicationId, seasonYear },
    invoke: async () => {
      const sections = buildGrantReportSections({
        grantName: grant.name,
        funder: grant.funder,
        seasonYear,
        amountAwardedUsd,
        outreachByKind,
        spendByCategory,
      });
      const narrative = buildGrantReportNarrative(sections);
      return {
        value: { sections, narrative },
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "vantage-grant-report-v1",
        provider: "vantage-local",
      };
    },
  });

  const { sections, narrative } = result;
  const inserted = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO grant_report_reports (
       org_id, grant_application_id, season_year, amount_awarded_usd, total_spend_usd,
       outreach_count, outreach_by_kind, spend_by_category, sections, narrative, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING id, created_at AS "createdAt"`,
    [
      input.orgId,
      input.grantApplicationId,
      seasonYear,
      amountAwardedUsd,
      totalSpendUsd,
      outreachCount,
      JSON.stringify(outreachByKind),
      JSON.stringify(spendByCategory),
      JSON.stringify(sections),
      narrative,
      input.userId,
    ],
  );

  return {
    id: inserted.rows[0]!.id,
    grantApplicationId: input.grantApplicationId,
    grantName: grant.name,
    funder: grant.funder,
    seasonYear,
    amountAwardedUsd,
    totalSpendUsd,
    outreachCount,
    outreachByKind,
    spendByCategory,
    sections,
    narrative,
    createdAt: inserted.rows[0]!.createdAt,
  };
}

export async function deleteGrantReport(
  client: PoolClient,
  input: { orgId: string; reportId: string },
): Promise<void> {
  await client.query(`DELETE FROM grant_report_reports WHERE id = $1 AND org_id = $2`, [
    input.reportId,
    input.orgId,
  ]);
}
