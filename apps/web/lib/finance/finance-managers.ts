/**
 * FINANCE MANAGERS — who may change the team's money (0714_finance_managers.sql).
 *
 * A finance manager is the team OWNER, always, plus any admin or team member the
 * owner granted "Manage money" (the existing `manage_budget` capability). Admins
 * are not finance managers by role. View-only people never are.
 *
 * None of this module is the authorization: `can_manage_finances(org_id)` backs
 * every money policy in RLS, so a route that forgot to call these helpers still
 * gets a refusal from the database. These helpers exist so a person sees one
 * plain sentence instead of a policy violation, and so a page can hide a button
 * that would only fail.
 *
 * Every query runs on the caller's withRls client, under their own app.user_id.
 */

import type { PoolClient } from "@neondatabase/serverless";

/** The one sentence every money refusal uses, in the API and in the UI. */
export const FINANCE_MANAGER_REQUIRED =
  "Only people your team owner chose can change money. Ask an owner for access.";

/** What the permission is called wherever a person sees it. */
export const MANAGE_MONEY_LABEL = "Manage money";

export const MANAGE_MONEY_DESCRIPTION =
  "Can manage money — budgets, spending, reimbursements, sponsors' contributions, fundraiser proceeds, grant allocations.";

/** Shown in place of the toggle when the person is view-only. */
export const MANAGE_MONEY_VIEWER_REFUSAL =
  "View-only people can't manage money. Change their access to Team member or Team admin first.";

/** Thrown by assertFinanceManager; routes map it to HTTP 403. */
export class FinanceAccessError extends Error {
  readonly status = 403;
  readonly reason = "not_finance_manager";
  constructor(message: string = FINANCE_MANAGER_REQUIRED) {
    super(message);
    this.name = "FinanceAccessError";
  }
}

/** True when the signed-in person may change money on this team. */
export async function canManageFinances(client: PoolClient, orgId: string): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(
    `SELECT can_manage_finances($1::uuid) AS allowed`,
    [orgId],
  );
  return result.rows[0]?.allowed === true;
}

export async function assertFinanceManager(client: PoolClient, orgId: string): Promise<void> {
  if (!(await canManageFinances(client, orgId))) throw new FinanceAccessError();
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") return String((error as { message?: unknown }).message ?? "");
  return typeof error === "string" ? error : "";
}

/**
 * Our own refusal, or one of the 0714 guard triggers' sentences. Safe to use in
 * shared error mappers: it never matches a refusal that is about something else.
 */
export function isFinanceGuardRefusal(error: unknown): boolean {
  if (error instanceof FinanceAccessError) return true;
  return /owner chose can change money|only a finance manager can/i.test(errorText(error));
}

/**
 * Broader: also any RLS violation or insufficient_privilege (SQLSTATE 42501).
 * Use it only in routes whose every write is a money write, where an RLS
 * refusal can only mean "not a finance manager".
 */
export function isFinanceAccessDenied(error: unknown): boolean {
  if (isFinanceGuardRefusal(error)) return true;
  if (error && typeof error === "object" && (error as { code?: unknown }).code === "42501") return true;
  return /row-level security/i.test(errorText(error));
}

export type FinanceManager = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "scout";
  /** "owner" holds it by role; "granted" was chosen by an owner. */
  via: "owner" | "granted";
};

/**
 * Everyone who can change money right now. Mirrors can_manage_finances(): the
 * owners, then admins/team members with an explicit grant. Memberships and
 * capability rows are both member-readable, so every member can see who to ask.
 */
export async function listFinanceManagers(client: PoolClient, orgId: string): Promise<FinanceManager[]> {
  const result = await client.query<FinanceManager>(
    `SELECT m.user_id::text AS "userId",
            COALESCE(NULLIF(u.name, ''), u.email) AS name,
            u.email,
            m.role::text AS role,
            CASE WHEN m.role = 'owner' THEN 'owner' ELSE 'granted' END AS via
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid
        AND (
          m.role = 'owner'
          OR (
            m.role IN ('admin', 'scout')
            AND EXISTS (
              SELECT 1 FROM membership_capabilities c
               WHERE c.org_id = m.org_id AND c.user_id = m.user_id
                 AND c.capability = 'manage_budget'::org_capability
            )
          )
        )
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name, u.email
      LIMIT 200`,
    [orgId],
  );
  return result.rows;
}

/**
 * Who to notify about a money decision (a new purchase request, a claim to
 * review): every finance manager except the person who caused it.
 */
export async function financeManagerRecipientIds(
  client: PoolClient,
  orgId: string,
  exceptUserId: string,
): Promise<string[]> {
  const managers = await listFinanceManagers(client, orgId);
  return managers.map((manager) => manager.userId).filter((userId) => userId !== exceptUserId);
}

/** "Who manages money: Ana (owner), Ben." — the short line shown to everyone. */
export function describeFinanceManagers(managers: Array<Pick<FinanceManager, "name" | "via">>): string {
  if (!managers.length) return "Who manages money: nobody yet — the team owner can choose people.";
  const names = managers.map((manager) => (manager.via === "owner" ? `${manager.name} (owner)` : manager.name));
  return `Who manages money: ${names.join(", ")}.`;
}

/**
 * Whether the owner can hand "Manage money" to this person. Mirrors the 0714
 * trigger so the panel says why instead of offering a toggle that fails.
 */
export function manageMoneyGrantability(role: string): { grantable: boolean; reason: string | null } {
  if (role === "owner") return { grantable: false, reason: "Owners always manage money." };
  if (role === "viewer") return { grantable: false, reason: MANAGE_MONEY_VIEWER_REFUSAL };
  if (role === "admin" || role === "scout") return { grantable: true, reason: null };
  return { grantable: false, reason: "That person is not on this team." };
}
