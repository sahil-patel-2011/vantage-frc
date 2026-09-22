import type { PoolClient } from "@neondatabase/serverless";

/**
 * Who may do what with a team's Microsoft connection. Checked server-side in every route,
 * in addition to RLS (which enforces the same rule in the database: see migration 0671).
 *
 *   see status (connected? whose account? last sync?)  any member
 *   connect / sync now / disconnect / see sync history  owner or admin
 */

export type OrgRole = "owner" | "admin" | "scout" | "viewer";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "error",
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function roleCanManageWorkbook(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function roleCanViewWorkbook(role: string | null | undefined): boolean {
  return typeof role === "string" && role.length > 0;
}

export async function readOrgRole(client: PoolClient, orgId: string, userId: string): Promise<string | null> {
  const result = await client.query<{ role: string }>(
    `SELECT role::text AS role FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [orgId, userId],
  );
  return result.rows[0]?.role ?? null;
}

export async function requireWorkbookViewer(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const role = await readOrgRole(client, orgId, userId);
  if (!roleCanViewWorkbook(role)) throw new HttpError(403, "You are not a member of this team.", "not_member");
  return role!;
}

export async function requireWorkbookManager(client: PoolClient, orgId: string, userId: string): Promise<string> {
  const role = await readOrgRole(client, orgId, userId);
  if (!roleCanViewWorkbook(role)) throw new HttpError(403, "You are not a member of this team.", "not_member");
  if (!roleCanManageWorkbook(role)) {
    throw new HttpError(403, "Only a team owner or admin can change the Microsoft Excel connection.", "not_manager");
  }
  return role!;
}

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
