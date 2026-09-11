import type { PoolClient } from "@neondatabase/serverless";
import { auth, resolveAuthBaseURL } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { validateContactInput } from "../../../lib/parent-comms/contacts";
import { newParentToken } from "../../../lib/parent-comms/tokens";
import {
  buildOrgDigest,
  sendParentDigestForOrg,
  type ParentDigestOrgSummary,
} from "../../../lib/parent-comms/send-digest";

/**
 * Mentor-side parent communications API (owner/admin only).
 * Parent contact details are adult PII attached to minors: RLS on
 * parent_contacts already restricts every operation to owners/admins, and this
 * route additionally refuses non-admin members with an honest "restricted"
 * state instead of showing an empty list that looks like real data.
 */

export type ParentContactView = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  preferredLanguage: string;
  studentLabel: string;
  memberUserId: string | null;
  memberName: string | null;
  digestOptIn: boolean;
  active: boolean;
  viewUrl: string;
  createdAt: string;
};

export type ParentDigestLogView = {
  id: string;
  contactName: string;
  contactEmail: string;
  subject: string;
  periodStart: string;
  periodEnd: string;
  status: "sent" | "skipped" | "failed" | "setup_required";
  reason: string | null;
  translatedTo: string | null;
  createdAt: string;
};

export type ParentsView =
  | { status: "setup_required"; orgId: null; message: string }
  | { status: "restricted"; orgId: string; orgName: string; message: string }
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      emailConfigured: boolean;
      contacts: ParentContactView[];
      members: Array<{ userId: string; name: string }>;
      log: ParentDigestLogView[];
      preview: { subject: string; text: string; periodStart: string; periodEnd: string } | null;
    };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function trimmedOrNull(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

async function resolveAdminOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; orgName: string; teamNumber: number | null; role: string } | null> {
  const membership = await client.query<{
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    role: string;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role::text AS role
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

const isAdmin = (role: string) => role === "owner" || role === "admin";

function emailConfigured(): boolean {
  // Mirrors createEmailProvider(): non-production uses the local dev mailbox.
  if (process.env.NODE_ENV !== "production") return true;
  return Boolean(process.env.RESEND_API_KEY && process.env.AUTH_EMAIL_FROM);
}

async function computeParentsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; previewNote: string | null },
): Promise<ParentsView> {
  const org = await resolveAdminOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      orgId: null,
      message: "Choose your team to manage parent contacts.",
    };
  }
  if (!isAdmin(org.role)) {
    return {
      status: "restricted",
      orgId: org.orgId,
      orgName: org.orgName,
      message:
        "Parent contact details are restricted to team owners and admins. Ask a mentor with the admin role to manage parent updates.",
    };
  }

  const baseUrl = resolveAuthBaseURL();
  const [contacts, members, log, built] = await Promise.all([
    client.query<{
      id: string;
      name: string;
      email: string;
      phone: string | null;
      preferredLanguage: string;
      studentLabel: string;
      memberUserId: string | null;
      memberName: string | null;
      digestOptIn: boolean;
      active: boolean;
      viewToken: string;
      createdAt: string;
    }>(
      `SELECT pc.id::text AS id, pc.name, pc.email, pc.phone,
              pc.preferred_language AS "preferredLanguage",
              pc.student_label AS "studentLabel",
              pc.member_user_id::text AS "memberUserId",
              u.name AS "memberName",
              pc.digest_opt_in AS "digestOptIn",
              pc.active,
              pc.view_token AS "viewToken",
              pc.created_at::text AS "createdAt"
       FROM parent_contacts pc
       LEFT JOIN users u ON u.id = pc.member_user_id
       WHERE pc.org_id = $1::uuid
       ORDER BY pc.active DESC, lower(pc.name)`,
      [org.orgId],
    ),
    client.query<{ userId: string; name: string }>(
      `SELECT m.user_id AS "userId", COALESCE(NULLIF(u.name, ''), u.email) AS name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1::uuid
       ORDER BY lower(COALESCE(NULLIF(u.name, ''), u.email))
       LIMIT 300`,
      [org.orgId],
    ),
    client.query<ParentDigestLogView>(
      `SELECT s.id::text AS id,
              pc.name AS "contactName",
              pc.email AS "contactEmail",
              s.subject,
              s.period_start::text AS "periodStart",
              s.period_end::text AS "periodEnd",
              s.status,
              s.reason,
              s.translated_to AS "translatedTo",
              s.created_at::text AS "createdAt"
       FROM parent_digest_sends s
       JOIN parent_contacts pc ON pc.id = s.contact_id
       WHERE s.org_id = $1::uuid
       ORDER BY s.created_at DESC
       LIMIT 100`,
      [org.orgId],
    ),
    buildOrgDigest(client, {
      orgId: org.orgId,
      orgName: org.orgName,
      teamNumber: org.teamNumber,
      now: new Date(),
      logisticsNotes: input.previewNote,
    }),
  ]);

  return {
    status: "ready",
    orgId: org.orgId,
    orgName: org.orgName,
    teamNumber: org.teamNumber,
    emailConfigured: emailConfigured(),
    contacts: contacts.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      preferredLanguage: row.preferredLanguage,
      studentLabel: row.studentLabel,
      memberUserId: row.memberUserId,
      memberName: row.memberName,
      digestOptIn: row.digestOptIn,
      active: row.active,
      viewUrl: `${baseUrl}/parent-view/${row.viewToken}`,
      createdAt: row.createdAt,
    })),
    members: members.rows,
    log: log.rows,
    preview: built
      ? {
          subject: built.digest.subject,
          text: built.digest.text,
          periodStart: built.period.periodStart,
          periodEnd: built.period.periodEnd,
        }
      : null,
  };
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = uuidOrNull(url.searchParams.get("orgId"));
  const previewNote = trimmedOrNull(url.searchParams.get("note"), 1000);

  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeParentsView(client, { userId: session.user.id, requestedOrg, previewNote }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        orgId: null,
        message: "Could not load parent contacts. Choose your team and try again.",
      } satisfies ParentsView,
      { status: 200 },
    );
  }
}

