import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

/**
 * A team's own material for the programming onboarding guide.
 *
 * The org is resolved from the caller's membership and never read from the
 * request body. That is the whole tenancy story for this feature: there is no
 * "which team" parameter to forge, and migration 0612's RLS re-checks it
 * anyway. A member of one team physically cannot attach a resource to another
 * team's guide.
 */

const KINDS = ["note", "link", "repo", "doc", "video", "contact"] as const;
type Kind = (typeof KINDS)[number];

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

type Membership = { orgId: string; orgName: string; teamNumber: number | null; role: string };

async function resolveMembership(client: PoolClient, userId: string): Promise<Membership> {
  const result = await client.query<Membership>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
      ORDER BY o.name
      LIMIT 1`,
    [userId],
  );
  const membership = result.rows[0];
  if (!membership) throw new HttpError(403, "Organization membership required");
  return membership;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Resource request failed" },
    { status },
  );
}

/** Only http(s). A javascript: or data: URL here would be a stored XSS vector. */
function parseUrl(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "That does not look like a full link — include https://");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new HttpError(400, "Links must start with https://");
  }
  return parsed.toString();
}

export async function GET() {
  try {
    const session = await requireSession();
    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);
      const rows = await client.query(
        `SELECT r.id, r.step_id AS "stepId", r.title, r.url, r.body, r.kind,
                r.created_at::text AS "createdAt",
                COALESCE(u.name, 'A teammate') AS "authorName",
                r.created_by = $2::uuid AS "mine"
           FROM team_resources r
           LEFT JOIN users u ON u.id = r.created_by
          WHERE r.org_id = $1::uuid
          ORDER BY r.created_at DESC`,
        [membership.orgId, session.user.id],
      );
      return {
        orgName: membership.orgName,
        teamNumber: membership.teamNumber,
        canManage: membership.role === "owner" || membership.role === "admin",
        resources: rows.rows,
      };
    });
    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

type Action =
  | { action: "add"; stepId?: string | null; title: string; url?: string | null; body?: string; kind?: string }
  | { action: "delete"; id: string };

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as Action;

    const result = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id);

      if (body.action === "add") {
        const title = (body.title ?? "").trim();
        if (!title) throw new HttpError(400, "Give it a title");
        if (title.length > 160) throw new HttpError(400, "Title must be 160 characters or fewer");
        const kind: Kind = (KINDS as readonly string[]).includes(body.kind ?? "")
          ? (body.kind as Kind)
          : "note";
        const url = parseUrl(body.url);
        const stepId = body.stepId ? String(body.stepId).slice(0, 64) : null;

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO team_resources (org_id, step_id, title, url, body, kind, created_by)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
           RETURNING id`,
          [membership.orgId, stepId, title, url, (body.body ?? "").trim().slice(0, 2000), kind, session.user.id],
        );
        const row = inserted.rows[0];
        if (!row) throw new HttpError(400, "Could not save that");
        return { ok: true, id: row.id };
      }

      if (body.action === "delete") {
        // Scoped by org as well as id: the RLS policy is the real guard, this
        // is the second layer CLAUDE.md asks for.
        await client.query(`DELETE FROM team_resources WHERE id = $1::uuid AND org_id = $2::uuid`, [
          body.id,
          membership.orgId,
        ]);
        return { ok: true };
      }

      throw new HttpError(400, "Unknown action");
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
