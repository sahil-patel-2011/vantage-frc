import { describe, expect, it } from "vitest";
import {
  allianceTeamKeys,
  applyBumperCue,
  bumperBanner,
  bumperColorForTeam,
  bumperItemLabel,
  buildDefaultItems,
  itemsFromSopTemplate,
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
      "ds_shelf",
      "lenses",
      "bolts",
      "kraken_screws",
      "anderson_lock",
      "controller_lock",
      "ds_usb",
    ]);
    expect(fresh.find((item) => item.key === "lenses")?.label).toMatch(/fuzz/i);
    expect(fresh.find((item) => item.key === "ds_estop")?.label).toMatch(/Game Bar/i);
    expect(fresh.find((item) => item.key === "ds_shelf")?.label).toMatch(/hook-and-loop/i);
    expect(fresh.find((item) => item.key === "kraken_screws")?.label).toMatch(/1\.2/);
    expect(fresh.find((item) => item.key === "kraken_screws")?.label).toMatch(/0\.9/);
    expect(fresh.find((item) => item.key === "anderson_lock")?.label).toMatch(/Anderson/i);
    expect(fresh.find((item) => item.key === "controller_lock")?.label).toMatch(/controller/i);
    expect(fresh.find((item) => item.key === "ds_usb")?.label).toMatch(/USB/i);
    expect(fresh.find((item) => item.key === "ds_usb")?.label).toMatch(/strain/i);

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
    expect(withDs.map((item) => item.key)).not.toContain("ds_shelf");
    expect(withDs.map((item) => item.key)).not.toContain("kraken_screws");
    expect(withDs.map((item) => item.key)).not.toContain("anderson_lock");
    expect(withDs.map((item) => item.key)).not.toContain("ds_usb");
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

  it("keeps unmapped SOP keys as custom items instead of dropping them", () => {
    const stored = sanitizeChecklistItems([
      { key: "bumper", label: "Bumpers on", done: true, checkedAt: "2026-03-21T15:00:00.000Z", sourceSopKey: "bumpers-on" },
      { key: "tote", label: "Totes loaded", done: false, checkedAt: null, sourceSopKey: "tote" },
    ]);
    expect(stored.map((item) => item.key)).toEqual(["bumper", "tote"]);
    expect(stored.find((item) => item.key === "tote")).toMatchObject({
      label: "Totes loaded",
      done: false,
      sourceSopKey: "tote",
    });
    expect(stored.map((item) => item.key)).not.toContain("battery");
    expect(JSON.stringify(stored).toLowerCase()).not.toContain("demo");
  });

  it("projects SOP items through instantiatePitChecklistFromSop and keeps leftovers custom", () => {
    const items = itemsFromSopTemplate(
      {
        id: "tmpl-1",
        name: "Pre-queue SOP",
        items: [
          { key: "bumper", label: "Bumpers on" },
          { key: "tote", label: "Totes loaded" },
          { key: "battery", label: "Battery seated" },
        ],
      },
      "  Qual 12  ",
    );
    expect(items.map((item) => item.key)).toEqual(["bumper", "battery", "tote"]);
    expect(items.find((item) => item.key === "tote")).toMatchObject({
      label: "Totes loaded",
      done: false,
      sourceSopKey: "tote",
      sourceTemplateId: "tmpl-1",
      sourceTemplateName: "Pre-queue SOP",
    });
    expect(items.some((item) => item.key === "sb50")).toBe(false);
    expect(items.every((item) => !/demo/i.test(`${item.key} ${item.label}`))).toBe(true);
  });

  it("keeps every labeled SOP step when none map to a pit cue — never DEMO defaults", () => {
    const items = itemsFromSopTemplate(
      {
        id: "tmpl-2",
        name: "Load-in",
        items: [
          { key: "tote", label: "Totes loaded" },
          { key: "cart", label: "Pack the cart" },
        ],
      },
      "Week 3",
    );
    expect(items.map((item) => item.key)).toEqual(["tote", "cart"]);
    expect(items.map((item) => item.label)).toEqual(["Totes loaded", "Pack the cart"]);
    expect(items.every((item) => !/demo/i.test(item.label))).toBe(true);
  });

  it("refuses a blank match label when instantiating from SOP", () => {
    expect(() =>
      itemsFromSopTemplate(
        { id: "tmpl-1", name: "Pre-queue SOP", items: [{ key: "bumper", label: "Bumpers on" }] },
        "   ",
      ),
    ).toThrow(/matchLabel/i);
  });

  it("reads teamKeys from TBA alliance JSON and skips malformed rows", () => {
    expect(allianceTeamKeys({ teamKeys: ["frc254", "frc118"] })).toEqual(["frc254", "frc118"]);
    expect(allianceTeamKeys({ teamKeys: [254, "frc118"] })).toEqual(["frc118"]);
    expect(allianceTeamKeys(null)).toEqual([]);
    expect(allianceTeamKeys("red")).toEqual([]);
  });
});
