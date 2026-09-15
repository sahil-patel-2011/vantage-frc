import { listWorkingTodosResult } from "@vantage/agent";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseWorkingTodosQuery } from "../../../../lib/agent/working-todos-query";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not load working todos";
  let status = 400;
  if (/Authentication required|Unauthorized/i.test(message)) status = 401;
  else if (/access denied|membership required|forbidden/i.test(message)) status = 403;
  return Response.json({ error: message, todos: [] }, { status });
}

/** Thin list of durable working-memory todos for the live /ai checklist. */
export async function GET(request: Request) {
  try {
    const session = await current();
    const parsed = parseWorkingTodosQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return Response.json({ error: parsed.error, todos: [] }, { status: parsed.status });
    }
    const data = await withRls({ userId: session.user.id, orgId: parsed.orgId }, async (client) => {
      const membership = await client.query(
        "SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid",
        [parsed.orgId, session.user.id],
      );
      if (!membership.rowCount) throw new Error("Organization access denied");
      const listed = await listWorkingTodosResult(client, {
        orgId: parsed.orgId,
        userId: session.user.id,
        scope: parsed.scope,
        runId: parsed.runId,
      });
      return listed;
    });
    if (data.setupRequired) {
      return Response.json(
        { todos: [], setup_required: true, code: "setup_required" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json(
      { todos: data.todos, setup_required: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return fail(error);
  }
}
