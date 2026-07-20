import { describe, expect, it } from "vitest";
import { sortMembershipsByRecent } from "./recent-teams";

describe("sortMembershipsByRecent", () => {
  it("floats recent org ids without inventing DEMO memberships", () => {
    const rows = [
      { orgId: "aaa", label: "Alpha" },
      { orgId: "bbb", label: "Beta" },
      { orgId: "ccc", label: "Gamma" },
    ];
    expect(sortMembershipsByRecent(rows, ["ccc", "aaa"]).map((r) => r.orgId)).toEqual([
      "ccc",
      "aaa",
      "bbb",
    ]);
  });

  it("returns the original order when there is no MRU history", () => {
    const rows = [
      { orgId: "aaa", label: "Alpha" },
      { orgId: "bbb", label: "Beta" },
    ];
    expect(sortMembershipsByRecent(rows, [])).toEqual(rows);
  });
});
