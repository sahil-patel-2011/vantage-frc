import { AgentRepository } from "@vantage/agent/repository";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// AI governance / data retention: admin control over the shared team memory the
// assistant injects into prompts. Enablement, per-turn token budget, and a
// retention window are all enforced downstream by AgentRepository.retrieveContext
// (disabled teams inject nothing; expired memories are filtered out). This route
// adds the read + admin-write surface the existing chat memory API never exposed.

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return value;
}

const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Team memory request failed";
  const status =
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : /auth|sign.?in|session/i.test(message)
        ? 401
        : /admin|administrator|forbidden|permission/i.test(message)
          ? 403
          : 400;
  return Response.json({ error: message }, { status });
};

async function assertAdmin(client: import("@neondatabase/serverless").PoolClient, orgId: string, userId: string) {
  const admin = await client.query(
    `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
    [orgId, userId],
  );
  if (!admin.rowCount) {
    throw Object.assign(new Error("Organization administrator access required"), { status: 403 });
  }
}

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);
      const repository = new AgentRepository(client);
      const settings = await repository.getMemorySettings(current.user.id, orgId);
      const counts = await client.query<{ active: string; expiringSoon: string; total: string }>(
        `SELECT
           count(*) FILTER (WHERE disabled_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS active,
           count(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at > now()
                             AND expires_at <= now() + interval '7 days') AS "expiringSoon",
           count(*) AS total
         FROM team_memories WHERE org_id=$1`,
        [orgId],
      );
      return { team: settings.team, counts: counts.rows[0] ?? { active: "0", expiringSoon: "0", total: "0" } };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as {
      orgId?: string;
      enabled?: boolean;
      retentionDays?: number;
      tokenBudget?: number;
    };
    if (!body.orgId) throw new Error("orgId is required");
    const orgId = body.orgId;
    await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);
      await new AgentRepository(client).setTeamMemory(orgId, current.user.id, {
        enabled: Boolean(body.enabled),
        retentionDays: body.retentionDays,
        tokenBudget: body.tokenBudget,
      });
    });
    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
