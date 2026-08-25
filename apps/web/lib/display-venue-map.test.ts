import { describe, expect, it } from "vitest";
import { buildVenueMap, venueShapeLabel, type VenueMapShapeInput } from "./display";

/**
 * FIXTURE geometry, hand-built from the documented frc.nexus `/map` shape.
 * Not a captured production response — no coordinate here is real venue data.
 */
const shape = (over: Partial<VenueMapShapeInput> = {}): VenueMapShapeInput => ({
  id: null,
  label: null,
  teamNumber: null,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  ...over,
});

describe("buildVenueMap", () => {
  it("returns null when Nexus posted no geometry — the planner falls back", () => {
    expect(buildVenueMap({ map: null })).toBeNull();
    expect(buildVenueMap({ map: { width: 100, height: 80, pits: [], areas: [] } })).toBeNull();
  });

  it("marks only the pit Nexus attributed to our team", () => {
    const view = buildVenueMap({
      map: {
        width: 100,
        height: 80,
        pits: [shape({ teamNumber: "254", x: 5 }), shape({ teamNumber: "1678", x: 25 })],
        areas: [],
      },
      teamNumber: 1678,
    });
    expect(view?.ourShape?.teamNumber).toBe("1678");
    expect(view?.shapes.filter((s) => s.ours)).toHaveLength(1);
  });

  it("never marks a pit when our team is not placed on the map", () => {
    const view = buildVenueMap({
      map: { width: 100, height: 80, pits: [shape({ teamNumber: "254" })], areas: [] },
      teamNumber: 9999,
    });
    expect(view?.ourShape).toBeNull();
  });

  it("highlights the pits of teams that posted a parts request", () => {
    const view = buildVenueMap({
      map: {
        width: 100,
        height: 80,
        pits: [shape({ teamNumber: "254" }), shape({ teamNumber: "118", x: 20 })],
        areas: [],
      },
      teamNumber: "254",
      requesterTeams: ["118", null, "  "],
    });
    expect(view?.requesterCount).toBe(1);
    expect(view?.shapes.find((s) => s.teamNumber === "118")?.requester).toBe(true);
  });

  it("falls back to the bounds of the shapes when the venue posted no canvas size", () => {
    const view = buildVenueMap({
      map: { width: null, height: null, pits: [shape({ x: 10, y: 20, width: 30, height: 40 })], areas: [] },
    });
    // 0..40 wide and 0..60 tall, padded by the margin on both sides.
    expect(view?.viewBox).toBe("-8 -8 56 76");
  });

  it("keeps areas in the drawing but never treats one as our pit", () => {
    const view = buildVenueMap({
      map: {
        width: 100,
        height: 80,
        pits: [],
        areas: [shape({ label: "Field", width: 50, height: 30 })],
      },
      teamNumber: "254",
    });
    expect(view?.shapes).toHaveLength(1);
    expect(view?.shapes[0].kind).toBe("area");
    expect(view?.ourShape).toBeNull();
  });
});

describe("venueShapeLabel", () => {
  it("prefers the team number, then the Nexus label, then nothing", () => {
    const base = { kind: "pit" as const, ours: false, requester: false };
    expect(venueShapeLabel({ ...shape({ teamNumber: "254", label: "Pit B12" }), ...base })).toBe("254");
    expect(venueShapeLabel({ ...shape({ label: "Machine shop" }), ...base })).toBe("Machine shop");
    expect(venueShapeLabel({ ...shape(), ...base })).toBe("");
  });
});
