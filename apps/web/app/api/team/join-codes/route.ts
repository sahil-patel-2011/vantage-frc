import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { randomInt } from "node:crypto";

// Owner/admin management of self-signup join codes.
//
// A code is scoped to exactly one org and, per the CHECK constraint in migration 0515,
// can only ever confer 'scout' or 'viewer'. Owner and admin stay invite-only, so a
// leaked code can never escalate into control of a team's workspace.
//
// RLS does the real enforcement (org_join_codes_admin requires owner/admin); the role
// and bounds checks here exist to return a clear 400 instead of a policy violation.

// Excludes I, O, 0, 1 so a code read aloud in a shop or over a headset is unambiguous.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const JOINABLE_ROLES = new Set(["scout", "viewer"]);
const MAX_EXPIRY_DAYS = 365;

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return session;
}

function orgIdFrom(request: Request) {
  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) throw new Error("orgId is required");
  return orgId;
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = orgIdFrom(request);
    const codes = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query(
        `SELECT c.id, c.code, c.role::text AS role, c.max_uses AS "maxUses", c.uses,
                c.expires_at AS "expiresAt", c.revoked_at AS "revokedAt",
                c.created_at AS "createdAt",
                (SELECT count(*)::int FROM org_join_code_redemptions r WHERE r.join_code_id = c.id)
                  AS "redemptions"
           FROM org_join_codes c
          WHERE c.org_id = $1::uuid
          ORDER BY c.created_at DESC`,
        [orgId],
      );
      return result.rows;
    });
    return Response.json({ codes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load join codes";
    return Response.json({ error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const orgId = orgIdFrom(request);
    const body = (await request.json().catch(() => ({}))) as {
      role?: string;
      maxUses?: number;
      expiresInDays?: number;
    };

    const role = (body.role ?? "scout").toLowerCase();
    if (!JOINABLE_ROLES.has(role)) {
      return Response.json(
        { error: "A join code can only grant the scout or viewer role" },
        { status: 400 },
      );
    }
    const maxUsesRaw = body.maxUses === null || body.maxUses === undefined ? null : Number(body.maxUses);
    if (maxUsesRaw !== null && (!Number.isInteger(maxUsesRaw) || maxUsesRaw < 1 || maxUsesRaw > 500)) {
      return Response.json(
        { error: "maxUses must be a whole number between 1 and 500, or omitted for unlimited" },
        { status: 400 },
      );
    }
    const days = Number(body.expiresInDays);
    const expiresAt =
      Number.isFinite(days) && days > 0
        ? new Date(Date.now() + Math.min(days, MAX_EXPIRY_DAYS) * 86_400_000)
        : null;

    const created = await withRls({ userId: session.user.id, orgId }, async (client) => {
      // Retry on the (vanishingly unlikely) unique collision rather than 500ing.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = generateCode();
        try {
          const result = await client.query<{ id: string; code: string }>(
            `INSERT INTO org_join_codes(org_id, code, role, max_uses, expires_at, created_by)
             VALUES ($1::uuid, $2, $3::org_role, $4, $5, $6::uuid)
             RETURNING id, code`,
            [orgId, code, role, maxUsesRaw, expiresAt, session.user.id],
          );
          return result.rows[0]!;
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (!/org_join_codes_code_key|duplicate key/i.test(message)) throw error;
        }
      }
      throw new Error("Could not allocate a unique join code; try again");
    });

    return Response.json(
      {
        id: created.id,
        code: created.code,
        role,
        maxUses: maxUsesRaw,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a join code";
    if (message === "Unauthorized") return Response.json({ error: message }, { status: 401 });
    if (/row-level security|permission denied/i.test(message)) {
      return Response.json(
        { error: "Only an owner or admin can create join codes for this team" },
        { status: 403 },
      );
    }
    return Response.json({ error: message }, { status: 400 });
  }
}

/** Turning a code off is preferred over deletion so its redemption history survives. */
export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const id = url.searchParams.get("id");
    if (!orgId || !id) {
      return Response.json({ error: "orgId and id are required" }, { status: 400 });
    }

    const revoked = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const result = await client.query(
        `UPDATE org_join_codes SET revoked_at = now()
          WHERE id = $1::uuid AND org_id = $2::uuid AND revoked_at IS NULL
          RETURNING id`,
        [id, orgId],
      );
      return result.rows[0] ?? null;
    });
    if (!revoked) {
      return Response.json({ error: "That code is already off or does not exist" }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not revoke the join code";
    return Response.json({ error: message }, { status: message === "Unauthorized" ? 401 : 400 });
  }
}
