import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { syncSponsorContributionMoney } from "../../../../lib/finance/source-mirrors";
import { orgScopedPackageId } from "../../../../lib/partner-placements";

type Body = Record<string, unknown>;
const surfaces = ["business_wall", "dashboard_footer", "pit_footer"] as const;
const campaignStatuses = ["draft", "approved", "active", "complete", "cancelled"] as const;

function text(value: unknown, max = 2_000) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null; }
function money(value: unknown) { const amount = Number(value); return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0; }
function day(value: unknown, fallback: string) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback; }
function list(value: unknown) { const rows = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && (surfaces as readonly string[]).includes(item)) : []; return [...new Set(rows)]; }
function url(value: unknown) { const candidate = text(value); if (!candidate) return null; try { const parsed = new URL(candidate); return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null; } catch { return null; } }
async function admin(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ role: string }>("SELECT role::text AS role FROM memberships WHERE org_id = $1 AND user_id = $2", [orgId, userId]);
  if (!row.rows[0] || !["owner", "admin"].includes(row.rows[0].role)) throw new Error("A team owner or admin must manage partner placements");
}
async function audit(client: PoolClient, orgId: string, userId: string, action: string, entity: string, entityId?: string, metadata: Body = {}) {
  await client.query(`INSERT INTO team_business_audit_events(org_id, actor_user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [orgId, userId, action, entity, entityId ?? null, JSON.stringify(metadata)]);
}

async function load(client: PoolClient, orgId: string) {
  const [settings, packages, sponsors, campaigns, assets, submissions] = await Promise.all([
    client.query(`SELECT public_id AS "publicId", storefront_enabled AS "storefrontEnabled", payment_url AS "paymentUrl", pitch FROM partner_program_settings WHERE org_id = $1`, [orgId]),
    client.query(`SELECT id, name, price_usd::text AS "priceUsd", duration_days AS "durationDays", surfaces, benefits, active, sort_order AS "sortOrder" FROM partner_placement_packages WHERE org_id = $1 ORDER BY sort_order, price_usd`, [orgId]),
    client.query(`SELECT id, name, status::text AS status FROM sponsors WHERE org_id = $1 ORDER BY name`, [orgId]),
    client.query(`SELECT c.id, c.sponsor_id AS "sponsorId", s.name AS "sponsorName", c.package_id AS "packageId", p.name AS "packageName", c.asset_id AS "assetId", a.public_id AS "assetPublicId", c.season_year AS "seasonYear", c.name, c.headline, c.link_url AS "linkUrl", c.surfaces, c.start_on::text AS "startOn", c.end_on::text AS "endOn", c.amount_usd::text AS "amountUsd", c.payment_status AS "paymentStatus", c.status FROM partner_placement_campaigns c JOIN sponsors s ON s.id = c.sponsor_id LEFT JOIN partner_placement_packages p ON p.id = c.package_id LEFT JOIN sponsor_assets a ON a.id = c.asset_id WHERE c.org_id = $1 ORDER BY c.created_at DESC`, [orgId]),
    client.query(`SELECT id, sponsor_id AS "sponsorId", public_id AS "publicId", name AS filename, width, height, status, created_at::text AS "createdAt" FROM sponsor_assets WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]),
    client.query(`SELECT sub.id, sub.package_id AS "packageId", p.name AS "packageName", sub.company_name AS "companyName", sub.contact_name AS "contactName", sub.contact_email AS "contactEmail", sub.website, sub.message, sub.external_logo_url AS "logoUrl", sub.status, sub.created_at::text AS "createdAt" FROM partner_storefront_submissions sub LEFT JOIN partner_placement_packages p ON p.id = sub.package_id WHERE sub.org_id = $1 ORDER BY sub.created_at DESC LIMIT 100`, [orgId]),
  ]);
  return { settings: settings.rows[0] ?? null, packages: packages.rows, sponsors: sponsors.rows, campaigns: campaigns.rows, assets: assets.rows, submissions: submissions.rows };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  try { return Response.json(await withRls({ userId: session.user.id, orgId }, (client) => load(client, orgId))); }
  catch (error) { return Response.json({ error: error instanceof Error && /partner_/.test(error.message) ? "Apply the Partner Placements migration first." : "Could not load partner placements." }, { status: 400 }); }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: Body; try { body = await request.json() as Body; } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const orgId = text(body.orgId, 64); const action = text(body.action, 80);
  if (!orgId || !action) return Response.json({ error: "orgId and action are required" }, { status: 400 });
  try {
    const program = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await admin(client, orgId, session.user.id);
      if (action === "save-settings") {
        const paymentUrl = body.paymentUrl ? url(body.paymentUrl) : null;
        if (body.paymentUrl && !paymentUrl) throw new Error("Use a valid https or http payment link");
        await client.query(`INSERT INTO partner_program_settings(org_id, storefront_enabled, payment_url, pitch, updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (org_id) DO UPDATE SET storefront_enabled = EXCLUDED.storefront_enabled, payment_url = EXCLUDED.payment_url, pitch = EXCLUDED.pitch, updated_by = EXCLUDED.updated_by, updated_at = now()`, [orgId, body.storefrontEnabled === true || body.storefrontEnabled === "on", paymentUrl, text(body.pitch, 2000) ?? "Support student-led robotics and help our team build, compete, and serve the community.", session.user.id]);
        await audit(client, orgId, session.user.id, action, "partner_program");
      } else if (action === "rotate-storefront") {
        const rotated = await client.query(`UPDATE partner_program_settings SET public_id=gen_random_uuid(),updated_by=$2,updated_at=now() WHERE org_id=$1 RETURNING public_id`, [orgId, session.user.id]);
        if (!rotated.rows[0]) throw new Error("Save storefront settings before rotating its link");
        await audit(client, orgId, session.user.id, action, "partner_program");
      } else if (action === "save-package") {
        const name = text(body.name, 120); const packageId = text(body.packageId, 64); const packageSurfaces = list(body.surfaces);
        if (!name || !packageSurfaces.length) throw new Error("Package name and at least one placement surface are required");
        if (packageId) await client.query(`UPDATE partner_placement_packages SET name=$3, price_usd=$4, duration_days=$5, surfaces=$6, benefits=$7, active=$8, sort_order=$9, updated_at=now() WHERE id=$1 AND org_id=$2`, [packageId, orgId, name, money(body.priceUsd), Math.min(730, Math.max(1, Number(body.durationDays) || 365)), packageSurfaces, text(body.benefits, 2000), body.active !== false, Number(body.sortOrder) || 0]);
        else await client.query(`INSERT INTO partner_placement_packages(org_id,name,price_usd,duration_days,surfaces,benefits,active,sort_order,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [orgId, name, money(body.priceUsd), Math.min(730, Math.max(1, Number(body.durationDays) || 365)), packageSurfaces, text(body.benefits, 2000), body.active !== false, Number(body.sortOrder) || 0, session.user.id]);
        await audit(client, orgId, session.user.id, action, "partner_package", packageId ?? undefined);
      } else if (action === "create-campaign") {
        const sponsorId = text(body.sponsorId, 64); const name = text(body.name, 160); const campaignSurfaces = list(body.surfaces); const startOn = day(body.startOn, new Date().toISOString().slice(0, 10)); const endOn = day(body.endOn, startOn);
        if (!sponsorId || !name || !campaignSurfaces.length || endOn < startOn) throw new Error("Sponsor, campaign name, valid dates, and at least one surface are required");
        const sponsor = await client.query("SELECT id FROM sponsors WHERE id = $1 AND org_id = $2", [sponsorId, orgId]); if (!sponsor.rows[0]) throw new Error("Sponsor not found");
        const packageIdRaw = text(body.packageId, 64);
        let packageId: string | null = null;
        if (packageIdRaw) {
          const pkg = await client.query<{ id: string }>(
            "SELECT id FROM partner_placement_packages WHERE id = $1 AND org_id = $2",
            [packageIdRaw, orgId],
          );
          packageId = orgScopedPackageId(packageIdRaw, pkg.rows.map((row) => row.id));
        }
        await client.query(`INSERT INTO partner_placement_campaigns(org_id,sponsor_id,package_id,season_year,name,headline,link_url,surfaces,start_on,end_on,amount_usd,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [orgId, sponsorId, packageId, Number(body.seasonYear) || new Date().getUTCFullYear(), name, text(body.headline, 200), url(body.linkUrl), campaignSurfaces, startOn, endOn, money(body.amountUsd), session.user.id]);
        await audit(client, orgId, session.user.id, action, "partner_campaign");
      } else if (action === "campaign-status") {
        const campaignId = text(body.campaignId, 64); const status = text(body.status, 40); if (!campaignId || !status || !(campaignStatuses as readonly string[]).includes(status)) throw new Error("Valid campaign and status required");
        if (["approved", "active"].includes(status)) {
          const eligible = await client.query<{ paymentStatus: string }>(
            `SELECT payment_status AS "paymentStatus" FROM partner_placement_campaigns WHERE id=$1 AND org_id=$2`,
            [campaignId, orgId],
          );
          if (!eligible.rows[0] || !["paid", "waived"].includes(eligible.rows[0].paymentStatus)) throw new Error("Record or waive payment before approving a placement");
        }
        await client.query("UPDATE partner_placement_campaigns SET status = $3, updated_at = now() WHERE id = $1 AND org_id = $2", [campaignId, orgId, status]);
        await audit(client, orgId, session.user.id, action, "partner_campaign", campaignId, { status });
      } else if (action === "attach-asset") {
        const campaignId = text(body.campaignId, 64); const assetId = text(body.assetId, 64); if (!campaignId || !assetId) throw new Error("Campaign and approved artwork are required");
        const result = await client.query(`UPDATE partner_placement_campaigns c SET asset_id=$3, updated_at=now() FROM sponsor_assets a WHERE c.id=$1 AND c.org_id=$2 AND a.id=$3 AND a.org_id=c.org_id AND a.sponsor_id=c.sponsor_id AND a.status='approved' RETURNING c.id`, [campaignId, orgId, assetId]);
        if (!result.rows[0]) throw new Error("Artwork must be approved and belong to the campaign sponsor");
        await audit(client, orgId, session.user.id, action, "partner_campaign", campaignId, { assetId });
      } else if (action === "asset-status") {
        const assetId = text(body.assetId, 64); const status = text(body.status, 20); if (!assetId || !["approved", "archived"].includes(status ?? "")) throw new Error("Choose approved or archived");
        if (status === "archived") { const used = await client.query(`SELECT 1 FROM partner_placement_campaigns WHERE org_id=$1 AND asset_id=$2 AND status IN ('approved','active') AND end_on >= CURRENT_DATE LIMIT 1`, [orgId, assetId]); if (used.rows[0]) throw new Error("End or cancel scheduled campaigns before archiving their artwork"); }
        await client.query("UPDATE sponsor_assets SET status=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 AND org_id=$2", [assetId, orgId, status, session.user.id]);
        await audit(client, orgId, session.user.id, action, "sponsor_asset", assetId, { status });
      } else if (action === "delete-asset") {
        const assetId = text(body.assetId, 64); if (!assetId) throw new Error("Artwork required");
        const removed = await client.query(`DELETE FROM sponsor_assets a WHERE a.id=$1 AND a.org_id=$2 AND a.status='archived' AND NOT EXISTS (SELECT 1 FROM partner_placement_campaigns c WHERE c.asset_id=a.id) RETURNING a.id`, [assetId, orgId]);
        if (!removed.rows[0]) throw new Error("Only archived artwork with no campaign history can be deleted");
        await audit(client, orgId, session.user.id, action, "sponsor_asset", assetId);
      } else if (action === "review-submission") {
        const submissionId = text(body.submissionId, 64); const decision = text(body.decision, 20); if (!submissionId || !["approved", "rejected"].includes(decision ?? "")) throw new Error("A submission and decision are required");
        const submission = await client.query<{ packageId: string | null; companyName: string; contactName: string; contactEmail: string }>(`SELECT package_id AS "packageId", company_name AS "companyName", contact_name AS "contactName", contact_email AS "contactEmail" FROM partner_storefront_submissions WHERE id=$1 AND org_id=$2 AND status='pending'`, [submissionId, orgId]);
        if (!submission.rows[0]) throw new Error("Pending submission not found");
        if (decision === "approved") { const sub = submission.rows[0]; const sponsor = await client.query<{ id: string }>(`INSERT INTO sponsors(org_id,name,status,tier,created_by) VALUES ($1,$2,'prospect','custom',$3) ON CONFLICT (org_id,name) DO UPDATE SET updated_at=now() RETURNING id`, [orgId, sub.companyName, session.user.id]); await client.query(`INSERT INTO sponsor_contacts(org_id,sponsor_id,name,email,is_primary) VALUES ($1,$2,$3,$4,true)`, [orgId, sponsor.rows[0]!.id, sub.contactName, sub.contactEmail]); const pkg = sub.packageId ? await client.query<{ price: string; days: number; surfaces: string[]; name: string }>(`SELECT price_usd::text AS price,duration_days AS days,surfaces,name FROM partner_placement_packages WHERE id=$1 AND org_id=$2`, [sub.packageId, orgId]) : null; const start = new Date().toISOString().slice(0,10); const end = new Date(Date.now() + ((pkg?.rows[0]?.days ?? 365) - 1) * 86400000).toISOString().slice(0,10); await client.query(`INSERT INTO partner_placement_campaigns(org_id,sponsor_id,package_id,source_submission_id,season_year,name,surfaces,start_on,end_on,amount_usd,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [orgId, sponsor.rows[0]!.id, sub.packageId, submissionId, new Date().getUTCFullYear(), `${sub.companyName} partner placement`, pkg?.rows[0]?.surfaces ?? ["business_wall"], start, end, pkg?.rows[0] ? money(pkg.rows[0].price) : 0, session.user.id]); }
        await client.query("UPDATE partner_storefront_submissions SET status=$3, reviewed_by=$4, reviewed_at=now() WHERE id=$1 AND org_id=$2", [submissionId, orgId, decision, session.user.id]);
        await audit(client, orgId, session.user.id, action, "partner_submission", submissionId, { decision });
      } else if (action === "waive-payment") {
        const campaignId = text(body.campaignId, 64); if (!campaignId) throw new Error("Campaign required");
        const waived = await client.query(`UPDATE partner_placement_campaigns SET payment_status='waived',updated_at=now() WHERE id=$1 AND org_id=$2 AND payment_status='pending' RETURNING id`, [campaignId, orgId]);
        if (!waived.rows[0]) throw new Error("Only a pending campaign payment can be waived");
        await audit(client, orgId, session.user.id, action, "partner_campaign", campaignId);
      } else if (action === "mark-paid") {
        const campaignId = text(body.campaignId, 64); if (!campaignId) throw new Error("Campaign required");
        const campaign = await client.query<{ sponsorId: string; seasonYear: number; name: string; amount: string; paymentStatus: string; contributionId: string | null }>(`SELECT sponsor_id AS "sponsorId",season_year AS "seasonYear",name,amount_usd::text AS amount,payment_status AS "paymentStatus",contribution_id AS "contributionId" FROM partner_placement_campaigns WHERE id=$1 AND org_id=$2`, [campaignId, orgId]); const row = campaign.rows[0]; if (!row) throw new Error("Campaign not found");
        if (row.paymentStatus !== "paid") {
          const contribution = await client.query<{ id: string }>(
            `INSERT INTO sponsor_contributions(sponsor_id,org_id,season_year,type,amount_usd,description,created_by)
             VALUES ($1,$2,$3,'cash',$4,$5,$6) RETURNING id`,
            [row.sponsorId, orgId, row.seasonYear, money(row.amount), `Partner placement: ${row.name}`, session.user.id],
          );
          await syncSponsorContributionMoney(client, {
            orgId,
            contributionId: contribution.rows[0]!.id,
            seasonYear: row.seasonYear,
            contributionType: "cash",
            amountUsd: money(row.amount),
            label: `Partner placement: ${row.name}`,
            userId: session.user.id,
          });
          await client.query(
            "UPDATE partner_placement_campaigns SET payment_status='paid',contribution_id=$3,updated_at=now() WHERE id=$1 AND org_id=$2",
            [campaignId, orgId, contribution.rows[0]!.id],
          );
        }
        await audit(client, orgId, session.user.id, action, "partner_campaign", campaignId);
      } else throw new Error("Unknown partner placement action");
      return load(client, orgId);
    });
    return Response.json(program);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Partner placement update failed" }, { status: 400 }); }
}