async function requireAdminOrg(
  client: PoolClient,
  userId: string,
  orgId: string,
): Promise<{ orgId: string; orgName: string; teamNumber: number | null }> {
  const org = await resolveAdminOrg(client, userId, orgId);
  if (!org) throw new HttpError(403, "Organization membership required");
  if (!isAdmin(org.role)) {
    throw new HttpError(403, "Managing parent contacts requires the owner or admin role");
  }
  return { orgId: org.orgId, orgName: org.orgName, teamNumber: org.teamNumber };
}

function isDuplicateEmail(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
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
  const action = typeof body.action === "string" ? body.action : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const userId = session.user.id;

  try {
    const result = await withRls({ userId, orgId }, async (client) => {
      const org = await requireAdminOrg(client, userId, orgId);
      let digestSummary: ParentDigestOrgSummary | null = null;

      if (action === "add") {
        const validated = validateContactInput({
          name: body.name,
          email: body.email,
          phone: body.phone,
          preferredLanguage: body.preferredLanguage,
          studentLabel: body.studentLabel,
        });
        if (!validated.ok) throw new HttpError(400, validated.error);
        const memberUserId = uuidOrNull(body.memberUserId);
        try {
          await client.query(
            `INSERT INTO parent_contacts
               (org_id, member_user_id, student_label, name, email, phone,
                preferred_language, unsubscribe_token, view_token, created_by)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::uuid)`,
            [
              org.orgId,
              memberUserId,
              validated.contact.studentLabel,
              validated.contact.name,
              validated.contact.email,
              validated.contact.phone,
              validated.contact.preferredLanguage,
              newParentToken(),
              newParentToken(),
              userId,
            ],
          );
        } catch (error) {
          if (isDuplicateEmail(error)) {
            throw new HttpError(409, "A contact with that email already exists for this team.");
          }
          throw error;
        }
      } else if (action === "update") {
        const contactId = uuidOrNull(body.contactId);
        if (!contactId) throw new HttpError(400, "contactId is required");
        const validated = validateContactInput({
          name: body.name,
          email: body.email,
          phone: body.phone,
          preferredLanguage: body.preferredLanguage,
          studentLabel: body.studentLabel,
        });
        if (!validated.ok) throw new HttpError(400, validated.error);
        const memberUserId = uuidOrNull(body.memberUserId);
        const digestOptIn = typeof body.digestOptIn === "boolean" ? body.digestOptIn : null;
        try {
          const updated = await client.query(
            `UPDATE parent_contacts
             SET name = $3, email = $4, phone = $5, preferred_language = $6,
                 student_label = $7, member_user_id = $8::uuid,
                 digest_opt_in = COALESCE($9, digest_opt_in),
                 updated_at = now()
             WHERE id = $1::uuid AND org_id = $2::uuid
             RETURNING id`,
            [
              contactId,
              org.orgId,
              validated.contact.name,
              validated.contact.email,
              validated.contact.phone,
              validated.contact.preferredLanguage,
              validated.contact.studentLabel,
              memberUserId,
              digestOptIn,
            ],
          );
          if (!updated.rowCount) throw new HttpError(404, "Contact not found");
        } catch (error) {
          if (isDuplicateEmail(error)) {
            throw new HttpError(409, "A contact with that email already exists for this team.");
          }
          throw error;
        }
      } else if (action === "deactivate" || action === "reactivate") {
        const contactId = uuidOrNull(body.contactId);
        if (!contactId) throw new HttpError(400, "contactId is required");
        const updated = await client.query(
          `UPDATE parent_contacts
           SET active = $3, updated_at = now()
           WHERE id = $1::uuid AND org_id = $2::uuid
           RETURNING id`,
          [contactId, org.orgId, action === "reactivate"],
        );
        if (!updated.rowCount) throw new HttpError(404, "Contact not found");
      } else if (action === "send_now") {
        digestSummary = await sendParentDigestForOrg(client, {
          orgId: org.orgId,
          orgName: org.orgName,
          teamNumber: org.teamNumber,
          logisticsNotes: trimmedOrNull(body.logisticsNotes, 1000),
          meteredUserId: userId,
          transactionalAi: false,
          force: true,
        });
      } else {
        throw new HttpError(400, "Unknown action");
      }

      const view = await computeParentsView(client, {
        userId,
        requestedOrg: org.orgId,
        previewNote: null,
      });
      return { view, digestSummary };
    });

    return Response.json({ ...result.view, digestSummary: result.digestSummary });
  } catch (error) {
    if (error instanceof HttpError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: "Parent contacts are unavailable right now. Try again in a moment." },
      { status: 500 },
    );
  }
}
