import { assertOrgCapability, auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "AI approval request failed" },
    { status: 400 },
  );

export async function GET(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const status = url.searchParams.get("status") ?? "pending";
    if (!orgId) throw new Error("orgId is required");

    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, current.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");

      const approvals = await client.query(
        `SELECT a.id, a.run_id AS "runId", a.request_id AS "requestId",
                a.feature, a.provider, a.model,
                a.estimated_cost_usd AS "estimatedCostUsd", a.tools, a.status, a.reason,
                a.resolution_note AS "resolutionNote",
                a.created_at AS "createdAt", a.resolved_at AS "resolvedAt",
                u.name AS "requesterName", u.email AS "requesterEmail",
                r.name AS "resolverName"
         FROM ai_run_approvals a
         LEFT JOIN users u ON u.id = a.requester_user_id
         LEFT JOIN users r ON r.id = a.resolved_by
         WHERE a.org_id = $1
           AND ($2 = 'all' OR a.status = $2)
         ORDER BY a.created_at DESC
         LIMIT 100`,
        [orgId, status],
      );

      const counts = await client.query<{ status: string; count: string }>(
        `SELECT status, count(*)::text AS count
         FROM ai_run_approvals
         WHERE org_id=$1 AND created_at >= now() - interval '30 days'
         GROUP BY status`,
        [orgId],
      );

      return { approvals: approvals.rows, statusCounts: counts.rows };
    });

    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as Record<string, unknown>;
    const orgId = String(body.orgId ?? "");
    const approvalId = String(body.approvalId ?? "");
    const decision = String(body.decision ?? "");
    const resolutionNote =
      typeof body.resolutionNote === "string" ? body.resolutionNote.trim().slice(0, 500) : null;

    if (!orgId || !approvalId) throw new Error("orgId and approvalId are required");
    if (decision !== "approve" && decision !== "deny") {
      throw new Error("decision must be approve or deny");
    }

    await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertOrgCapability(client, orgId, "manage_api_keys");

      const nextStatus = decision === "approve" ? "approved" : "denied";
      const updated = await client.query(
        `UPDATE ai_run_approvals
         SET status=$1, resolution_note=$2, resolved_by=$3, resolved_at=now()
         WHERE id=$4 AND org_id=$5 AND status='pending'
         RETURNING id, run_id, requester_user_id, feature, estimated_cost_usd, reason`,
        [nextStatus, resolutionNote, current.user.id, approvalId, orgId],
      );
      if (!updated.rowCount) throw new Error("Pending approval not found");

      const row = updated.rows[0] as {
        run_id: string | null;
        requester_user_id: string;
        feature: string;
        estimated_cost_usd: string;
        reason: string | null;
      };

      if (row.run_id && decision === "deny") {
        await client.query(
          `UPDATE ai_runs SET status='failed', error=$2, completed_at=now()
           WHERE id=$1 AND org_id=$3 AND status='awaiting_approval'`,
          [row.run_id, resolutionNote || "AI run approval denied", orgId],
        );
      }

      await client.query(
        `INSERT INTO notifications(user_id, org_id, type, payload)
         VALUES ($1,$2,$3,$4::jsonb)`,
        [
          row.requester_user_id,
          orgId,
          decision === "approve" ? "ai_approval.approved" : "ai_approval.denied",
          JSON.stringify({
            approvalId,
            feature: row.feature,
            estimatedCostUsd: Number(row.estimated_cost_usd),
            reason: row.reason,
            resolutionNote,
            delivery: ["in_app"],
          }),
        ],
      );

      await client.query(
        `INSERT INTO org_ai_policy_audit(org_id, actor_user_id, action, before, after)
         VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
        [
          orgId,
          current.user.id,
          `ai_approval.${decision}`,
          JSON.stringify({ approvalId, status: "pending" }),
          JSON.stringify({ approvalId, status: nextStatus, resolutionNote }),
        ],
      );
    });

    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
