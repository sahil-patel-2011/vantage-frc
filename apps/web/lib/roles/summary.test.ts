import { describe, expect, it } from "vitest";
import { isFilled, sortRoles, summarizeRoles } from "./summary";
import type { Subteam, TeamRole } from "./types";

let seq = 0;
function role(overrides: Partial<TeamRole> = {}): TeamRole {
  seq += 1;
  return {
    id: `r-${seq}`,
    title: `Role ${seq}`,
    subteam: "mechanical" as Subteam,
    holderUserId: null,
    holderName: null,
    isLead: false,
    responsibilities: null,
    notes: null,
    seasonYear: 2026,
    ...overrides,
  };
}

describe("isFilled", () => {
  it("treats blank/whitespace holder as unfilled", () => {
    expect(isFilled(role({ holderName: "Riya" }))).toBe(true);
    expect(isFilled(role({ holderName: "  " }))).toBe(false);
    expect(isFilled(role({ holderName: null }))).toBe(false);
  });
});

describe("summarizeRoles", () => {
  it("is all-zero for none", () => {
    const s = summarizeRoles([]);
    expect(s.total).toBe(0);
    expect(s.coverage).toBe(0);
    expect(s.openRoles).toEqual([]);
  });

  it("computes coverage and lead staffing", () => {
    const s = summarizeRoles([
      role({ holderName: "A", isLead: true }),
      role({ holderName: "B" }),
      role({ holderName: null, isLead: true }),
      role({ holderName: null }),
    ]);
    expect(s.total).toBe(4);
    expect(s.filled).toBe(2);
    expect(s.unfilled).toBe(2);
    expect(s.coverage).toBe(0.5);
    expect(s.leadsTotal).toBe(2);
    expect(s.leadsFilled).toBe(1);
  });

  it("rolls up filled/total per subteam", () => {
    const s = summarizeRoles([
      role({ subteam: "electrical", holderName: "A" }),
      role({ subteam: "electrical", holderName: null }),
      role({ subteam: "programming", holderName: "C" }),
    ]);
    const elec = s.bySubteam.find((x) => x.subteam === "electrical");
    expect(elec).toEqual({ subteam: "electrical", total: 2, filled: 1 });
    // mechanical (order 0) before electrical (1) before programming (2)
    expect(s.bySubteam.map((x) => x.subteam)).toEqual(["electrical", "programming"]);
  });

  it("lists open roles with unfilled leads first", () => {
    const s = summarizeRoles([
      role({ title: "Member", holderName: null, isLead: false, subteam: "media" }),
      role({ title: "Lead", holderName: null, isLead: true, subteam: "safety" }),
      role({ title: "Filled", holderName: "X", isLead: true }),
    ]);
    expect(s.openRoles.map((r) => r.title)).toEqual(["Lead", "Member"]);
  });
});

describe("sortRoles", () => {
  it("orders leads first, then by subteam", () => {
    const sorted = sortRoles([
      role({ title: "b", isLead: false, subteam: "mechanical" }),
      role({ title: "a", isLead: true, subteam: "programming" }),
    ]);
    expect(sorted[0]?.title).toBe("a");
  });
});
