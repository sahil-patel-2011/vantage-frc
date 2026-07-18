import {
  assertPlatformAdmin,
  assertPlatformPrivilegeMfa,
  auth,
  platformAdminDeniedResponse,
  writeAdminAction,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import {
  isSupportTicketStatus,
  listAdminSupportTickets,
  triageSupportTicket,
  type SupportTicketStatus,
} from "../../../../lib/support-tickets";

async function runAdmin<T>(
  work: (ctx: { client: PoolClient; session: { user: { id: string } } }) => Promise<T>,
  requireMfa = false,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    await assertPlatformAdmin(client);
    if (requireMfa) {
      await assertPlatformPrivilegeMfa(client, {
        userId: session.user.id,
        sessionId: session.session.id,
      });
    }
    return work({ client, session });
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam && isSupportTicketStatus(statusParam) ? (statusParam as SupportTicketStatus) : null;
    const q = url.searchParams.get("q");
    const tickets = await runAdmin(({ client }) =>
      listAdminSupportTickets(client, { status, q }),
    );
    return Response.json({ tickets });
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      ticketId?: string;
      status?: string;
      adminResponse?: string | null;
    };
    const ticketId = body.ticketId?.trim();
    if (!ticketId) {
      return Response.json({ error: "ticketId is required" }, { status: 400 });
    }
    if (body.status !== undefined && !isSupportTicketStatus(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }

    const ticket = await runAdmin(async ({ client, session }) => {
      const updated = await triageSupportTicket(client, {
        ticketId,
        adminUserId: session.user.id,
        status: body.status as SupportTicketStatus | undefined,
        adminResponse: body.adminResponse,
      });
      if (!updated) throw new Error("Ticket not found");
      await writeAdminAction(client, {
        actorUserId: session.user.id,
        action: "support.ticket_triaged",
        targetOrgId: updated.orgId,
        targetUserId: updated.userId,
        payload: {
          ticketId,
          status: updated.status,
          teamNumber: updated.teamNumber,
        },
      });
      return updated;
    }, true);

    return Response.json({ ticket });
  } catch (error) {
    if (error instanceof Error && /ticket not found/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return platformAdminDeniedResponse(error);
  }
}
