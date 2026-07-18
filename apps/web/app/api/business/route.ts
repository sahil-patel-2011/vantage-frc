import type { PoolClient } from "@neondatabase/serverless";
import { auth, emitPreferredNotification } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadBusinessView, validSeason } from "../../../lib/business-data";
import {
  DRAFT_TYPES,
  GRANT_STATUSES,
  PURCHASE_STATUSES,
  SPONSOR_STATUSES,
  generateEvidenceDraft,
  type BusinessView,
  type DraftType,
  type GrantStatus,
  type PurchaseStatus,
  type SponsorStatus,
} from "../../../lib/business-portal";

type JsonBody = Record<string, unknown>;

function text(value: unknown, max = 2_000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cents(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0;
}

function dollars(value: unknown): number {
  return Math.round((cents(value) / 100) * 100) / 100;
}

function positiveInt(value: unknown, fallback = 1): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function date(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function choice<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : null;
}

function webUrl(value: unknown): string | null {
  const candidate = text(value, 2_000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

async function membership(client: PoolClient, orgId: string, userId: string) {
  const result = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1 AND user_id = $2`,
    [orgId, userId],
  );
  if (!result.rows[0]) throw new Error("Organization access denied");
  return { role: result.rows[0].role, admin: ["owner", "admin"].includes(result.rows[0].role) };
}

function requireAdmin(member: { admin: boolean }) {
  if (!member.admin) throw new Error("A team owner or admin must complete this finance action");
}

async function audit(
  client: PoolClient,
  input: { orgId: string; userId: string; action: string; entityType: string; entityId?: string | null; metadata?: JsonBody },
) {
  await client.query(
    `INSERT INTO team_business_audit_events(org_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [input.orgId, input.userId, input.action, input.entityType, input.entityId ?? null, JSON.stringify(input.metadata ?? {})],
  );
}

const purchaseDbStatus: Record<Exclude<PurchaseStatus, "submitted">, string> = {
  approved: "approved",
  ordered: "ordered",
  received: "received",
  rejected: "rejected",
};

const grantDbStatus: Record<GrantStatus, string> = {
  researching: "identified",
  drafting: "drafting",
  review: "in_review",
  submitted: "submitted",
  awarded: "awarded",
  declined: "declined",
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonYear = validSeason(url.searchParams.get("season"));
  try {
    const view = await withRls({ userId: session.user.id, orgId: requestedOrg ?? undefined }, (client) =>
      loadBusinessView(client, { userId: session.user.id, requestedOrg, seasonYear }),
    );
    return Response.json(view);
  } catch (error) {
    if (error instanceof Error && /access denied/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    const message = error instanceof Error && /finance_season_settings|shipping_cost_usd|document_type/.test(error.message)
      ? "The Team Business Portal database migration has not been applied yet."
      : "Could not load the Team Business Portal.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: JsonBody;
  try {
    body = (await request.json()) as JsonBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = text(body.orgId, 64);
  const action = text(body.action, 80);
  const seasonYear = validSeason(body.seasonYear);
  if (!orgId || !action) return Response.json({ error: "orgId and action are required" }, { status: 400 });

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await membership(client, orgId, session.user.id);
      let entityId: string | null;

      switch (action) {
        case "save-budget": {
          requireAdmin(member);
          await client.query(
            `INSERT INTO finance_season_settings(
               org_id, season_year, operating_budget_usd, fundraising_goal_usd, notes, updated_by
             ) VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (org_id, season_year) DO UPDATE SET
               operating_budget_usd = EXCLUDED.operating_budget_usd,
               fundraising_goal_usd = EXCLUDED.fundraising_goal_usd,
               notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [orgId, seasonYear, dollars(body.totalBudgetCents), dollars(body.fundraisingGoalCents), text(body.notes, 4_000), session.user.id],
          );
          await audit(client, { orgId, userId: session.user.id, action, entityType: "season_budget", metadata: { seasonYear } });
          break;
        }
        case "add-category": {
          requireAdmin(member);
          const name = text(body.name, 120);
          if (!name) throw new Error("Category name is required");
          const inserted = await client.query<{ id: string }>(
            `WITH category AS (
               INSERT INTO finance_categories(org_id, season_year, name)
               VALUES ($1,$2,$3)
               ON CONFLICT (org_id, season_year, name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id
             )
             INSERT INTO finance_budget_plans(org_id, category_id, total_limit_usd, set_by)
             SELECT $1, id, $4, $5 FROM category
             ON CONFLICT (category_id) DO UPDATE SET
               total_limit_usd = EXCLUDED.total_limit_usd, set_by = EXCLUDED.set_by, updated_at = now()
             RETURNING category_id AS id`,
            [orgId, seasonYear, name, dollars(body.allocatedCents), session.user.id],
          );
          entityId = inserted.rows[0]?.id ?? null;
          await audit(client, { orgId, userId: session.user.id, action, entityType: "budget_category", entityId });
          break;
        }
        case "submit-purchase": {
          const itemName = text(body.itemName, 240);
          const purpose = text(body.purpose, 2_000);
          const categoryId = text(body.categoryId, 64);
          if (!itemName || !purpose) throw new Error("Item name and team purpose are required");
          if (categoryId) {
            const category = await client.query(`SELECT 1 FROM finance_categories WHERE id = $1 AND org_id = $2 AND season_year = $3`, [categoryId, orgId, seasonYear]);
            if (!category.rowCount) throw new Error("Choose a budget category from this season");
          }
          const quantity = positiveInt(body.quantity);
          const unitCost = dollars(body.unitPriceCents);
          const shipping = dollars(body.shippingCents);
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO purchase_requests(
               org_id, season_year, category_id, requested_by, title, vendor, item_url,
               quantity, unit_cost_usd, shipping_cost_usd, total_cost_usd, justification, needed_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date) RETURNING id`,
            [orgId, seasonYear, categoryId, session.user.id, itemName, text(body.vendor, 120) ?? "amazon", webUrl(body.itemUrl), quantity, unitCost, shipping, Math.round((quantity * unitCost + shipping) * 100) / 100, purpose, date(body.neededBy)],
          );
          entityId = inserted.rows[0]?.id ?? null;
          await audit(client, { orgId, userId: session.user.id, action, entityType: "purchase_request", entityId });
          if (entityId) {
            const total = Math.round((quantity * unitCost + shipping) * 100) / 100;
            const admins = await client.query<{ userId: string }>(
              `SELECT user_id AS "userId" FROM memberships
               WHERE org_id = $1 AND role IN ('owner', 'admin') AND user_id <> $2`,
              [orgId, session.user.id],
            );
            const href = `/orders?orgId=${encodeURIComponent(orgId)}&orderId=${encodeURIComponent(entityId)}`;
            for (const adminRow of admins.rows) {
              await emitPreferredNotification(client, {
                userId: adminRow.userId,
                orgId,
                type: "purchase_request_submitted",
                payload: {
                  title: "New purchase request",
                  body: `${itemName} (~$${total})`,
                  orderId: entityId,
                  href,
                },
              });
            }
          }
          break;
        }
        case "set-purchase-status": {
          requireAdmin(member);
          const purchaseId = text(body.purchaseId, 64);
          const status = choice<PurchaseStatus>(PURCHASE_STATUSES, body.status);
          if (!purchaseId || !status || status === "submitted") throw new Error("A purchase and review status are required");
          const current = await client.query<{
            status: string; totalCostUsd: string; categoryId: string | null; seasonYear: number; title: string;
          }>(
            `SELECT status::text, total_cost_usd::text AS "totalCostUsd", category_id AS "categoryId",
                    season_year AS "seasonYear", title FROM purchase_requests WHERE id = $1 AND org_id = $2`,
            [purchaseId, orgId],
          );
          const purchase = current.rows[0];
          if (!purchase) throw new Error("Purchase request not found");
          const allowed: Record<string, string[]> = { pending: ["approved", "rejected"], approved: ["ordered", "rejected"], ordered: ["received"] };
          const dbStatus = purchaseDbStatus[status];
          if (!(allowed[purchase.status] ?? []).includes(dbStatus)) throw new Error(`Cannot move a ${purchase.status} request to ${dbStatus}`);
          await client.query(
            `UPDATE purchase_requests SET status = $3::purchase_request_status, reviewed_by = $4,
               review_notes = $5, reviewed_at = COALESCE(reviewed_at, now()),
               ordered_at = CASE WHEN $3 = 'ordered' THEN now() ELSE ordered_at END,
               received_at = CASE WHEN $3 = 'received' THEN now() ELSE received_at END,
               updated_at = now() WHERE id = $1 AND org_id = $2`,
            [purchaseId, orgId, dbStatus, session.user.id, text(body.reviewNote, 1_000)],
          );
          if (dbStatus === "approved") {
            await client.query(
              `INSERT INTO finance_transactions(
                 org_id, season_year, type, source, amount_usd, category_id, purchase_request_id, description, created_by
               ) SELECT $1,$2,'expense','purchase_request',$3,$4,$5,$6,$7
               WHERE NOT EXISTS (
                 SELECT 1 FROM finance_transactions WHERE org_id = $1 AND purchase_request_id = $5 AND type = 'expense'
               )`,
              [orgId, purchase.seasonYear, purchase.totalCostUsd, purchase.categoryId, purchaseId, purchase.title, session.user.id],
            );
          }
          await audit(client, { orgId, userId: session.user.id, action, entityType: "purchase_request", entityId: purchaseId, metadata: { status } });
          break;
        }
        case "add-sponsor": {
          requireAdmin(member);
          const name = text(body.name, 200);
          if (!name) throw new Error("Sponsor name is required");
          const status = choice<SponsorStatus>(SPONSOR_STATUSES, body.status) ?? "prospect";
          const allowedTiers = ["in_kind", "bronze", "silver", "gold", "platinum", "custom"];
          const tier = allowedTiers.includes(String(body.tier)) ? String(body.tier) : "custom";
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO sponsors(
               org_id, name, status, tier, website, industry, relationship_owner, next_follow_up_on, notes, created_by
             ) VALUES ($1,$2,$3::sponsor_status,$4::sponsor_tier,$5,$6,$7,$8::date,$9,$10)
             ON CONFLICT (org_id, name) DO UPDATE SET
               status = EXCLUDED.status, tier = EXCLUDED.tier,
               website = COALESCE(EXCLUDED.website, sponsors.website),
               industry = COALESCE(EXCLUDED.industry, sponsors.industry),
               relationship_owner = COALESCE(EXCLUDED.relationship_owner, sponsors.relationship_owner),
               next_follow_up_on = COALESCE(EXCLUDED.next_follow_up_on, sponsors.next_follow_up_on),
               notes = COALESCE(EXCLUDED.notes, sponsors.notes), updated_at = now()
             RETURNING id`,
            [orgId, name, status, tier, webUrl(body.website), text(body.industry, 120), text(body.relationshipOwner, 160), date(body.nextFollowUpOn), text(body.notes, 4_000), session.user.id],
          );
          entityId = inserted.rows[0]?.id ?? null;
          const contactName = text(body.contactName, 160);
          const contactEmail = text(body.contactEmail, 240);
          if (entityId && (contactName || contactEmail)) {
            const primary = await client.query<{ id: string }>(
              `SELECT id FROM sponsor_contacts WHERE sponsor_id = $1 AND org_id = $2 AND is_primary LIMIT 1`,
              [entityId, orgId],
            );
            if (primary.rows[0]) {
              await client.query(
                `UPDATE sponsor_contacts SET name = COALESCE($3, name), email = COALESCE($4, email), updated_at = now()
                 WHERE id = $1 AND org_id = $2`,
                [primary.rows[0].id, orgId, contactName, contactEmail],
              );
            } else {
              await client.query(
                `INSERT INTO sponsor_contacts(sponsor_id, org_id, name, email, is_primary)
                 VALUES ($1,$2,$3,$4,true)`,
                [entityId, orgId, contactName ?? "Primary contact", contactEmail],
              );
            }
          }
          await audit(client, { orgId, userId: session.user.id, action, entityType: "sponsor", entityId });
          break;
        }
        case "update-sponsor": {
          requireAdmin(member);
          const sponsorId = text(body.sponsorId, 64);
          const status = choice<SponsorStatus>(SPONSOR_STATUSES, body.status);
          if (!sponsorId || !status) throw new Error("Sponsor and status are required");
          const updated = await client.query(
            `UPDATE sponsors SET status = $3::sponsor_status,
               next_follow_up_on = COALESCE($4::date, next_follow_up_on), updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [sponsorId, orgId, status, date(body.nextFollowUpOn)],
          );
          if (!updated.rowCount) throw new Error("Sponsor not found");
          await audit(client, { orgId, userId: session.user.id, action, entityType: "sponsor", entityId: sponsorId, metadata: { status } });
          break;
        }
        case "add-contribution": {
          requireAdmin(member);
          const sponsorId = text(body.sponsorId, 64);
          const receivedOn = date(body.receivedOn);
          if (!sponsorId || !receivedOn) throw new Error("Sponsor and received date are required");
          const contributionType = body.contributionType === "in_kind" ? "in_kind" : "cash";
          const amountUsd = dollars(body.amountCents);
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO sponsor_contributions(
               org_id, sponsor_id, season_year, type, amount_usd, estimated_value_usd,
               received_at, description, created_by
             ) SELECT $1,id,$3,$4::sponsor_contribution_type,
                      CASE WHEN $4 = 'cash' THEN $5 ELSE NULL END,
                      CASE WHEN $4 <> 'cash' THEN $5 ELSE NULL END,
                      $6::date,$7,$8 FROM sponsors WHERE id = $2 AND org_id = $1 RETURNING id`,
            [orgId, sponsorId, seasonYear, contributionType, amountUsd, receivedOn, text(body.description, 1_000), session.user.id],
          );
          if (!inserted.rows[0]) throw new Error("Sponsor not found");
          entityId = inserted.rows[0].id;
          if (contributionType === "cash") {
            await client.query(
              `INSERT INTO finance_transactions(
                 org_id, season_year, type, source, amount_usd, occurred_at, sponsor_contribution_id, description, created_by
               ) SELECT $1,$2,'income','sponsor_contribution',$3,$4::date,$5,$6,$7
               WHERE NOT EXISTS (
                 SELECT 1 FROM finance_transactions WHERE org_id = $1 AND sponsor_contribution_id = $5 AND type = 'income'
               )`,
              [orgId, seasonYear, amountUsd, receivedOn, entityId, text(body.description, 1_000) ?? "Sponsor contribution", session.user.id],
            );
          }
          await client.query(
            `UPDATE sponsors SET status = 'active', updated_at = now()
             WHERE id = $1 AND org_id = $2 AND status = 'prospect'`,
            [sponsorId, orgId],
          );
          await audit(client, { orgId, userId: session.user.id, action, entityType: "sponsor_contribution", entityId });
          break;
        }
        case "log-interaction": {
          const sponsorId = text(body.sponsorId, 64);
          const summary = text(body.summary, 2_000);
          const occurredOn = date(body.occurredOn);
          if (!sponsorId || !summary || !occurredOn) throw new Error("Sponsor, date, and interaction summary are required");
          const requestedType = choice(["email", "call", "meeting", "visit", "thank_you", "note"] as const, body.interactionType) ?? "note";
          // Prefer native `visit` when the enum supports it (pipeline CRM); map note → other.
          const interactionType = requestedType === "note" ? "other" : requestedType;
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO sponsor_interactions(
               org_id, sponsor_id, type, notes, occurred_at, next_step, next_follow_up_on, logged_by
             ) SELECT $1,id,$3::sponsor_interaction_type,$4,$5::date,$6,$7::date,$8
               FROM sponsors WHERE id = $2 AND org_id = $1 RETURNING id`,
            [orgId, sponsorId, interactionType, summary, occurredOn, text(body.nextStep, 1_000), date(body.nextFollowUpOn), session.user.id],
          );
          if (!inserted.rows[0]) throw new Error("Sponsor not found");
          entityId = inserted.rows[0].id;
          await audit(client, { orgId, userId: session.user.id, action, entityType: "sponsor_interaction", entityId });
          break;
        }
        case "mark-thank-you-sent": {
          requireAdmin(member);
          const sponsorId = text(body.sponsorId, 64);
          if (!sponsorId) throw new Error("Sponsor is required");
          const updated = await client.query(
            `UPDATE sponsor_contributions SET thank_you_sent_at = COALESCE(thank_you_sent_at, now())
             WHERE org_id = $1 AND sponsor_id = $2 AND thank_you_sent_at IS NULL`,
            [orgId, sponsorId],
          );
          await client.query(
            `UPDATE sponsors SET thank_you_due_on = NULL, updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [sponsorId, orgId],
          );
          if (!updated.rowCount) {
            // Still clear the due date so the reminder queue advances.
          }
          entityId = sponsorId;
          await audit(client, { orgId, userId: session.user.id, action, entityType: "sponsor", entityId: sponsorId });
          break;
        }
        case "save-prospect": {
          requireAdmin(member);
          const prospectId = text(body.prospectId, 64);
          if (!prospectId) throw new Error("Prospect is required");
          const saved = await client.query<{ id: string }>(
            `WITH prospect AS (
               UPDATE sponsor_prospects SET status = 'contacted'
               WHERE id = $1 AND org_id = $2 RETURNING *
             ) INSERT INTO sponsors(org_id, name, status, website, notes, created_by)
               SELECT org_id, company_name, 'prospect', website,
                      COALESCE(rationale, '') || E'\nSource: ' || COALESCE(website, 'not recorded'), $3 FROM prospect
             ON CONFLICT (org_id, name) DO UPDATE SET
               website = COALESCE(sponsors.website, EXCLUDED.website), updated_at = now()
             RETURNING id`,
            [prospectId, orgId, session.user.id],
          );
          if (!saved.rows[0]) throw new Error("Prospect not found");
          entityId = saved.rows[0].id;
          await audit(client, { orgId, userId: session.user.id, action, entityType: "sponsor", entityId, metadata: { prospectId } });
          break;
        }
        case "dismiss-prospect": {
          const prospectId = text(body.prospectId, 64);
          if (!prospectId) throw new Error("Prospect is required");
          await client.query(`UPDATE sponsor_prospects SET status = 'dismissed' WHERE id = $1 AND org_id = $2`, [prospectId, orgId]);
          await audit(client, { orgId, userId: session.user.id, action, entityType: "sponsor_prospect", entityId: prospectId });
          break;
        }
        case "add-grant": {
          const funder = text(body.funder, 200);
          const title = text(body.title, 240);
          const purpose = text(body.purpose, 4_000);
          if (!funder || !title || !purpose) throw new Error("Funder, grant title, and purpose are required");
          const grantStatus = choice<GrantStatus>(GRANT_STATUSES, body.status) ?? "researching";
          if (grantStatus === "awarded" && !member.admin) requireAdmin(member);
          const opportunity = await client.query<{ id: string }>(
            `INSERT INTO grant_opportunities(
               org_id, name, funder, description, deadline, eligibility_notes, application_url, created_by
             ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8) RETURNING id`,
            [orgId, title, funder, purpose, date(body.deadline), text(body.eligibility, 4_000), webUrl(body.sourceUrl), session.user.id],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO grant_applications(
               org_id, grant_opportunity_id, season_year, status, amount_requested_usd,
               summary, owner_name, owner_user_id
             ) VALUES ($1,$2,$3,$4::grant_status,$5,$6,$7,$8) RETURNING id`,
            [orgId, opportunity.rows[0]!.id, seasonYear, grantDbStatus[grantStatus], dollars(body.requestedCents), purpose, text(body.ownerName, 160), session.user.id],
          );
          entityId = inserted.rows[0]?.id ?? null;
          const requirements = text(body.requirements, 6_000);
          if (entityId && requirements) {
            await client.query(
              `INSERT INTO grant_application_items(application_id, org_id, kind, prompt, sort_order)
               VALUES ($1,$2,'question',$3,0)`,
              [entityId, orgId, requirements],
            );
          }
          await audit(client, { orgId, userId: session.user.id, action, entityType: "grant_application", entityId });
          break;
        }
        case "set-grant-status": {
          const grantId = text(body.grantId, 64);
          const status = choice<GrantStatus>(GRANT_STATUSES, body.status);
          if (!grantId || !status) throw new Error("Grant and status are required");
          const awardedCents = cents(body.awardedCents);
          if ((status === "awarded" || awardedCents > 0) && !member.admin) requireAdmin(member);
          const dbStatus = grantDbStatus[status];
          const updated = await client.query(
            `UPDATE grant_applications SET status = $3::grant_status,
               amount_awarded_usd = CASE WHEN $3 = 'awarded' THEN $4 ELSE amount_awarded_usd END,
               submitted_at = CASE WHEN $3 = 'submitted' THEN COALESCE(submitted_at, now()) ELSE submitted_at END,
               decision_at = CASE WHEN $3 IN ('awarded','declined') THEN now() ELSE decision_at END,
               updated_at = now() WHERE id = $1 AND org_id = $2`,
            [grantId, orgId, dbStatus, Math.round((awardedCents / 100) * 100) / 100],
          );
          if (!updated.rowCount) throw new Error("Grant not found");
          await audit(client, { orgId, userId: session.user.id, action, entityType: "grant_application", entityId: grantId, metadata: { status } });
          break;
        }
        case "add-award": {
          const awardName = text(body.awardName, 240);
          if (!awardName) throw new Error("Award name is required");
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO award_submissions(
               org_id, season_year, award_type, title, status, owner_user_id,
               summary, event_name, award_level, source_url
             ) VALUES ($1,$2,$3,$3,'won',$4,$5,$6,$7,$8) RETURNING id`,
            [orgId, seasonYear, awardName, session.user.id, text(body.story, 6_000), text(body.eventName, 240), text(body.awardLevel, 120), webUrl(body.sourceUrl)],
          );
          entityId = inserted.rows[0]?.id ?? null;
          await audit(client, { orgId, userId: session.user.id, action, entityType: "award_submission", entityId });
          break;
        }
        case "generate-draft": {
          const documentType = choice<DraftType>(DRAFT_TYPES, body.documentType) ?? "sponsor_email";
          const audience = text(body.audience, 240) ?? "Community partner";
          const goal = text(body.goal, 2_000) ?? "support our robotics season";
          const sponsorName = text(body.sponsorName, 240);
          const loaded = await loadBusinessView(client, { userId: session.user.id, requestedOrg: orgId, seasonYear });
          if (loaded.status !== "live") throw new Error("Team workspace is not ready");
          const generated = generateEvidenceDraft({
            type: documentType,
            teamName: loaded.orgName,
            teamNumber: loaded.teamNumber,
            audience,
            goal,
            sponsorName,
            seasonYear,
            impact: loaded.impact,
            awards: loaded.awards,
            sponsorIncomeCents: loaded.budget.sponsorIncomeCents,
          });
          const sponsor = sponsorName
            ? await client.query<{ id: string }>(`SELECT id FROM sponsors WHERE org_id = $1 AND name = $2 LIMIT 1`, [orgId, sponsorName])
            : null;
          const kind: Record<DraftType, string> = {
            sponsor_email: "new_prospect_intro",
            grant_narrative: "custom",
            thank_you: "thank_you",
            renewal: "renewal_ask",
          };
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO outreach_messages(
               org_id, sponsor_id, kind, subject, body, generated_by, created_by,
               document_type, audience, goal, evidence
             ) VALUES ($1,$2,$3::outreach_kind,$4,$5,'business_portal',$6,$7,$8,$9,$10::jsonb) RETURNING id`,
            [orgId, sponsor?.rows[0]?.id ?? null, kind[documentType], generated.title, generated.body, session.user.id, documentType, audience, goal, JSON.stringify(generated.evidence)],
          );
          entityId = inserted.rows[0]?.id ?? null;
          await audit(client, { orgId, userId: session.user.id, action, entityType: "outreach_message", entityId, metadata: { documentType } });
          break;
        }
        default:
          throw new Error("Unknown business portal action");
      }

      return loadBusinessView(client, { userId: session.user.id, requestedOrg: orgId, seasonYear });
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Business portal request failed";
    const status = /access denied|owner or admin/i.test(message) ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}

export type { BusinessView };
