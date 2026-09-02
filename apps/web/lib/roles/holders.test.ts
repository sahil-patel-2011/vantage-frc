import { describe, expect, it } from "vitest";
import { holderForTitle, resolveRoleHolders } from "./holders";
import type { TeamRole } from "./types";

let seq = 0;
function role(overrides: Partial<TeamRole> = {}): TeamRole {
  seq += 1;
  return {
    id: `r-${seq}`,
    title: `Role ${seq}`,
    subteam: "mechanical",
    holderUserId: null,
    holderName: null,
    isLead: false,
    responsibilities: null,
    notes: null,
    seasonYear: 2026,
    ...overrides,
  };
}

const members = [
  { userId: "u-1", name: "Riya Patel", email: "riya@example.com" },
  { userId: "u-2", name: "", email: "sam@example.com" },
];

describe("resolveRoleHolders", () => {
  it("resolves a member holder to the account name", () => {
    const holders = resolveRoleHolders(
      [role({ id: "r-safety", title: "Safety captain", holderUserId: "u-1", holderName: "stale" })],
      members,
    );
    expect(holders).toEqual([
      { roleId: "r-safety", title: "Safety captain", subteam: "mechanical", isLead: false, userId: "u-1", name: "Riya Patel" },
    ]);
  });

  it("falls back to the email when the member has no display name", () => {
    const holders = resolveRoleHolders([role({ holderUserId: "u-2" })], members);
    expect(holders[0]?.name).toBe("sam@example.com");
    expect(holders[0]?.userId).toBe("u-2");
  });

  it("keeps a free-text holder with no account as a label-only holder", () => {
    const holders = resolveRoleHolders([role({ holderName: "Coach Kim" })], members);
    expect(holders[0]).toMatchObject({ userId: null, name: "Coach Kim" });
  });

  it("omits unfilled roles", () => {
    expect(resolveRoleHolders([role(), role({ holderName: "   " })], members)).toEqual([]);
  });
});

describe("holderForTitle", () => {
  const holders = resolveRoleHolders(
    [
      role({ title: "Safety captain (lead)", holderUserId: "u-1" }),
      role({ title: "Drive coach", holderName: "Coach Kim" }),
    ],
    members,
  );

  it("matches exact and leading-phrase titles case-insensitively", () => {
    expect(holderForTitle(holders, "drive coach")?.name).toBe("Coach Kim");
    expect(holderForTitle(holders, "Safety captain")?.userId).toBe("u-1");
  });

  it("returns null for unknown or blank titles", () => {
    expect(holderForTitle(holders, "Scouting lead")).toBeNull();
    expect(holderForTitle(holders, "  ")).toBeNull();
  });
});
