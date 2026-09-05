import type { PoolClient } from "@neondatabase/serverless";
import { renderFeatureValue, type RenderOutcome } from "../ai-render/render";
import { buildSponsorRoiSections, computeSponsorRenewalRiskScore, renderSponsorRoiHtml } from ".";
import type { SponsorRenewalRiskScore, SponsorRenewalRoiReport, SponsorRenewalRoiSponsorSummary } from "./types";

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export type SponsorRenewalRoiSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type SponsorRenewalRoiView =
  | {
      status: "setup_required";
      message: string;
      steps: SponsorRenewalRoiSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      sponsors: SponsorRenewalRoiSponsorSummary[];
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

type SponsorRow = { id: string; name: string; tier: string; status: string };
type InteractionAggRow = { sponsorId: string; lastInteractionAt: string | null; count12mo: string | number };
type ContributionAggRow = {
  sponsorId: string;
  lastContributionAt: string | null;
  contributionCount: string | number;
  totalUsd: string | number;
};
type MentionAggRow = { sponsorId: string; mentionCount: string | number; evidenceCount: string | number };
type ReportRow = {
  id: string;
  sponsorId: string;
  sponsorName: string;
  seasonYear: number;
  title: string;
  riskScore: string | null;
  sections: unknown;
  htmlContent: string;
  createdAt: string;
};

function mapReport(row: ReportRow): SponsorRenewalRoiReport {
  return {
    id: row.id,
    sponsorId: row.sponsorId,
    sponsorName: row.sponsorName,
    seasonYear: row.seasonYear,
    title: row.title,
    riskScore: row.riskScore != null ? Number(row.riskScore) : null,
    sections: Array.isArray(row.sections) ? (row.sections as SponsorRenewalRoiReport["sections"]) : [],
    htmlContent: row.htmlContent,
    createdAt: row.createdAt,
  };
}

async function loadSponsorSignals(client: PoolClient, orgId: string) {
  const [sponsorsResult, interactionsResult, contributionsResult, mentionsResult] = await Promise.all([
    client.query<SponsorRow>(
      `SELECT id, name, tier::text AS tier, status::text AS status
       FROM sponsors WHERE org_id = $1 AND status <> 'declined' ORDER BY name`,
      [orgId],
    ),
    client.query<InteractionAggRow>(
      `SELECT sponsor_id AS "sponsorId", MAX(occurred_at)::text AS "lastInteractionAt",
              COUNT(*) FILTER (WHERE occurred_at >= now() - interval '365 days') AS "count12mo"
       FROM sponsor_interactions WHERE org_id = $1 GROUP BY sponsor_id`,
      [orgId],
    ),
    client.query<ContributionAggRow>(
      `SELECT sponsor_id AS "sponsorId", MAX(received_at)::text AS "lastContributionAt",
              COUNT(*) AS "contributionCount",
              COALESCE(SUM(COALESCE(amount_usd, 0) + COALESCE(estimated_value_usd, 0)), 0) AS "totalUsd"
       FROM sponsor_contributions WHERE org_id = $1 GROUP BY sponsor_id`,
      [orgId],
    ),
    client.query<MentionAggRow>(
      `SELECT s.id AS "sponsorId",
              COUNT(DISTINCT ia.id) AS "mentionCount",
              COUNT(DISTINCT oev.id) AS "evidenceCount"
       FROM sponsors s
       LEFT JOIN impact_activities ia ON ia.org_id = s.org_id
         AND ia.occurred_on >= (now() - interval '365 days')::date
         AND (ia.title ILIKE '%' || s.name || '%' OR ia.description ILIKE '%' || s.name || '%')
       LEFT JOIN outreach_evidence_vault_items oev ON oev.activity_id = ia.id
       WHERE s.org_id = $1
       GROUP BY s.id`,
      [orgId],
    ),
  ]);

  const interactionsBySponsor = new Map(interactionsResult.rows.map((row) => [row.sponsorId, row]));
  const contributionsBySponsor = new Map(contributionsResult.rows.map((row) => [row.sponsorId, row]));
  const mentionsBySponsor = new Map(mentionsResult.rows.map((row) => [row.sponsorId, row]));

  return { sponsors: sponsorsResult.rows, interactionsBySponsor, contributionsBySponsor, mentionsBySponsor };
}

function scoreForSponsor(
  sponsor: SponsorRow,
  now: Date,
  interaction: InteractionAggRow | undefined,
  contribution: ContributionAggRow | undefined,
  mention: MentionAggRow | undefined,
): SponsorRenewalRiskScore {
  return computeSponsorRenewalRiskScore({
    sponsorId: sponsor.id,
    sponsorName: sponsor.name,
    now,
    lastInteractionAt: interaction?.lastInteractionAt ? new Date(interaction.lastInteractionAt) : null,
    interactionCount12mo: Number(interaction?.count12mo ?? 0) || 0,
    lastContributionAt: contribution?.lastContributionAt ? new Date(contribution.lastContributionAt) : null,
    impactMentionCount12mo: Number(mention?.mentionCount ?? 0) || 0,
    evidenceItemCount: Number(mention?.evidenceCount ?? 0) || 0,
  });
}

export async function computeSponsorRenewalRoiView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<SponsorRenewalRoiView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to compute sponsor renewal-risk scores.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [{ sponsors, interactionsBySponsor, contributionsBySponsor, mentionsBySponsor }, reportsResult, seasonResult] =
    await Promise.all([
      loadSponsorSignals(client, org.orgId),
      client.query<ReportRow>(
        `SELECT DISTINCT ON (r.sponsor_id) r.id, r.sponsor_id AS "sponsorId", s.name AS "sponsorName",
                r.season_year AS "seasonYear", r.title, r.risk_score::text AS "riskScore",
                r.sections, r.html_content AS "htmlContent", r.created_at AS "createdAt"
         FROM sponsor_renewal_roi_reports r
         JOIN sponsors s ON s.id = r.sponsor_id
         WHERE r.org_id = $1
         ORDER BY r.sponsor_id, r.created_at DESC`,
        [org.orgId],
      ),
      client.query<{ seasonYear: number }>(
        `SELECT DISTINCT season_year AS "seasonYear" FROM sponsor_renewal_roi_reports WHERE org_id = $1 ORDER BY 1 DESC`,
        [org.orgId],
      ),
    ]);

  if (sponsors.length === 0) {
    return {
      status: "setup_required",
      message: "Add sponsors in the sponsors CRM before scoring renewal risk.",
      steps: [
        { id: "sponsors", label: "Add a sponsor", detail: "Record sponsors under Business → Sponsors", href: "/business?tab=sponsors" },
      ],
      orgId: org.orgId,
      seasonYear,
    };
  }

  const now = new Date();
  const reportsBySponsor = new Map(reportsResult.rows.map((row) => [row.sponsorId, mapReport(row)]));

  const sponsorSummaries: SponsorRenewalRoiSponsorSummary[] = sponsors.map((sponsor) => {
    const risk = scoreForSponsor(
      sponsor,
      now,
      interactionsBySponsor.get(sponsor.id),
      contributionsBySponsor.get(sponsor.id),
      mentionsBySponsor.get(sponsor.id),
    );
    return {
      sponsorId: sponsor.id,
      sponsorName: sponsor.name,
      tier: sponsor.tier,
      status: sponsor.status,
      risk,
      latestReport: reportsBySponsor.get(sponsor.id) ?? null,
    };
  });

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    sponsors: sponsorSummaries,
    computedAt: now.toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Generates a deterministic, sponsor-branded one-page ROI report grounded only in the
 * sponsor's recorded interactions, contributions, and community-impact mentions/evidence.
 * Rendered through renderWithModel (real model call, deterministic template fallback) so the run is billed and audited through the standard usage-ledger
 * path, matching every other metered feature (see grant-report / cad-brief).
 */
export async function generateSponsorRoiReport(
  client: PoolClient,
  input: { orgId: string; userId: string; sponsorId: string; seasonYear: number },
): Promise<SponsorRenewalRoiReport & { render: RenderOutcome }> {
  const sponsorRow = await client.query<{ name: string; tier: string; status: string }>(
    `SELECT name, tier::text AS tier, status::text AS status FROM sponsors WHERE id = $1 AND org_id = $2`,
    [input.sponsorId, input.orgId],
  );
  const sponsor = sponsorRow.rows[0];
  if (!sponsor) throw new Error("Sponsor not found");

  const { interactionsBySponsor, contributionsBySponsor, mentionsBySponsor } = await loadSponsorSignals(
    client,
    input.orgId,
  );
  const now = new Date();
  const interaction = interactionsBySponsor.get(input.sponsorId);
  const contribution = contributionsBySponsor.get(input.sponsorId);
  const mention = mentionsBySponsor.get(input.sponsorId);

  const risk = scoreForSponsor(
    { id: input.sponsorId, name: sponsor.name, tier: sponsor.tier, status: sponsor.status },
    now,
    interaction,
    contribution,
    mention,
  );

  // Real model call on the org's adapter with the deterministic sections as fallback: each
  // section body may be rewritten as sponsor-facing prose; headings, the risk score and every
  // contribution / interaction / mention figure come from the sponsor's own records.
  const { value: sections, render } = await renderFeatureValue({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "sponsor_renewal_roi",
    value: buildSponsorRoiSections({
      sponsorName: sponsor.name,
      seasonYear: input.seasonYear,
      risk,
      totalContributionUsd: Number(contribution?.totalUsd ?? 0) || 0,
      contributionCount: Number(contribution?.contributionCount ?? 0) || 0,
      interactionCount12mo: Number(interaction?.count12mo ?? 0) || 0,
      impactMentionCount12mo: Number(mention?.mentionCount ?? 0) || 0,
      evidenceItemCount: Number(mention?.evidenceCount ?? 0) || 0,
    }),
    editableKeys: ["body"],
    instructions: `Partnership ROI report for sponsor ${sponsor.name}, ${input.seasonYear} season (renewal risk tier: ${risk.tier}). Rewrite each section body as one short paragraph a sponsor contact would read, keeping every dollar amount, count and date exactly as given and adding no activities, mentions or outcomes not in the document.`,
    metadata: { sponsorId: input.sponsorId, seasonYear: input.seasonYear },
  });
  const result = {
    sections,
    htmlContent: renderSponsorRoiHtml({ sponsorName: sponsor.name, seasonYear: input.seasonYear, sections }),
  };

  const scoreInsert = await client.query<{ id: string }>(
    `INSERT INTO sponsor_renewal_roi_scores (org_id, sponsor_id, risk_score, risk_tier, components, season_year, computed_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
    [
      input.orgId,
      input.sponsorId,
      risk.score,
      risk.tier,
      JSON.stringify(risk.components),
      input.seasonYear,
      input.userId,
    ],
  );
  const scoreId = scoreInsert.rows[0]!.id;

  const title = `${sponsor.name} — ${input.seasonYear} Partnership ROI Report`;
  const reportInsert = await client.query<{ id: string; createdAt: string }>(
    `INSERT INTO sponsor_renewal_roi_reports
       (org_id, sponsor_id, score_id, season_year, title, risk_score, sections, html_content, ai_run_metadata, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10)
     RETURNING id, created_at AS "createdAt"`,
    [
      input.orgId,
      input.sponsorId,
      scoreId,
      input.seasonYear,
      title,
      risk.score,
      JSON.stringify(result.sections),
      result.htmlContent,
      JSON.stringify({ noLinkedActivity: risk.noLinkedActivity }),
      input.userId,
    ],
  );

  return {
    id: reportInsert.rows[0]!.id,
    render,
    sponsorId: input.sponsorId,
    sponsorName: sponsor.name,
    seasonYear: input.seasonYear,
    title,
    riskScore: risk.score,
    sections: result.sections,
    htmlContent: result.htmlContent,
    createdAt: reportInsert.rows[0]!.createdAt,
  };
}

export async function deleteSponsorRoiReport(
  client: PoolClient,
  input: { orgId: string; reportId: string },
): Promise<void> {
  await client.query(`DELETE FROM sponsor_renewal_roi_reports WHERE id = $1 AND org_id = $2`, [
    input.reportId,
    input.orgId,
  ]);
}
