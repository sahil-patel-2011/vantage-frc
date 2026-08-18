import { describe, expect, it } from "vitest";
import {
  allianceTeamKeys,
  applyBumperCue,
  bumperBanner,
  bumperColorForTeam,
  bumperItemLabel,
  buildDefaultItems,
  parseMatchLabel,
  sanitizeChecklistItems,
} from ".";

describe("match checklist bumper cue (CD pit color)", () => {
  it("reads red/blue only from TBA alliance lists — never guesses", () => {
    expect(bumperColorForTeam(254, ["frc118", "frc254", "frc1114"], ["frc33", "frc67", "frc2056"])).toBe("red");
    expect(bumperColorForTeam(33, ["frc118", "frc254", "frc1114"], ["frc33", "frc67", "frc2056"])).toBe("blue");
    expect(bumperColorForTeam(9999, ["frc118"], ["frc33"])).toBeNull();
    expect(bumperColorForTeam(254, ["frc254"], ["frc254"])).toBeNull();
    expect(bumperColorForTeam(null, ["frc254"], ["frc33"])).toBeNull();
    expect(bumperBanner(null)).toBe("Bumper color unknown");
    expect(bumperBanner("red")).toBe("RED bumpers");
    expect(bumperItemLabel("blue")).toBe("BLUE bumpers secured");
  });

  it("parses pit labels and TBA match keys without inventing a match", () => {
    expect(parseMatchLabel("Qualification 12")).toEqual({ compLevel: "qm", matchNumber: 12, matchKey: null });
    expect(parseMatchLabel("Qual 12")).toEqual({ compLevel: "qm", matchNumber: 12, matchKey: null });
    expect(parseMatchLabel("qm12")).toEqual({ compLevel: "qm", matchNumber: 12, matchKey: null });
    expect(parseMatchLabel("2026miket_qm12")).toEqual({
      compLevel: "qm",
      matchNumber: 12,
      matchKey: "2026miket_qm12",
    });
    expect(parseMatchLabel("not a match")).toBeNull();
    expect(parseMatchLabel("")).toBeNull();
  });

  it("overlays the bumper item label only when color is known", () => {
    const items = applyBumperCue(buildDefaultItems(), "red");
    expect(items.find((item) => item.key === "bumper")?.label).toBe("RED bumpers secured");
    expect(applyBumperCue(buildDefaultItems(), null).find((item) => item.key === "bumper")?.label).toBe(
      "Bumpers secured",
    );
  });

  it("adds SB50 + DS laptop checks on new runs without reopening older checklists", () => {
    const fresh = buildDefaultItems();
    expect(fresh.map((item) => item.key)).toEqual([
      "bumper",
      "battery",
      "tether",
      "code",
      "sb50",
      "ds_power",
      "ds_ethernet",
      "ds_estop",
      "lenses",
      "bolts",
      "kraken_screws",
      "anderson_lock",
      "controller_lock",
    ]);
    expect(fresh.find((item) => item.key === "lenses")?.label).toMatch(/fuzz/i);
    expect(fresh.find((item) => item.key === "ds_estop")?.label).toMatch(/Game Bar/i);
    expect(fresh.find((item) => item.key === "kraken_screws")?.label).toMatch(/1\.2/);
    expect(fresh.find((item) => item.key === "kraken_screws")?.label).toMatch(/0\.9/);
    expect(fresh.find((item) => item.key === "anderson_lock")?.label).toMatch(/Anderson/i);
    expect(fresh.find((item) => item.key === "controller_lock")?.label).toMatch(/controller/i);

    const withDs = sanitizeChecklistItems([
      { key: "bumper", label: "Bumpers secured", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
      { key: "battery", label: "Battery seated & strap (not zip ties)", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
      { key: "tether", label: "Tether / e-stop clipped", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
      { key: "code", label: "Code deployed & radio linked", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
      { key: "sb50", label: "SB50 locked (zip tie / clip)", done: true, checkedAt: "2026-03-21T15:01:00.000Z" },
      { key: "ds_power", label: "DS laptop charging (never sleep)", done: true, checkedAt: "2026-03-21T15:01:00.000Z" },
      { key: "ds_ethernet", label: "Ethernet seated + strain-relieved", done: true, checkedAt: "2026-03-21T15:01:00.000Z" },
      { key: "ds_estop", label: "Spacebar E-Stop works (Game Bar off)", done: true, checkedAt: "2026-03-21T15:01:00.000Z" },
    ]);
    expect(withDs.map((item) => item.key)).not.toContain("lenses");
    expect(withDs.map((item) => item.key)).not.toContain("kraken_screws");
    expect(withDs.map((item) => item.key)).not.toContain("anderson_lock");
    expect(withDs.every((item) => item.done)).toBe(true);

    const legacy = sanitizeChecklistItems([
      { key: "bumper", label: "Bumpers secured", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
      { key: "battery", label: "Battery charged & seated", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
      { key: "tether", label: "Tether / e-stop clipped", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
      { key: "code", label: "Code deployed & radio linked", done: true, checkedAt: "2026-03-21T15:00:00.000Z" },
    ]);
    expect(legacy.map((item) => item.key)).toEqual(["bumper", "battery", "tether", "code"]);
    expect(legacy.every((item) => item.done)).toBe(true);
    expect(applyBumperCue(legacy, null).find((item) => item.key === "battery")?.label).toMatch(/strap/i);

    const withSb50 = sanitizeChecklistItems([
      ...legacy,
      { key: "sb50", label: "SB50 locked (zip tie / clip)", done: true, checkedAt: "2026-03-21T15:01:00.000Z" },
    ]);
    expect(withSb50.map((item) => item.key)).toEqual(["bumper", "battery", "tether", "code", "sb50"]);
    expect(withSb50.every((item) => item.done)).toBe(true);
  });

  it("reads teamKeys from TBA alliance JSON and skips malformed rows", () => {
    expect(allianceTeamKeys({ teamKeys: ["frc254", "frc118"] })).toEqual(["frc254", "frc118"]);
    expect(allianceTeamKeys({ teamKeys: [254, "frc118"] })).toEqual(["frc118"]);
    expect(allianceTeamKeys(null)).toEqual([]);
    expect(allianceTeamKeys("red")).toEqual([]);
  });
});
