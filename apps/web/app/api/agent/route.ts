import { LocalDeterministicChatAdapter } from "@vantage/agent";
import { AgentRepository } from "@vantage/agent/repository";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}
const fail = (error: unknown) =>
  Response.json({ error: error instanceof Error ? error.message : "Agent request failed" }, { status: 400 });

export async function GET(request: Request) {
  try {
    const session = await current();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId") ?? undefined;
    const threadId = url.searchParams.get("threadId");
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const repository = new AgentRepository(client);
      return {
        threads: await repository.listThreads(),
        memories: await repository.listUserMemories(session.user.id),
        messages: threadId ? await repository.getMessages(threadId) : [],
      };
    });
    return Response.json(data);
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      action?: "thread" | "message"; orgId?: string; threadId?: string;
      scope?: "private" | "team"; title?: string; message?: string;
    };
    if (!body.orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const data = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const repository = new AgentRepository(client);
      const membership = await client.query("SELECT 1 FROM memberships WHERE org_id=$1", [body.orgId]);
      if (!membership.rowCount) throw new Error("Organization access denied");
      if (body.action === "thread") {
        if (!body.scope || !body.title) throw new Error("Thread scope and title are required");
        return { threadId: await repository.createThread(session.user.id, { orgId: body.orgId, scope: body.scope, title: body.title }) };
      }
      if (!body.threadId || !body.message?.trim() || !body.scope) throw new Error("Thread, scope, and message are required");
      return repository.sendMessage({
        userId: session.user.id, orgId: body.orgId!, threadId: body.threadId,
        message: body.message, scope: body.scope, adapter: new LocalDeterministicChatAdapter(),
        requestId: crypto.randomUUID(),
      });
    });
    return Response.json(data, { status: 201 });
  } catch (error) { return fail(error); }
}
