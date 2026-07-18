import {
  auth,
  configuredPlatformOwnerEmail,
  createEmailProvider,
} from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  computeMemberTicketsView,
  submitSupportTicket,
  type SupportTicketMemberView,
} from "../../../lib/support-tickets";

function uuidOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function trimmed(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

async function notifyPlatformOwner(input: {
  ticketId: string;
  subject: string;
  body: string;
  orgName: string | null;
  teamNumber: number | null;
  submitterEmail: string | null;
}) {
  try {
    const to = configuredPlatformOwnerEmail();
    if (!to) return;
    const provider = createEmailProvider();
    if (provider.name === "unconfigured") return;
    const team =
      input.teamNumber != null
        ? `Team ${input.teamNumber}`
        : input.orgName ?? "an organization";
    const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
    await provider.sendFreeform({
      to,
      subject: `[Vantage support] ${input.subject}`,
      text: [
        `New support ticket from ${team}.`,
        input.submitterEmail ? `From: ${input.submitterEmail}` : null,
        `Subject: ${input.subject}`,
        "",
        input.body,
        "",
        `Triage: ${baseUrl}/admin/support`,
        `Ticket id: ${input.ticketId}`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  } catch {
    // Optional notify — never fail the ticket create path.
  }
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const requestedOrg = new URL(request.url).searchParams.get("orgId");

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMemberTicketsView(client, {
        userId: session.user.id,
        requestedOrg,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load support tickets. Confirm your workspace and try again.",
        orgId: null,
        orgName: null,
        teamNumber: null,
        tickets: [],
      } satisfies SupportTicketMemberView,
      { status: 200 },
    );
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const orgId = uuidOrNull(body.orgId);
  const subject = trimmed(body.subject, 200);
  const details = trimmed(body.body, 8000);
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  if (!subject || !details) {
    return Response.json({ error: "Subject and details are required" }, { status: 400 });
  }

  try {
    const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const ticket = await submitSupportTicket(client, {
        orgId,
        userId: session.user.id,
        subject,
        body: details,
      });
      const org = await client.query<{ name: string | null; teamNumber: number | null }>(
        `SELECT name, team_number AS "teamNumber" FROM organizations WHERE id = $1::uuid`,
        [orgId],
      );
      return {
        ticket,
        orgName: org.rows[0]?.name ?? null,
        teamNumber: org.rows[0]?.teamNumber ?? null,
      };
    });

    void notifyPlatformOwner({
      ticketId: result.ticket.id,
      subject: result.ticket.subject,
      body: result.ticket.body,
      orgName: result.orgName,
      teamNumber: result.teamNumber,
      submitterEmail: session.user.email ?? null,
    });

    const view = await withRls({ userId: session.user.id }, (client) =>
      computeMemberTicketsView(client, { userId: session.user.id, requestedOrg: orgId }),
    );
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit ticket";
    return Response.json({ error: message }, { status: 400 });
  }
}
