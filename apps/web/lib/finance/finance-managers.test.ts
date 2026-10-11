import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import {
  FINANCE_MANAGER_REQUIRED,
  FinanceAccessError,
  MANAGE_MONEY_VIEWER_REFUSAL,
  assertFinanceManager,
  canManageFinances,
  describeFinanceManagers,
  financeManagerRecipientIds,
  isFinanceAccessDenied,
  isFinanceGuardRefusal,
  listFinanceManagers,
  manageMoneyGrantability,
} from "./finance-managers";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const SCOUT = "33333333-3333-4333-8333-333333333333";

function client(rows: unknown[]): PoolClient & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) } as never;
}

describe("canManageFinances", () => {
  it("asks the same SQL function RLS uses, with the org id cast", async () => {
    const db = client([{ allowed: true }]);
    await expect(canManageFinances(db, ORG)).resolves.toBe(true);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("can_manage_finances($1::uuid)"), [ORG]);
  });

  it("treats anything but an explicit true as no", async () => {
    await expect(canManageFinances(client([{ allowed: false }]), ORG)).resolves.toBe(false);
    await expect(canManageFinances(client([]), ORG)).resolves.toBe(false);
    await expect(canManageFinances(client([{ allowed: null }]), ORG)).resolves.toBe(false);
  });

  it("assertFinanceManager refuses with the one plain sentence and a 403", async () => {
    const refusal = assertFinanceManager(client([{ allowed: false }]), ORG);
    await expect(refusal).rejects.toBeInstanceOf(FinanceAccessError);
    await expect(assertFinanceManager(client([{ allowed: false }]), ORG)).rejects.toMatchObject({
      status: 403,
      message: FINANCE_MANAGER_REQUIRED,
    });
    await expect(assertFinanceManager(client([{ allowed: true }]), ORG)).resolves.toBeUndefined();
  });
});

describe("refusal detection", () => {
  it("recognises our refusal and the 0714 trigger sentences", () => {
    expect(isFinanceGuardRefusal(new FinanceAccessError())).toBe(true);
    expect(isFinanceGuardRefusal(new Error(FINANCE_MANAGER_REQUIRED))).toBe(true);
    expect(
      isFinanceGuardRefusal(new Error("Only a finance manager can decide a purchase request. Ask an owner for access.")),
    ).toBe(true);
    expect(isFinanceGuardRefusal(new Error("Organization access denied"))).toBe(false);
  });

  it("only the broad check treats any RLS refusal as a money refusal", () => {
    const rls = Object.assign(new Error('new row violates row-level security policy for table "season_costs"'), {
      code: "42501",
    });
    expect(isFinanceGuardRefusal(rls)).toBe(false);
    expect(isFinanceAccessDenied(rls)).toBe(true);
    expect(isFinanceAccessDenied({ code: "42501", message: "permission denied" })).toBe(true);
    expect(isFinanceAccessDenied(new Error("Category name is required"))).toBe(false);
    expect(isFinanceAccessDenied(null)).toBe(false);
  });
});

describe("who manages money", () => {
  it("lists owners plus admins/team members with an explicit manage_budget grant", async () => {
    const db = client([
      { userId: OWNER, name: "Ana", email: "ana@example.test", role: "owner", via: "owner" },
      { userId: ADMIN, name: "Ben", email: "ben@example.test", role: "admin", via: "granted" },
    ]);
    const managers = await listFinanceManagers(db, ORG);
    expect(managers.map((manager) => manager.userId)).toEqual([OWNER, ADMIN]);
    const [sql, params] = db.query.mock.calls[0]!;
    expect(params).toEqual([ORG]);
    // Mirrors can_manage_finances(): owner by role, otherwise only a granted admin/team member.
    expect(sql).toContain("m.role = 'owner'");
    expect(sql).toContain("m.role IN ('admin', 'scout')");
    expect(sql).toContain("'manage_budget'::org_capability");
    expect(sql).not.toMatch(/role IN \('owner', 'admin'\)/);
  });

  it("notifies every finance manager except the person who acted", async () => {
    const db = client([
      { userId: OWNER, name: "Ana", email: "a@example.test", role: "owner", via: "owner" },
      { userId: SCOUT, name: "Cy", email: "c@example.test", role: "scout", via: "granted" },
    ]);
    await expect(financeManagerRecipientIds(db, ORG, SCOUT)).resolves.toEqual([OWNER]);
  });

  it("describes the list in one line and never invents a name", () => {
    expect(
      describeFinanceManagers([
        { name: "Ana", via: "owner" },
        { name: "Ben", via: "granted" },
      ]),
    ).toBe("Who manages money: Ana (owner), Ben.");
    expect(describeFinanceManagers([])).toMatch(/nobody yet/);
  });
});

describe("manageMoneyGrantability", () => {
  it("lets the owner choose admins and team members", () => {
    expect(manageMoneyGrantability("admin")).toEqual({ grantable: true, reason: null });
    expect(manageMoneyGrantability("scout")).toEqual({ grantable: true, reason: null });
  });

  it("refuses view-only people with a clear next step, and owners who already have it", () => {
    expect(manageMoneyGrantability("viewer")).toEqual({ grantable: false, reason: MANAGE_MONEY_VIEWER_REFUSAL });
    expect(manageMoneyGrantability("owner").grantable).toBe(false);
    expect(manageMoneyGrantability("stranger").grantable).toBe(false);
  });
});
