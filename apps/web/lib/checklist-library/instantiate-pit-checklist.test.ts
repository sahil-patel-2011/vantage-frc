import { describe, expect, it } from "vitest";
import {
  canInstantiatePitChecklist,
  instantiatePitChecklistFromSop,
  mapSopItemToPitKey,
  mapSopItemsToPitChecklist,
  pitChecklistHref,
  pitRunItemsJson,
  previewPitChecklistInstantiation,
} from "./instantiate-pit-checklist";

describe("mapSopItemToPitKey", () => {
  it("keeps a canonical pit key as-is", () => {
    expect(mapSopItemToPitKey({ key: "sb50", label: "Lock the Anderson" })).toBe("sb50");
    expect(mapSopItemToPitKey({ key: "kraken_screws", label: "Torque" })).toBe("kraken_screws");
  });

  it("maps aliases and SOP wording onto the pit cue, not a second name", () => {
    expect(mapSopItemToPitKey({ key: "hang-bumpers", label: "Hang bumpers" })).toBe("bumper");
    expect(mapSopItemToPitKey({ key: "custom", label: "Battery seated & strap" })).toBe("battery");
    expect(mapSopItemToPitKey({ key: "custom", label: "SB50 locked (zip tie)" })).toBe("sb50");
    expect(mapSopItemToPitKey({ key: "custom", label: "Kraken power screws 1.2 N·m" })).toBe("kraken_screws");
    expect(mapSopItemToPitKey({ key: "custom", label: "Tape accidental controller buttons" })).toBe(
      "controller_lock",
    );
  });

  it("does not guess a pit cue from unrelated SOP steps", () => {
    expect(mapSopItemToPitKey({ key: "totes", label: "Totes loaded" })).toBeNull();
    expect(mapSopItemToPitKey({ key: "cart", label: "Pack the cart" })).toBeNull();
  });
});

describe("mapSopItemsToPitChecklist", () => {
  it("projects SOP order onto pit items and reports leftovers", () => {
    const { items, unmapped } = mapSopItemsToPitChecklist([
      { key: "bumpers-on", label: "Bumpers on" },
      { key: "tote", label: "Totes loaded" },
      { key: "battery", label: "Battery charged" },
    ]);
    expect(items.map((item) => item.key)).toEqual(["bumper", "battery"]);
    expect(items[0]).toMatchObject({
      label: "Bumpers on",
      done: false,
      checkedAt: null,
      sourceSopKey: "bumpers-on",
    });
    expect(unmapped).toEqual([{ key: "tote", label: "Totes loaded" }]);
  });

  it("does not invent a second bumper row when two SOP lines map to the same cue", () => {
    const { items, unmapped } = mapSopItemsToPitChecklist([
      { key: "bumper", label: "RED bumpers secured" },
      { key: "hang", label: "Hang bumpers" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.sourceSopKey).toBe("bumper");
    expect(unmapped).toEqual([{ key: "hang", label: "Hang bumpers" }]);
  });

  it("never fills default pit cues that are not in the SOP", () => {
    const { items } = mapSopItemsToPitChecklist([{ key: "battery", label: "Battery seated" }]);
    expect(items.map((item) => item.key)).toEqual(["battery"]);
  });
});

describe("instantiatePitChecklistFromSop", () => {
  const template = {
    id: "tmpl-1",
    name: "Pre-queue SOP",
    items: [
      { key: "bumper", label: "Bumpers secured" },
      { key: "tote", label: "Totes loaded" },
    ],
  };

  it("builds a pit payload from stored SOP without inventing extras", () => {
    const result = instantiatePitChecklistFromSop(template, { matchLabel: "  Qual 12  " });
    expect(result.source).toBe("checklist-library");
    expect(result.templateId).toBe("tmpl-1");
    expect(result.templateName).toBe("Pre-queue SOP");
    expect(result.matchLabel).toBe("Qual 12");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.key).toBe("bumper");
    expect(result.unmapped).toEqual([{ key: "tote", label: "Totes loaded" }]);
  });

  it("refuses a blank match label", () => {
    expect(() => instantiatePitChecklistFromSop(template, { matchLabel: "   " })).toThrow(/matchLabel/i);
  });

  it("refuses an SOP that cannot become a pit checklist", () => {
    expect(() =>
      instantiatePitChecklistFromSop(
        { id: "t", name: "Load-in", items: [{ key: "tote", label: "Totes loaded" }] },
        { matchLabel: "Week 3" },
      ),
    ).toThrow(/no pit\/match cues/i);
  });

  it("serializes items match-checklist already stores, plus SOP provenance", () => {
    const result = instantiatePitChecklistFromSop(template, { matchLabel: "Qual 12" });
    expect(pitRunItemsJson(result)).toEqual([
      {
        key: "bumper",
        label: "Bumpers secured",
        done: false,
        checkedAt: null,
        sourceSopKey: "bumper",
        sourceTemplateId: "tmpl-1",
        sourceTemplateName: "Pre-queue SOP",
      },
    ]);
  });
});

describe("preview helpers", () => {
  it("tells the library UI whether a template can open on pit", () => {
    expect(canInstantiatePitChecklist([{ key: "tote", label: "Totes" }])).toBe(false);
    expect(canInstantiatePitChecklist([{ key: "sb50", label: "SB50 locked" }])).toBe(true);
    expect(previewPitChecklistInstantiation([{ key: "code", label: "Code deployed" }])).toEqual({
      mappedCount: 1,
      unmapped: [],
    });
  });

  it("points at the Event Day pit tab, not a second library surface", () => {
    expect(pitChecklistHref("org-1")).toBe("/competition?tab=match-checklist&orgId=org-1");
    expect(pitChecklistHref(null)).toBe("/competition?tab=match-checklist");
  });
});
