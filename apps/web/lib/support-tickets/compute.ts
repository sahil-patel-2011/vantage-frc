import type { PoolClient } from "@neondatabase/serverless";
import type {
  SupportTicket,
  SupportTicketAdminRow,
  SupportTicketMemberView,
  SupportTicketStatus,
} from "./types";
import { isSupportTicketStatus } from "./types";

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; orgName: string | null; teamNumber: number | null } | null> {
  const membership = await client.query<{
    orgId: string;
    orgName: string | null;
    teamNumber: number | null;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

function mapTicket(row: {
  id: string;
  orgId: string;
  userId: string;
  subject: string;
  body: string;
  status: string;
  adminResponse: string | null;
  adminUserId: string | null;
  respondedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}): SupportTicket {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    subject: row.subject,
    body: row.body,
    status: isSupportTicketStatus(row.status) ? row.status : "open",
    adminResponse: row.adminResponse,
    adminUserId: row.adminUserId,
    respondedAt: row.respondedAt ? new Date(row.respondedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function computeMemberTicketsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<SupportTicketMemberView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a workspace before submitting a support ticket.",
      orgId: null,
      orgName: null,
      teamNumber: null,
      tickets: [],
    };
  }

  const rows = await client.query<{
    id: string;
    orgId: string;
    userId: string;
    subject: string;
    body: string;
    status: string;
    adminResponse: string | null;
    adminUserId: string | null;
    respondedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT
       id,
       org_id AS "orgId",
       user_id AS "userId",
       subject,
       body,
       status,
       admin_response AS "adminResponse",
       admin_user_id AS "adminUserId",
       responded_at AS "respondedAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM support_tickets
     WHERE user_id = $1::uuid
       AND org_id = $2::uuid
     ORDER BY created_at DESC
     LIMIT 100`,
    [input.userId, org.orgId],
  );

  return {
    status: "live",
    orgId: org.orgId,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    tickets: rows.rows.map(mapTicket),
  };
}

export async function submitSupportTicket(
  client: PoolClient,
  input: { orgId: string; userId: string; subject: string; body: string },
): Promise<SupportTicket> {
  const subject = input.subject.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 8000);
  if (!subject || !body) throw new Error("Subject and details are required");

  const inserted = await client.query<{
    id: string;
    orgId: string;
    userId: string;
    subject: string;
    body: string;
    status: string;
    adminResponse: string | null;
    adminUserId: string | null;
    respondedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `INSERT INTO support_tickets(org_id, user_id, subject, body)
     VALUES ($1::uuid, $2::uuid, $3, $4)
     RETURNING
       id,
       org_id AS "orgId",
       user_id AS "userId",
       subject,
       body,
       status,
       admin_response AS "adminResponse",
       admin_user_id AS "adminUserId",
       responded_at AS "respondedAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"`,
    [input.orgId, input.userId, subject, body],
  );
  const row = inserted.rows[0];
  if (!row) throw new Error("Could not create ticket");
  return mapTicket(row);
}

export async function listAdminSupportTickets(
  client: PoolClient,
  input: { status?: SupportTicketStatus | null; q?: string | null },
): Promise<SupportTicketAdminRow[]> {
  const status = input.status && isSupportTicketStatus(input.status) ? input.status : null;
  const q = input.q?.trim() ? `%${input.q.trim().toLowerCase()}%` : null;

  const rows = await client.query<{
    id: string;
    orgId: string;
    userId: string;
    subject: string;
    body: string;
    status: string;
    adminResponse: string | null;
    adminUserId: string | null;
    respondedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    orgName: string | null;
    teamNumber: number | null;
    submitterName: string | null;
    submitterEmail: string | null;
    adminName: string | null;
  }>(
    `SELECT
       t.id,
       t.org_id AS "orgId",
       t.user_id AS "userId",
       t.subject,
       t.body,
       t.status,
       t.admin_response AS "adminResponse",
       t.admin_user_id AS "adminUserId",
       t.responded_at AS "respondedAt",
       t.created_at AS "createdAt",
       t.updated_at AS "updatedAt",
       o.name AS "orgName",
       o.team_number AS "teamNumber",
       u.name AS "submitterName",
       u.email AS "submitterEmail",
       a.name AS "adminName"
     FROM support_tickets t
     JOIN organizations o ON o.id = t.org_id
     JOIN users u ON u.id = t.user_id
     LEFT JOIN users a ON a.id = t.admin_user_id
     WHERE ($1::text IS NULL OR t.status = $1)
       AND (
         $2::text IS NULL
         OR lower(t.subject) LIKE $2
         OR lower(t.body) LIKE $2
         OR lower(coalesce(u.email, '')) LIKE $2
         OR lower(coalesce(o.name, '')) LIKE $2
         OR cast(o.team_number as text) LIKE $2
       )
     ORDER BY
       CASE t.status
         WHEN 'open' THEN 0
         WHEN 'in_progress' THEN 1
         WHEN 'resolved' THEN 2
         ELSE 3
       END,
       t.created_at DESC
     LIMIT 200`,
    [status, q],
  );

  return rows.rows.map((row) => ({
    ...mapTicket(row),
    orgName: row.orgName,
    teamNumber: row.teamNumber,
    submitterName: row.submitterName,
    submitterEmail: row.submitterEmail,
    adminName: row.adminName,
  }));
}

export async function triageSupportTicket(
  client: PoolClient,
  input: {
    ticketId: string;
    adminUserId: string;
    status?: SupportTicketStatus;
    adminResponse?: string | null;
  },
): Promise<SupportTicketAdminRow | null> {
  const status = input.status && isSupportTicketStatus(input.status) ? input.status : null;
  const response =
    input.adminResponse === undefined
      ? undefined
      : input.adminResponse === null
        ? null
        : input.adminResponse.trim().slice(0, 8000) || null;

  if (!status && response === undefined) {
    throw new Error("status or adminResponse is required");
  }

  const updated = await client.query<{ id: string }>(
    `UPDATE support_tickets
     SET
       status = COALESCE($2::text, status),
       admin_response = CASE WHEN $3::boolean THEN $4 ELSE admin_response END,
       admin_user_id = $5::uuid,
       responded_at = CASE
         WHEN $3::boolean AND $4 IS NOT NULL THEN now()
         WHEN $2::text IN ('resolved', 'closed') THEN coalesce(responded_at, now())
         ELSE responded_at
       END,
       updated_at = now()
     WHERE id = $1::uuid
     RETURNING id`,
    [
      input.ticketId,
      status,
      response !== undefined,
      response ?? null,
      input.adminUserId,
    ],
  );
  if (!updated.rows[0]) return null;

  const list = await listAdminSupportTickets(client, {});
  return list.find((row) => row.id === input.ticketId) ?? null;
}
