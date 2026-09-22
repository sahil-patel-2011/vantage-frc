import { describe, expect, it } from "vitest";
import {
  describePublish,
  generateRotation,
  overlayScheduleOnRotation,
  planToCsv,
  publishableAssignments,
  rotationConstraintsFromSlots,
  scheduleSlotsFromQuals,
  summarizePlan,
} from ".";

const scouts = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => ({ id, name: id.toUpperCase(), active: true }));
const STATIONS = ["Red 1", "Red 2", "Red 3", "Blue 1", "Blue 2", "Blue 3"];
const US = "frc6925";

const quals = scheduleSlotsFromQuals([
  { matchKey: "e_qm1", matchNumber: 1, redAlliance: { teamKeys: [US, "frc2", "frc3"] }, blueAlliance: { teamKeys: ["frc4", "frc5", "frc6"] } },
  { matchKey: "e_qm2", matchNumber: 2, redAlliance: { teamKeys: ["frc7", "frc8", "frc9"] }, blueAlliance: { teamKeys: ["frc10", "frc11", "frc12"] } },
  { matchKey: "e_qm3", matchNumber: 3, redAlliance: { teamKeys: ["frc13", "frc14", "frc15"] }, blueAlliance: { teamKeys: ["frc16", US, "frc18"] } },
]);

describe("rotationConstraintsFromSlots", () => {
  it("backs up partners and opponents only in our matches, never our own robot", () => {
    const { backupStations, unavailable } = rotationConstraintsFromSlots({
      slots: quals,
      stations: STATIONS,
      ourTeamKey: US,
      backups: true,
    });
    expect(backupStations.get(1)).toEqual(["Red 2", "Red 3", "Blue 1", "Blue 2", "Blue 3"]);
    expect(backupStations.has(2)).toBe(false);
    expect(backupStations.get(3)).toEqual(["Red 1", "Red 2", "Red 3", "Blue 1", "Blue 3"]);
    expect(unavailable.size).toBe(0);
  });

  it("adds nothing when backups are off or the team number is unknown, and maps blocked scouts to plan indexes", () => {
    const off = rotationConstraintsFromSlots({ slots: quals, stations: STATIONS, ourTeamKey: US, backups: false });
    expect(off.backupStations.size).toBe(0);
    const noTeam = rotationConstraintsFromSlots({ slots: quals, stations: STATIONS, ourTeamKey: null, backups: true });
    expect(noTeam.backupStations.size).toBe(0);
    const blocked = rotationConstraintsFromSlots({
      slots: quals,
      stations: STATIONS,
      ourTeamKey: US,
      backups: false,
      blockedScouts: (matchKey) => (matchKey === "e_qm3" ? ["a"] : []),
    });
    expect([...blocked.unavailable.entries()]).toEqual([[3, new Set(["a"])]]);
  });
});

describe("generateRotation with constraints", () => {
  it("never schedules an unavailable scout for that match", () => {
    const rotation = generateRotation({
      scouts,
      matchCount: 3,
      stations: STATIONS,
      maxConsecutiveMatches: 3,
      unavailable: new Map([[1, new Set(["a", "b"])]]),
    });
    const inMatch1 = rotation.filter((row) => row.match === 1).map((row) => row.scoutId);
    expect(inMatch1).not.toContain("a");
    expect(inMatch1).not.toContain("b");
    expect(inMatch1).toHaveLength(6);
  });

  it("adds backups from scouts not working that match, one person per robot", () => {
    const { backupStations } = rotationConstraintsFromSlots({ slots: quals, stations: STATIONS, ourTeamKey: US, backups: true });
    const rotation = generateRotation({ scouts, matchCount: 3, stations: STATIONS, maxConsecutiveMatches: 3, backupStations });
    const match1 = rotation.filter((row) => row.match === 1);
    const primaries = match1.filter((row) => row.role !== "backup");
    const backups = match1.filter((row) => row.role === "backup");
    expect(primaries).toHaveLength(6);
    // Nine scouts: six working, three left for five robots — fill what we can, never double up.
    expect(backups).toHaveLength(3);
    const people = match1.map((row) => row.scoutId);
    expect(new Set(people).size).toBe(people.length);
    expect(rotation.filter((row) => row.match === 2 && row.role === "backup")).toEqual([]);
  });

  it("leaves a plan without constraints exactly as before", () => {
    const plain = generateRotation({ scouts, matchCount: 3, stations: STATIONS, maxConsecutiveMatches: 2 });
    expect(plain.every((row) => row.role === undefined)).toBe(true);
  });
});

describe("backups downstream", () => {
  const { backupStations } = rotationConstraintsFromSlots({ slots: quals, stations: STATIONS, ourTeamKey: US, backups: true });
  const rotation = overlayScheduleOnRotation(
    generateRotation({ scouts, matchCount: 3, stations: STATIONS, maxConsecutiveMatches: 3, backupStations }),
    quals,
  );

  it("does not count backups as shifts or streaks", () => {
    const summary = summarizePlan({ scouts, matchCount: 3, stations: STATIONS, assignments: rotation });
    expect(summary.totalShifts).toBe(18);
    expect(summary.backupShifts).toBe(6);
  });

  it("marks backup rows in the CSV and publishes them with the backup role", () => {
    expect(planToCsv({ label: "Q", assignments: rotation })).toContain("(backup)");
    const backupRow = rotation.find((row) => row.role === "backup")!;
    const preview = publishableAssignments([backupRow], [{ id: backupRow.scoutId, userId: "u-backup" }]);
    expect(preview.rows[0]).toMatchObject({ userId: "u-backup", role: "backup", teamKey: backupRow.teamKey });
  });

  it("explains shifts refused for a clash", () => {
    expect(describePublish({ rows: [{} as never], skippedNoMember: 0, skippedNoMatch: 0, skippedConflict: 2 })).toBe(
      "1 shift published; skipped 2 that clashed with drive team or another robot in the same match.",
    );
    expect(describePublish({ rows: [], skippedNoMember: 0, skippedNoMatch: 0, skippedConflict: 1 })).toBe(
      "Nothing to publish — every shift clashed with drive team or another robot in the same match.",
    );
  });
});
