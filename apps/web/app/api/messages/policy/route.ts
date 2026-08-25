/**
 * Org chat safety policy: how private messages between an adult and a student are handled.
 *
 * Read by every member (both parties in a supervised DM must be able to see the rule they are
 * held to); written only by an owner or admin. The default, applied when no row exists, is
 * `supervised` — see migration 0455_chat_youth_protection.sql.
 */

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import type { PoolClient } from "@neondatabase/serverless";
import { headers } from "next/headers";
import {
  adultAdmins,
  isOrgChatAdmin,
  memberChatClass,
  readDmMode,
  supportsYouthProtection,
  writeDmMode,
} from "../../../../lib/messages/supervision";
import { DM_MODES, DM_MODE_COPY, normalizeDmMode } from "../../../../lib/messages/youth-protection";

export const maxDuration = 10;

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(
    `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new Error("Organization membership required");
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Chat safety request failed";
  return Response.json({ error: message }, { status: message.includes("Authentication") ? 401 : 400 });
}

async function policyPayload(client: PoolClient, orgId: string, userId: string) {
  const supported = await supportsYouthProtection(client);
  if (!supported) {
    return {
      supported: false,
      dmMode: "open" as const,
      canManage: false,
      viewerClass: "youth" as const,
      updatedAt: null as string | null,
      updatedByName: null as string | null,
      adultAdmins: [] as { userId: string; name: string; memberRole: string }[],
      modes: DM_MODE_COPY,
      setupMessage:
        "Chat safety settings are not available on this database yet. Run migration " +
        "0455_chat_youth_protection to turn on the two-adult rule for private messages.",
    };
  }

  const meta = await client.query<{ updatedAt: string | null; updatedByName: string | null }>(
    `SELECT p.updated_at::text AS "updatedAt", u.name AS "updatedByName"
     FROM org_chat_policy p
     LEFT JOIN users u ON u.id = p.updated_by
     WHERE p.org_id = $1::uuid
     LIMIT 1`,
    [orgId],
  );

  const [dmMode, viewerClass, canManage, candidates] = await Promise.all([
    readDmMode(client, orgId),
    memberChatClass(client, orgId, userId),
    isOrgChatAdmin(client, orgId, userId),
    adultAdmins(client, orgId),
  ]);

  return {
    supported: true,
    dmMode,
    canManage,
    viewerClass,
    updatedAt: meta.rows[0]?.updatedAt ?? null,
    updatedByName: meta.rows[0]?.updatedByName ?? null,
    adultAdmins: candidates.map((item) => ({
      userId: item.userId,
      name: item.name,
      memberRole: item.memberRole,
    })),
    modes: DM_MODE_COPY,
    setupMessage: null as string | null,
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMembership(client, orgId, session.user.id);
      return policyPayload(client, orgId, session.user.id);
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as { orgId?: string; dmMode?: string };
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    // Explicit membership check: normalizeDmMode falls back to 'supervised', which would silently
    // turn a typo into a policy change.
    const raw = typeof body.dmMode === "string" ? body.dmMode.trim().toLowerCase() : "";
    if (!(DM_MODES as readonly string[]).includes(raw)) throw new Error("Choose a chat safety setting");
    const dmMode = normalizeDmMode(raw);

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireMembership(client, orgId, session.user.id);
      await writeDmMode(client, orgId, session.user.id, dmMode);
      return policyPayload(client, orgId, session.user.id);
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}
