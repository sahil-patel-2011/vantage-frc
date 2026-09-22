import {
  AI_WRITE_TOOLS,
  AiActionProposalError,
  decideAiActionProposal,
  isAiWriteTool,
  listAiActionProposals,
  type AiActionProposalRow,
} from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

/**
 * AI write actions waiting for a person (migration 0673).
 *
 * GET  ?orgId=&status=pending|all — the caller's own proposals; owners/admins see the team's.
 * POST { orgId, proposalId, decision: "confirm" | "discard" }
 *
 * Confirm runs the write on the CONFIRMING user's own RLS session — the same permissions that
 * person has on the page — never elevated. Only the person who asked or an owner/admin may
 * decide; both outcomes land in ai_action_proposal_events.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || /relation "ai_action_proposal/i.test(error instanceof Error ? error.message : "");
}

function fail(error: unknown) {
  if (error instanceof AiActionProposalError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (isMissingTable(error)) {
    return Response.json(
      { error: "AI proposals need a database update (migration 0673).", status: "setup_required" },
      { status: 503 },
    );
  }
  const message = error instanceof Error ? error.message : "Request failed";
  if (/access denied|not a member/i.test(message)) {
    return Response.json({ error: "You are not a member of this team." }, { status: 403 });
  }
  return Response.json({ error: "Could not update the AI proposal." }, { status: 400 });
}

async function requireMember(client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ role: string }> }> }, orgId: string, userId: string) {
  const member = await client.query(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [orgId, userId],
  );
  const role = member.rows[0]?.role;
  if (!role) throw new Error("Organization access denied");
  return role;
}

function present(row: AiActionProposalRow, viewerId: string, viewerIsAdmin: boolean, orgId: string) {
  const tool = isAiWriteTool(row.toolName) ? AI_WRITE_TOOLS[row.toolName] : null;
  return {
    id: row.id,
    toolName: row.toolName,
    kind: tool?.label ?? row.toolName,
    summary: row.summary,
    status: row.status,
    proposedBy: row.proposedBy,
    proposedByName: row.proposedBy === viewerId ? "You" : row.proposedByName ?? "A teammate",
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    error: row.error,
    canDecide: row.status === "pending" && (row.proposedBy === viewerId || viewerIsAdmin),
    href: tool ? tool.href(orgId) : null,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in to see AI proposals." }, { status: 401 });
  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  if (!orgId || !UUID_RE.test(orgId)) return Response.json({ error: "orgId is required" }, { status: 400 });
  const status = url.searchParams.get("status") === "all" ? "all" : "pending";
  try {
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const role = await requireMember(client as never, orgId, session.user.id);
      const isAdmin = role === "owner" || role === "admin";
      const rows = await listAiActionProposals(client, { orgId, status });
      return { proposals: rows.map((row) => present(row, session.user.id, isAdmin, orgId)) };
    });
    return Response.json(data, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Sign in to decide AI proposals." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    orgId?: string;
    proposalId?: string;
    decision?: string;
  };
  const orgId = String(body.orgId ?? "");
  const proposalId = String(body.proposalId ?? "");
  if (!UUID_RE.test(orgId) || !UUID_RE.test(proposalId)) {
    return Response.json({ error: "orgId and proposalId are required" }, { status: 400 });
  }
  if (body.decision !== "confirm" && body.decision !== "discard") {
    return Response.json({ error: "decision must be confirm or discard" }, { status: 400 });
  }
  const decision = body.decision;
  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMember(client as never, orgId, session.user.id);
      return decideAiActionProposal(client, { orgId, userId: session.user.id, proposalId, decision });
    });
    return Response.json(result, { status: result.status === "failed" ? 422 : 200 });
  } catch (error) {
    return fail(error);
  }
}
