import { describe, expect, it } from "vitest";
import { detectMissedAssignments, isBackupRole, summarizeMissed } from "./assignment-accountability";

const Q = (n: number) => `2026casj_qm${n}`;

describe("isBackupRole", () => {
  it("reads only the exact word backup as a backup", () => {
    expect(isBackupRole("backup")).toBe(true);
    expect(isBackupRole(" Backup ")).toBe(true);
    for (const role of ["primary", "Red 2", "primary-fatigue-cap", null, undefined, ""]) {
      expect(isBackupRole(role)).toBe(false);
    }
  });
});

describe("detectMissedAssignments", () => {
  const assignments = [
    { matchKey: Q(1), teamKey: "frc254", userId: "ada", name: "Ada", role: "Red 1" },
    { matchKey: Q(1), teamKey: "frc1678", userId: "bo", name: "Bo", role: "primary" },
    { matchKey: Q(2), teamKey: "frc118", userId: "ada", name: "Ada", role: "primary" },
    { matchKey: Q(3), teamKey: "frc971", userId: "cy", name: "Cy", role: "primary" },
  ];

  it("lists played-match assignments with no entry from that scout, in schedule order", () => {
    const missed = detectMissedAssignments({
      assignments,
      entries: [
        { matchKey: Q(1), teamKey: "frc254", scoutUserId: "ada" },
        // Someone else scouted Bo's robot — the data exists, Bo's duty still was not done.
        { matchKey: Q(1), teamKey: "frc1678", scoutUserId: "zed" },
      ],
      playedMatchKeys: [Q(1), Q(2)],
    });
    expect(missed).toEqual([
      { matchKey: Q(1), teamKey: "frc1678", userId: "bo", name: "Bo", role: "primary", robotScouted: true },
      { matchKey: Q(2), teamKey: "frc118", userId: "ada", name: "Ada", role: "primary", robotScouted: false },
    ]);
  });

  it("ignores matches without posted results", () => {
    expect(detectMissedAssignments({ assignments, entries: [], playedMatchKeys: [] })).toEqual([]);
  });

  it("does not hold a backup to account when the primary scouted", () => {
    const rows = [
      { matchKey: Q(1), teamKey: "frc254", userId: "p", name: "Primary", role: "primary" },
      { matchKey: Q(1), teamKey: "frc254", userId: "b", name: "Backup", role: "backup" },
    ];
    expect(
      detectMissedAssignments({
        assignments: rows,
        entries: [{ matchKey: Q(1), teamKey: "frc254", scoutUserId: "p" }],
        playedMatchKeys: [Q(1)],
      }),
    ).toEqual([]);
    const both = detectMissedAssignments({ assignments: rows, entries: [], playedMatchKeys: [Q(1)] });
    expect(both.map((row) => [row.name, row.role])).toEqual([
      ["Primary", "primary"],
      ["Backup", "backup"],
    ]);
  });

  it("clears a backup who stepped in, and still names the primary who did not", () => {
    const missed = detectMissedAssignments({
      assignments: [
        { matchKey: Q(1), teamKey: "frc254", userId: "p", name: "Primary", role: "primary" },
        { matchKey: Q(1), teamKey: "frc254", userId: "b", name: "Backup", role: "backup" },
      ],
      entries: [{ matchKey: Q(1), teamKey: "frc254", scoutUserId: "b" }],
      playedMatchKeys: [Q(1)],
    });
    expect(missed).toEqual([
      { matchKey: Q(1), teamKey: "frc254", userId: "p", name: "Primary", role: "primary", robotScouted: true },
    ]);
  });
});

describe("summarizeMissed", () => {
  it("counts uncovered robots and who missed most", () => {
    const summary = summarizeMissed([
      { matchKey: Q(1), teamKey: "frc1", userId: "a", name: "Ada", role: "primary", robotScouted: false },
      { matchKey: Q(2), teamKey: "frc2", userId: "a", name: "Ada", role: "primary", robotScouted: true },
      { matchKey: Q(2), teamKey: "frc3", userId: "b", name: "Bo", role: "primary", robotScouted: false },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.uncovered).toBe(2);
    expect(summary.byScout[0]).toEqual({ userId: "a", name: "Ada", count: 2 });
  });
});
