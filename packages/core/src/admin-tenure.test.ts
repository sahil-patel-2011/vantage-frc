import { describe, expect, it } from "vitest";
import {
  ADMIN_TENURE_BOOTSTRAP_DAYS,
  assertRoleChangeKeepsAdmin,
  computeAdminTenure,
  isPrivilegedOrgRole,
} from "./admin-tenure";

describe("admin tenure", () => {
  it("treats owner and admin as privileged", () => {
    expect(isPrivilegedOrgRole("owner")).toBe(true);
    expect(isPrivilegedOrgRole("admin")).toBe(true);
    expect(isPrivilegedOrgRole("scout")).toBe(false);
  });

  it("keeps bootstrap active for a young solo-admin org", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const created = new Date("2026-07-15T12:00:00.000Z");
    const snap = computeAdminTenure({ orgCreatedAt: created, adminCount: 1, now });
    expect(snap.bootstrapActive).toBe(true);
    expect(snap.lastAdminLocked).toBe(true);
    expect(snap.daysRemaining).toBe(ADMIN_TENURE_BOOTSTRAP_DAYS - 5);
    expect(snap.inviteHint).toMatch(/co-admin/i);
  });

  it("ends bootstrap when a second admin exists even inside the window", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const created = new Date("2026-07-18T12:00:00.000Z");
    const snap = computeAdminTenure({ orgCreatedAt: created, adminCount: 2, now });
    expect(snap.bootstrapActive).toBe(false);
    expect(snap.lastAdminLocked).toBe(false);
    expect(snap.inviteHint).toBeNull();
  });

  it("ends bootstrap after N days for a solo admin", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const created = new Date("2026-07-20T12:00:00.000Z");
    const snap = computeAdminTenure({ orgCreatedAt: created, adminCount: 1, now });
    expect(snap.bootstrapActive).toBe(false);
    expect(snap.lastAdminLocked).toBe(true);
    expect(snap.inviteHint).toMatch(/at least one owner or admin/i);
  });

  it("blocks demoting the last privileged member", () => {
    expect(() =>
      assertRoleChangeKeepsAdmin({
        adminCount: 1,
        targetIsPrivileged: true,
        nextRole: "scout",
      }),
    ).toThrow(/at least one owner or admin/i);
  });

  it("allows demotion when another admin remains", () => {
    expect(() =>
      assertRoleChangeKeepsAdmin({
        adminCount: 2,
        targetIsPrivileged: true,
        nextRole: "viewer",
      }),
    ).not.toThrow();
  });

  it("ignores non-privileged targets", () => {
    expect(() =>
      assertRoleChangeKeepsAdmin({
        adminCount: 1,
        targetIsPrivileged: false,
        nextRole: "viewer",
      }),
    ).not.toThrow();
  });
});
