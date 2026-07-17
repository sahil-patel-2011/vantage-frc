import { AgentRepository } from "@vantage/agent/repository";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Memory request failed" }, { status: 400 });

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as {
      action?: "save" | "toggle-private" | "toggle-team" | "promote" | "private-budget" | "team-budget";
      orgId?: string;
      id?: string;
      kind?: string;
      content?: string;
      enabled?: boolean;
      messageId?: string;
      retentionDays?: number;
      tokenBudget?: number;
    };
    const result = await withRls({ userId: current.user.id, orgId: body.orgId }, async (client) => {
      const repository = new AgentRepository(client);
      if (body.action === "save") {
        if (!body.kind || !body.content) throw new Error("Memory kind and content are required");
        return { id: await repository.saveUserMemory(current.user.id, { id: body.id, kind: body.kind, content: body.content }) };
      }
      if (body.action === "toggle-private" || body.action === "private-budget") {
        await repository.setUserMemoryEnabled(
          current.user.id,
          body.enabled ?? true,
          body.tokenBudget,
        );
        return { success: true };
      }
      if (body.action === "toggle-team" || body.action === "team-budget") {
        if (!body.orgId) throw new Error("orgId is required");
        await repository.setTeamMemory(body.orgId, current.user.id, {
          enabled: Boolean(body.enabled),
          retentionDays: body.retentionDays,
          tokenBudget: body.tokenBudget,
        });
        return { success: true };
      }
      if (body.action === "promote") {
        if (!body.orgId || !body.messageId) throw new Error("Organization and message are required");
        return { id: await repository.promoteMessage(body.orgId, current.user.id, body.messageId) };
      }
      throw new Error("Unknown memory action");
    });
    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const current = await session();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });
    await withRls({ userId: current.user.id }, (client) =>
      new AgentRepository(client).deleteUserMemory(current.user.id, id),
    );
    return Response.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
