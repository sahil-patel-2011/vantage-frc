import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  acknowledge,
  createAnnouncement,
  deleteAnnouncement,
  fanOutAnnouncement,
  isAnnouncementPriority,
  listAnnouncements,
  outstandingAcks,
  setPinned,
} from "../../../lib/announcements/store";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

type Membership = { orgId: string; orgName: string; role: string };

async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrgId: string | null,
): Promise<Membership> {
  const result = await client.query<Membership>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY o.name
      LIMIT 1`,
    [userId, requestedOrgId],
  );
  const membership = result.rows[0];
  if (!membership) throw new HttpError(403, "Organization membership required");
  return membership;
}

/**
 * Posting is owners/admins only, enforced here rather than in RLS.
 *
 * The table's INSERT policy stays open to any member on purpose: notify-match
 * writes the automatic match alert as whoever opened My Day, and that write is
 * inside a swallowed catch, so tightening the policy would silently stop match
 * alerts. Here we can tell a person composing a broadcast apart from a
 * background alert, so the restriction belongs at this layer.
 */
function requireAdmin(membership: Membership) {
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new HttpError(403, "Only owners and admins can post announcements");
  }
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Announcement request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const outstandingFor = url.searchParams.get("outstandingFor");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      if (outstandingFor) {
        // Who has not acknowledged a required notice is a leadership view. The
        // page only offers the control to owners and admins, but the server was
        // not enforcing it, so any member — including a viewer — could read the
        // list, which falls back to a teammate's email address when no name is
        // set. Client-side gating is not authorization.
        requireAdmin(membership);
        return {
          orgId: membership.orgId,
          orgName: membership.orgName,
          canPost: true,
          outstanding: await outstandingAcks(client, membership.orgId, outstandingFor),
          announcements: [],
        };
      }
      return {
        orgId: membership.orgId,
        orgName: membership.orgName,
        canPost: membership.role === "owner" || membership.role === "admin",
        announcements: await listAnnouncements(client, membership.orgId, session.user.id),
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

type Action =
  | { action: "post"; title: string; body?: string; priority?: string; pinned?: boolean; requireAck?: boolean }
  | { action: "acknowledge"; announcementId: string }
  | { action: "pin"; announcementId: string; pinned: boolean }
  | { action: "delete"; announcementId: string };

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as Action;
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const orgId = membership.orgId;

      switch (body.action) {
        case "post": {
          requireAdmin(membership);
          const title = (body.title ?? "").trim();
          if (!title) throw new HttpError(400, "Give the announcement a title");
          if (title.length > 200) throw new HttpError(400, "Title must be 200 characters or fewer");
          const priority = isAnnouncementPriority(body.priority) ? body.priority : "normal";
          const announcementId = await createAnnouncement(client, {
            orgId,
            userId: session.user.id,
            title,
            body: (body.body ?? "").trim().slice(0, 4000),
            priority,
            pinned: body.pinned ?? false,
            requireAck: body.requireAck ?? false,
          });
          const notified = await fanOutAnnouncement(client, {
            orgId,
            announcementId,
            authorId: session.user.id,
            title,
            priority,
          });
          return { ok: true, announcementId, notified };
        }

        case "acknowledge": {
          await acknowledge(client, { orgId, announcementId: body.announcementId, userId: session.user.id });
          return { ok: true };
        }

        case "pin": {
          requireAdmin(membership);
          await setPinned(client, orgId, body.announcementId, Boolean(body.pinned));
          return { ok: true };
        }

        case "delete": {
          requireAdmin(membership);
          await deleteAnnouncement(client, orgId, body.announcementId);
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unknown announcement action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
