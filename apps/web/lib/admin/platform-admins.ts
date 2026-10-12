import type { PoolClient } from "@neondatabase/serverless";

/**
 * Who runs Vantage: add a platform admin by the email of an existing account, remove one, or
 * hand the role to someone else in one step. Migration 0727 holds the rules (never the last
 * admin, audited, an inbox note for the new admin); this file turns its refusals into sentences.
 */

export type PlatformAdmin = {
  userId: string;
  email: string;
  name: string;
  grantedAt: string;
  grantedByEmail: string | null;
  you: boolean;
  /** The platform owner (0733): the one person who adds and removes admins and bans teams. */
  owner: boolean;
};

export type PlatformAdminErrorCode =
  | "not_platform_admin"
  | "no_account"
  | "already_admin"
  | "not_admin"
  | "last_admin"
  | "self"
  | "invalid_email"
  | "reauth_required"
  | "setup_required"
  | "owner_only"
  | "owner_protected";

const MESSAGES: Record<PlatformAdminErrorCode, { status: number; message: string }> = {
  not_platform_admin: { status: 404, message: "Not found" },
  no_account: {
    status: 422,
    message: "No Vantage account uses that email. Ask them to sign in to Vantage once, then add them.",
  },
  already_admin: { status: 409, message: "That person is already a platform admin." },
  not_admin: { status: 404, message: "That person is not a platform admin any more. Refresh the list." },
  last_admin: {
    status: 409,
    message: "Vantage needs at least one platform admin. Add someone else first, or use Transfer.",
  },
  self: { status: 400, message: "Choose someone other than yourself to hand Platform admin to." },
  invalid_email: { status: 400, message: "Enter the email address of their Vantage account." },
  reauth_required: {
    status: 403,
    message: "For your security, sign in again before changing who is a platform admin. It only takes a moment.",
  },
  setup_required: {
    status: 503,
    message: "Platform admin changes need database migration 0727. Run the migrations, then try again.",
  },
  owner_only: { status: 403, message: "Only the platform owner can change who is a platform admin." },
  owner_protected: {
    status: 409,
    message: "The platform owner can't be removed. To step down, hand the role over instead.",
  },
};

export class PlatformAdminError extends Error {
  constructor(readonly code: PlatformAdminErrorCode) {
    super(MESSAGES[code].message);
    this.name = "PlatformAdminError";
  }
  get status() {
    return MESSAGES[this.code].status;
  }
}

/** A Postgres error from the 0727 functions, mapped by its `vantage:` detail. */
export function platformAdminRefusal(error: unknown): PlatformAdminError | null {
  if (error instanceof PlatformAdminError) return error;
  if (!error || typeof error !== "object") return null;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  // undefined_function: the database has not had 0727 yet.
  if (code === "42883") return new PlatformAdminError("setup_required");
  const detail = "detail" in error ? String((error as { detail?: unknown }).detail ?? "") : "";
  const match = /^vantage:([a-z_]+)$/.exec(detail);
  if (match && match[1]! in MESSAGES) return new PlatformAdminError(match[1] as PlatformAdminErrorCode);
  return null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAdminEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) throw new PlatformAdminError("invalid_email");
  return email;
}

export async function listPlatformAdmins(client: PoolClient, userId: string): Promise<PlatformAdmin[]> {
  // Read through to_jsonb so a database without 0733 (no is_owner column yet) still lists them.
  const result = await client.query<{
    userId: string;
    email: string;
    name: string;
    grantedAt: string;
    grantedByEmail: string | null;
    owner: boolean;
  }>(
    `SELECT l.user_id AS "userId", l.email, l.name, l.granted_at::text AS "grantedAt",
            l.granted_by_email AS "grantedByEmail",
            COALESCE((to_jsonb(l) ->> 'is_owner')::boolean, false) AS owner
       FROM platform_admin_list() l`,
  );
  return result.rows.map((row) => ({ ...row, you: row.userId === userId }));
}

export async function addPlatformAdmin(client: PoolClient, email: string): Promise<string> {
  const result = await client.query<{ id: string }>(`SELECT platform_admin_add($1::text) AS id`, [email]);
  return result.rows[0]!.id;
}

export async function removePlatformAdmin(client: PoolClient, userId: string): Promise<void> {
  await client.query(`SELECT platform_admin_remove($1::uuid)`, [userId]);
}

export async function transferPlatformAdmin(client: PoolClient, email: string): Promise<string> {
  const result = await client.query<{ id: string }>(`SELECT platform_admin_transfer($1::text) AS id`, [email]);
  return result.rows[0]!.id;
}

/** What the page can offer, so it never shows a button the database will refuse. */
export function platformAdminAbilities(admins: PlatformAdmin[]) {
  const count = admins.length;
  const ownerKnown = admins.some((admin) => admin.owner);
  if (!ownerKnown) {
    // Before 0733: any admin manages the list, never the last one.
    return { isOwner: false, canAdd: true, canRemoveOthers: count > 1, canRemoveSelf: count > 1, canTransfer: true };
  }
  const isOwner = admins.some((admin) => admin.you && admin.owner);
  return {
    isOwner,
    canAdd: isOwner,
    canRemoveOthers: isOwner && count > 1,
    // The owner steps down only by handing over; anyone else may leave.
    canRemoveSelf: !isOwner,
    canTransfer: isOwner,
  };
}
