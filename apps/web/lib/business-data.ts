import type { PoolClient } from "@neondatabase/serverless";
import {
  summarizeBudget,
  type AwardRecord,
  type BudgetCategory,
  type BusinessPortalView,
  type BusinessView,
  type GrantApplication,
  type PurchaseRequest,
  type Sponsor,
  type SponsorInteraction,
  type SponsorProspect,
  type WritingDraft,
} from "./business-portal";
import { buildOrdersPulse } from "./orders/business-pulse";
import {
  buildSponsorReminders,
  isPipelineStage,
  mapLegacyStatusToPipelineStage,
  summarizeFundraisingProgress,
  type SponsorPipelineStage,
} from "./sponsor-pipeline";

export function currentBusinessSeason(now = new Date()): number {
  return now.getUTCFullYear();
}

export function validSeason(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 2000 && number <= 3000 ? number : currentBusinessSeason();
}

function toCents(value: string | number | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export async function loadBusinessView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear: number },
): Promise<BusinessPortalView> {
  const membership = await client.query<{
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    role: string;
    teamAffiliation: "private_school" | "public_school" | "community" | null;
    schoolFunded: boolean | null;
    outsideGrants: boolean | null;
    sponsorsAllowed: boolean | null;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role::text AS role,
            o.team_affiliation AS "teamAffiliation",
            o.school_funded AS "schoolFunded",
            o.outside_grants AS "outsideGrants",
            o.sponsors_allowed AS "sponsorsAllowed"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );
  const org = membership.rows[0];
  if (!org) {
    if (input.requestedOrg) throw new Error("Organization access denied");
    return {
      status: "setup_required",
      message: "Select a team to manage budgets, sponsors, grants, and team evidence.",
      orgId: null,
      seasonYear: input.seasonYear,
    };
  }

  const orgId = org.orgId;
  const seasonYear = input.seasonYear;
  const [
    seasonResult,
    categoriesResult,
    purchasesResult,
    sponsorsResult,
    interactionsResult,
    prospectsResult,
    grantsResult,
    awardsResult,
    draftsResult,
    impactResult,
    monthResult,
    seasonsResult,
  ] = await Promise.all([
    client.query<{ totalBudgetUsd: string; fundraisingGoalUsd: string }>(
      `SELECT operating_budget_usd::text AS "totalBudgetUsd", fundraising_goal_usd::text AS "fundraisingGoalUsd"
       FROM finance_season_settings WHERE org_id = $1 AND season_year = $2`,
      [orgId, seasonYear],
    ),
    client.query<{ id: string; name: string; allocatedUsd: string }>(
      `SELECT c.id, c.name, COALESCE(p.total_limit_usd, 0)::text AS "allocatedUsd"
       FROM finance_categories c
       LEFT JOIN finance_budget_plans p ON p.category_id = c.id AND p.org_id = c.org_id
       WHERE c.org_id = $1 AND c.season_year = $2 ORDER BY c.name`,
      [orgId, seasonYear],
    ),
    client.query<{
      id: string; itemName: string; vendor: string; itemUrl: string | null; categoryId: string | null;
      categoryName: string | null; quantity: number; unitPriceUsd: string; shippingUsd: string; totalUsd: string;
      purpose: string; status: PurchaseRequest["status"]; requestedByName: string; requestedAt: string;
      neededBy: string | null; orderedOn: string | null;
    }>(
      `SELECT p.id, p.title AS "itemName", p.vendor, p.item_url AS "itemUrl",
              p.category_id AS "categoryId", c.name AS "categoryName", p.quantity,
              p.unit_cost_usd::text AS "unitPriceUsd", p.shipping_cost_usd::text AS "shippingUsd",
              p.total_cost_usd::text AS "totalUsd", COALESCE(p.justification, 'No justification recorded') AS purpose,
              CASE p.status::text WHEN 'pending' THEN 'submitted' WHEN 'reimbursed' THEN 'received' ELSE p.status::text END AS status,
              CASE WHEN p.requested_by = current_app_user_id() THEN 'You' ELSE 'Team member' END AS "requestedByName",
              p.created_at::text AS "requestedAt", p.needed_by::text AS "neededBy", p.ordered_at::date::text AS "orderedOn"
       FROM purchase_requests p
       LEFT JOIN finance_categories c ON c.id = p.category_id AND c.org_id = p.org_id
       WHERE p.org_id = $1 AND p.season_year = $2
       ORDER BY CASE p.status::text WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'ordered' THEN 2 ELSE 3 END, p.created_at DESC
       LIMIT 200`,
      [orgId, seasonYear],
    ),
    client.query<{
      id: string; name: string; status: Sponsor["status"]; pipelineStage: string | null; tier: string | null;
      website: string | null; industry: string | null; contactName: string | null; contactEmail: string | null;
      relationshipOwner: string | null; lastContactOn: string | null; nextFollowUpOn: string | null; notes: string | null;
      askUsd: string | null; pledgedUsd: string | null;
      thankYouDueOn: string | null; renewalDueOn: string | null;
      lifetimeUsd: string; seasonUsd: string; seasonCashUsd: string; hasUnthankedContribution: boolean;
    }>(
      `SELECT s.id, s.name, s.status::text AS status,
              COALESCE(s.pipeline_stage::text, NULL) AS "pipelineStage",
              s.tier::text AS tier, s.website, s.industry,
              contact.name AS "contactName", contact.email AS "contactEmail",
              s.relationship_owner AS "relationshipOwner",
              interaction.last_contact_on::text AS "lastContactOn",
              COALESCE(interaction.next_follow_up_on, s.next_follow_up_on)::text AS "nextFollowUpOn",
              s.notes,
              s.ask_amount_usd::text AS "askUsd",
              s.pledged_amount_usd::text AS "pledgedUsd",
              s.thank_you_due_on::text AS "thankYouDueOn",
              s.renewal_due_on::text AS "renewalDueOn",
              COALESCE(contribution.lifetime_usd, 0)::text AS "lifetimeUsd",
              COALESCE(contribution.season_usd, 0)::text AS "seasonUsd",
              COALESCE(contribution.season_cash_usd, 0)::text AS "seasonCashUsd",
              EXISTS (
                SELECT 1 FROM sponsor_contributions c
                WHERE c.sponsor_id = s.id AND c.org_id = s.org_id AND c.thank_you_sent_at IS NULL
              ) AS "hasUnthankedContribution"
       FROM sponsors s
       LEFT JOIN LATERAL (
         SELECT name, email FROM sponsor_contacts
         WHERE sponsor_id = s.id AND org_id = s.org_id ORDER BY is_primary DESC, created_at LIMIT 1
       ) contact ON true
       LEFT JOIN LATERAL (
         SELECT SUM(COALESCE(amount_usd, estimated_value_usd, 0)) AS lifetime_usd,
                SUM(COALESCE(amount_usd, estimated_value_usd, 0)) FILTER (WHERE season_year = $2) AS season_usd,
                SUM(COALESCE(amount_usd, 0)) FILTER (WHERE season_year = $2 AND type = 'cash') AS season_cash_usd
         FROM sponsor_contributions WHERE sponsor_id = s.id AND org_id = s.org_id
       ) contribution ON true
       LEFT JOIN LATERAL (
         SELECT MAX(occurred_at::date) AS last_contact_on,
                (ARRAY_AGG(next_follow_up_on ORDER BY occurred_at DESC)
                  FILTER (WHERE next_follow_up_on IS NOT NULL))[1] AS next_follow_up_on
         FROM sponsor_interactions WHERE sponsor_id = s.id AND org_id = s.org_id
       ) interaction ON true
       WHERE s.org_id = $1
       ORDER BY CASE COALESCE(s.pipeline_stage::text, 'prospect')
         WHEN 'renewal' THEN 0 WHEN 'active' THEN 1 WHEN 'pledged' THEN 2
         WHEN 'visit' THEN 3 WHEN 'ask' THEN 4 ELSE 5 END, s.name
       LIMIT 200`,
      [orgId, seasonYear],
    ),
    client.query<{
      id: string; sponsorId: string; sponsorName: string; interactionType: string; occurredOn: string;
      summary: string; nextStep: string | null; nextFollowUpOn: string | null; loggedByName: string;
    }>(
      `SELECT i.id, i.sponsor_id AS "sponsorId", s.name AS "sponsorName", i.type::text AS "interactionType",
              i.occurred_at::date::text AS "occurredOn", concat_ws(' — ', NULLIF(i.subject, ''), NULLIF(i.notes, '')) AS summary,
              i.next_step AS "nextStep", i.next_follow_up_on::text AS "nextFollowUpOn",
              CASE WHEN i.logged_by = current_app_user_id() THEN 'You' ELSE 'Team member' END AS "loggedByName"
       FROM sponsor_interactions i
       JOIN sponsors s ON s.id = i.sponsor_id AND s.org_id = i.org_id
       WHERE i.org_id = $1 ORDER BY i.occurred_at DESC, i.created_at DESC LIMIT 100`,
      [orgId],
    ),
    client.query<{
      id: string; name: string; website: string; summary: string; sourceTitle: string; sourceQuery: string;
      fitScore: number; fitReason: string; status: SponsorProspect["status"];
    }>(
      `SELECT id, company_name AS name, website, COALESCE(rationale, 'Review this candidate') AS summary,
              COALESCE(source_urls->>0, website) AS "sourceTitle", COALESCE(source_query, 'Sponsor fit research') AS "sourceQuery",
              fit_score AS "fitScore", COALESCE(rationale, 'Potential community fit') AS "fitReason",
              CASE status::text WHEN 'dismissed' THEN 'dismissed' WHEN 'contacted' THEN 'saved' ELSE 'new' END AS status
       FROM sponsor_prospects
       WHERE org_id = $1 AND status <> 'dismissed' AND website IS NOT NULL
       ORDER BY fit_score DESC, created_at DESC LIMIT 100`,
      [orgId],
    ),
    client.query<{
      id: string; funder: string; title: string; sourceUrl: string | null; deadline: string | null;
      status: GrantApplication["status"]; requestedUsd: string; awardedUsd: string; purpose: string;
      eligibility: string | null; requirements: string | null; ownerName: string | null; updatedAt: string;
    }>(
      `SELECT a.id, COALESCE(o.funder, 'Unknown funder') AS funder, COALESCE(o.name, 'Grant application') AS title,
              o.application_url AS "sourceUrl", o.deadline::text,
              CASE a.status::text WHEN 'identified' THEN 'researching' WHEN 'in_review' THEN 'review' ELSE a.status::text END AS status,
              COALESCE(a.amount_requested_usd, 0)::text AS "requestedUsd",
              COALESCE(a.amount_awarded_usd, 0)::text AS "awardedUsd",
              COALESCE(a.summary, o.description, 'No purpose recorded') AS purpose,
              o.eligibility_notes AS eligibility, item.requirements, a.owner_name AS "ownerName", a.updated_at::text AS "updatedAt"
       FROM grant_applications a
       LEFT JOIN grant_opportunities o ON o.id = a.grant_opportunity_id AND o.org_id = a.org_id
       LEFT JOIN LATERAL (
         SELECT STRING_AGG(prompt, E'\n' ORDER BY sort_order) FILTER (WHERE prompt IS NOT NULL) AS requirements
         FROM grant_application_items WHERE application_id = a.id AND org_id = a.org_id
       ) item ON true
       WHERE a.org_id = $1 AND a.season_year = $2
       ORDER BY CASE a.status::text WHEN 'drafting' THEN 0 WHEN 'in_review' THEN 1 WHEN 'identified' THEN 2 ELSE 3 END,
                o.deadline NULLS LAST, a.updated_at DESC LIMIT 150`,
      [orgId, seasonYear],
    ),
    client.query<AwardRecord>(
      `SELECT id, season_year AS "seasonYear", award_type AS "awardName",
              COALESCE(event_name, event_key) AS "eventName", award_level AS "awardLevel",
              summary AS story, source_url AS "sourceUrl"
       FROM award_submissions WHERE org_id = $1 AND status = 'won'
       ORDER BY season_year DESC, award_type LIMIT 200`,
      [orgId],
    ),
    client.query<WritingDraft>(
      `SELECT id, document_type AS "documentType", subject AS title,
              COALESCE(audience, 'Community partner') AS audience,
              COALESCE(goal, '') AS goal, body, evidence, status::text, created_at::text AS "createdAt"
       FROM outreach_messages
       WHERE org_id = $1 AND document_type IS NOT NULL AND created_at >= make_date($2, 1, 1)
       ORDER BY created_at DESC LIMIT 50`,
      [orgId, seasonYear],
    ),
    client.query<{ activities: string; minutes: string; peopleReached: string }>(
      `SELECT COUNT(*)::text AS activities, COALESCE(SUM(duration_minutes), 0)::text AS minutes,
              COALESCE(SUM(people_reached), 0)::text AS "peopleReached"
       FROM impact_activities WHERE org_id = $1 AND season_year = $2`,
      [orgId, seasonYear],
    ),
    client.query<{ month: string; amountUsd: string }>(
      `SELECT TO_CHAR(occurred_at, 'YYYY-MM') AS month, SUM(amount_usd)::text AS "amountUsd"
       FROM finance_transactions
       WHERE org_id = $1 AND season_year = $2 AND type = 'expense'
       GROUP BY TO_CHAR(occurred_at, 'YYYY-MM') ORDER BY month`,
      [orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM (
         SELECT season_year FROM finance_season_settings WHERE org_id = $1
         UNION ALL SELECT season_year FROM finance_categories WHERE org_id = $1
         UNION ALL SELECT season_year FROM purchase_requests WHERE org_id = $1
         UNION ALL SELECT season_year FROM grant_applications WHERE org_id = $1
         UNION ALL SELECT season_year FROM award_submissions WHERE org_id = $1
       ) seasons ORDER BY season_year DESC`,
      [orgId],
    ),
  ]);

  const categories: BudgetCategory[] = categoriesResult.rows.map((row) => ({ id: row.id, name: row.name, allocatedCents: toCents(row.allocatedUsd) }));
  const purchases: PurchaseRequest[] = purchasesResult.rows.map((row) => ({
    id: row.id,
    itemName: row.itemName,
    vendor: row.vendor,
    itemUrl: row.itemUrl,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    quantity: row.quantity,
    unitPriceCents: toCents(row.unitPriceUsd),
    shippingCents: toCents(row.shippingUsd),
    totalCents: toCents(row.totalUsd),
    purpose: row.purpose,
    status: row.status,
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt,
    neededBy: row.neededBy,
    orderedOn: row.orderedOn,
  }));
  const sponsors: Sponsor[] = sponsorsResult.rows.map((row) => {
    const pipelineStage: SponsorPipelineStage = isPipelineStage(row.pipelineStage)
      ? row.pipelineStage
      : mapLegacyStatusToPipelineStage(row.status);
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      pipelineStage,
      tier: row.tier,
      website: row.website,
      industry: row.industry,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      relationshipOwner: row.relationshipOwner,
      lastContactOn: row.lastContactOn,
      nextFollowUpOn: row.nextFollowUpOn,
      notes: row.notes,
      askCents: toCents(row.askUsd),
      pledgedCents: toCents(row.pledgedUsd),
      thankYouDueOn: row.thankYouDueOn,
      renewalDueOn: row.renewalDueOn,
      lifetimeCents: toCents(row.lifetimeUsd),
      seasonCents: toCents(row.seasonUsd),
      seasonCashCents: toCents(row.seasonCashUsd),
    };
  });
  const sponsorReminders = buildSponsorReminders(
    sponsors.map((sponsor) => ({
      ...sponsor,
      thankYouSentAt: sponsorsResult.rows.find((row) => row.id === sponsor.id)?.hasUnthankedContribution
        ? null
        : "handled",
    })),
  );
  const grants: GrantApplication[] = grantsResult.rows.map((row) => ({
    id: row.id,
    funder: row.funder,
    title: row.title,
    sourceUrl: row.sourceUrl,
    deadline: row.deadline,
    status: row.status,
    requestedCents: toCents(row.requestedUsd),
    awardedCents: toCents(row.awardedUsd),
    purpose: row.purpose,
    eligibility: row.eligibility,
    requirements: row.requirements,
    ownerName: row.ownerName,
    updatedAt: row.updatedAt,
  }));
  const season = seasonResult.rows[0];
  const allocatedCents = categories.reduce((total, category) => total + category.allocatedCents, 0);
  const configuredBudgetCents = toCents(season?.totalBudgetUsd);
  const totalBudgetCents = configuredBudgetCents > 0 ? configuredBudgetCents : allocatedCents;
  const sponsorIncomeCents = sponsors.reduce((total, sponsor) => total + sponsor.seasonCashCents, 0);
  const grantIncomeCents = grants.reduce((total, grant) => total + grant.awardedCents, 0);
  const fundraisingGoalCents = toCents(season?.fundraisingGoalUsd);
  const fundraisingProgress = summarizeFundraisingProgress({
    fundraisingGoalCents,
    sponsors,
    grantIncomeCents,
  });
  const totals = summarizeBudget({ totalBudgetCents, purchases, sponsorIncomeCents, grantIncomeCents });
  const impactRow = impactResult.rows[0];
  const seasons = seasonsResult.rows.map((row) => Number(row.seasonYear));
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  let financeAiEnabled = false;
  try {
    const aiFlag = await client.query<{ aiAssistEnabled: boolean }>(
      `SELECT ai_assist_enabled AS "aiAssistEnabled"
       FROM season_budgets WHERE org_id = $1 AND season_year = $2`,
      [orgId, seasonYear],
    );
    financeAiEnabled = Boolean(aiFlag.rows[0]?.aiAssistEnabled);
  } catch {
    // stays false
  }
  const ordersPulse = buildOrdersPulse(purchases, seasonYear, financeAiEnabled);

  return {
    status: "live",
    orgId,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    role: org.role,
    canManageFinance: org.role === "owner" || org.role === "admin",
    seasonYear,
    seasons,
    teamAffiliation: org.teamAffiliation ?? null,
    schoolFunded: org.schoolFunded ?? null,
    outsideGrants: org.outsideGrants ?? null,
    sponsorsAllowed: org.sponsorsAllowed ?? null,
    budget: {
      totalBudgetCents,
      fundraisingGoalCents,
      sponsorIncomeCents,
      grantIncomeCents,
      ...totals,
      monthlySpend: monthResult.rows.map((row) => ({ month: row.month, cents: toCents(row.amountUsd) })),
    },
    impact: {
      activities: Number(impactRow?.activities ?? 0),
      hours: Math.round((Number(impactRow?.minutes ?? 0) / 60) * 10) / 10,
      peopleReached: Number(impactRow?.peopleReached ?? 0),
    },
    categories,
    purchases,
    ordersPulse,
    sponsors,
    fundraisingProgress,
    sponsorReminders,
    interactions: interactionsResult.rows as SponsorInteraction[],
    prospects: prospectsResult.rows,
    grants,
    awards: awardsResult.rows,
    drafts: draftsResult.rows,
  } satisfies BusinessView;
}
