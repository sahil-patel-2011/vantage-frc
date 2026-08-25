import { describe, expect, it } from "vitest";
import { matchNameBacklog, matchPersonName, normalizeName } from "./match-names";

const ROSTER = [
  { userId: "u1", name: "Sam Rodriguez" },
  { userId: "u2", name: "Alex Chen" },
  { userId: "u3", name: "Priya Nair" },
];

describe("normalizeName", () => {
  it("folds case, punctuation, accents and spacing", () => {
    expect(normalizeName("  José  O'Brien-Smith ")).toBe("jose o brien smith");
    expect(normalizeName("RODRIGUEZ, SAM")).toBe("rodriguez sam");
  });
});

describe("matchPersonName", () => {
  it("auto-assigns only a single exact match", () => {
    const result = matchPersonName("sam rodriguez", ROSTER);
    expect(result.resolution).toBe("auto");
    expect(result.autoUserId).toBe("u1");
    expect(result.candidates[0].confidence).toBe("exact");
  });

  it("treats a reordered exact name as exact", () => {
    const result = matchPersonName("Rodriguez, Sam", ROSTER);
    expect(result.resolution).toBe("auto");
    expect(result.autoUserId).toBe("u1");
  });

  it("never merges two people who share an exact name", () => {
    const roster = [...ROSTER, { userId: "u4", name: "Sam Rodriguez" }];
    const result = matchPersonName("Sam Rodriguez", roster);
    expect(result.resolution).toBe("ambiguous");
    expect(result.autoUserId).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });

  it("never auto-assigns below an exact match", () => {
    const result = matchPersonName("Sam R.", ROSTER);
    expect(result.resolution).toBe("confirm");
    expect(result.autoUserId).toBeNull();
    expect(result.candidates[0]).toMatchObject({ userId: "u1", confidence: "strong" });
  });

  it("matches a leading initial plus a full surname", () => {
    const result = matchPersonName("S Rodriguez", ROSTER);
    expect(result.autoUserId).toBeNull();
    expect(result.candidates[0]).toMatchObject({ userId: "u1", confidence: "strong" });
  });

  it("asks rather than guessing when two strong candidates collide", () => {
    const roster = [...ROSTER, { userId: "u5", name: "Sam Roberts" }];
    const result = matchPersonName("Sam R", roster);
    expect(result.resolution).toBe("ambiguous");
    expect(result.autoUserId).toBeNull();
    expect(result.candidates.map((entry) => entry.userId).sort()).toEqual(["u1", "u5"]);
  });

  it("keeps a first-name-only entry weak and unassigned", () => {
    const result = matchPersonName("Priya", ROSTER);
    expect(result.resolution).toBe("confirm");
    expect(result.autoUserId).toBeNull();
    expect(result.candidates[0].confidence).toBe("weak");
  });

  it("returns none for a guest who is not on the roster", () => {
    const result = matchPersonName("Mrs. Whitfield", ROSTER);
    expect(result.resolution).toBe("none");
    expect(result.candidates).toEqual([]);
    expect(result.autoUserId).toBeNull();
  });

  it("returns none for an unusable name", () => {
    const result = matchPersonName("   ", ROSTER);
    expect(result.resolution).toBe("none");
    expect(result.autoUserId).toBeNull();
  });

  it("surfaces a shared surname as weak, not as a match", () => {
    const roster = [...ROSTER, { userId: "u6", name: "Dana Nair" }];
    const result = matchPersonName("Kiran Nair", roster);
    expect(result.autoUserId).toBeNull();
    expect(result.candidates.every((entry) => entry.confidence === "weak")).toBe(true);
  });
});

describe("matchNameBacklog", () => {
  it("puts one-click exact matches first and unresolvable names last", () => {
    const backlog = matchNameBacklog(
      [
        { personName: "Mrs. Whitfield", entryCount: 9 },
        { personName: "Sam R.", entryCount: 4 },
        { personName: "Alex Chen", entryCount: 2 },
      ],
      ROSTER,
    );
    expect(backlog.map((row) => row.resolution)).toEqual(["auto", "confirm", "none"]);
    expect(backlog[0].entryCount).toBe(2);
  });
});
