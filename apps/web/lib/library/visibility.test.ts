import { describe, expect, it } from "vitest";
import { canManageItem, canViewItem, describeAudience, isOrgManager } from "./visibility";

describe("canViewItem (mirror of the 0489 RLS SELECT policy)", () => {
  const restricted = {
    visibility: "restricted" as const,
    createdBy: "creator",
    grantedUserIds: ["granted"],
  };

  it("lets every member see team-wide items", () => {
    expect(canViewItem({ visibility: "team", createdBy: "creator" }, "anyone", "member")).toBe(true);
  });

  it("hides restricted items from plain members without a grant", () => {
    expect(canViewItem(restricted, "someone-else", "member")).toBe(false);
  });

  it("shows restricted items to the creator", () => {
    expect(canViewItem(restricted, "creator", "member")).toBe(true);
  });

  it("shows restricted items to explicitly-granted members", () => {
    expect(canViewItem(restricted, "granted", "member")).toBe(true);
  });

  it("shows restricted items to org owners and admins", () => {
    expect(canViewItem(restricted, "boss", "owner")).toBe(true);
    expect(canViewItem(restricted, "boss", "admin")).toBe(true);
  });

  it("treats a missing grant list as no grants", () => {
    expect(
      canViewItem({ visibility: "restricted", createdBy: "creator" }, "someone", "member"),
    ).toBe(false);
  });
});

describe("canManageItem", () => {
  it("allows the creator and owners/admins only", () => {
    expect(canManageItem("creator", "creator", "member")).toBe(true);
    expect(canManageItem("creator", "other", "member")).toBe(false);
    expect(canManageItem("creator", "other", "admin")).toBe(true);
    expect(canManageItem("creator", "other", "owner")).toBe(true);
  });
});

describe("isOrgManager", () => {
  it("recognizes only owner and admin", () => {
    expect(isOrgManager("owner")).toBe(true);
    expect(isOrgManager("admin")).toBe(true);
    expect(isOrgManager("member")).toBe(false);
    expect(isOrgManager("")).toBe(false);
  });
});

describe("describeAudience", () => {
  const names = new Map<string, string | null>([
    ["u1", "Ada"],
    ["u2", "Grace"],
  ]);

  it("says team-wide plainly", () => {
    expect(describeAudience({ visibility: "team", createdBy: "c" }, names)).toBe(
      "Everyone on the team",
    );
  });

  it("names granted members and never invents them", () => {
    expect(
      describeAudience({ visibility: "restricted", createdBy: "c", grantedUserIds: [] }, names),
    ).toBe("Only you and team owners/admins");
    expect(
      describeAudience(
        { visibility: "restricted", createdBy: "c", grantedUserIds: ["u1", "u2"] },
        names,
      ),
    ).toBe("You, Ada, Grace, and team owners/admins");
  });

  it("summarizes long grant lists with a real count", () => {
    const text = describeAudience(
      { visibility: "restricted", createdBy: "c", grantedUserIds: ["u1", "u2", "x", "y"] },
      names,
    );
    expect(text).toContain("+1");
  });
});
