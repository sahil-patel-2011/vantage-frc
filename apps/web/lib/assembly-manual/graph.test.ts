import { describe, expect, it } from "vitest";
import { box, facts, instance, mate, part, wheelBeforeScrewsAssembly } from "./fixtures";
import { buildAssemblyGraph, classifyFastener, fastenerTargets } from "./graph";

describe("classifyFastener", () => {
  it("believes the part name first", () => {
    const verdict = classifyFastener(
      instance({ id: "s", name: "10-32 x 1.00 SHCS" }),
      part({ key: "s", name: "10-32 x 1.00 SHCS" }),
    );
    expect(verdict.isFastener).toBe(true);
    expect(verdict.basis).toBe("name");
  });

  it("recognises a slender round shank with no helpful name", () => {
    const verdict = classifyFastener(
      instance({ id: "x", name: "Part 7", worldBoxMm: box(0, 30, 0, 5, 0, 5), massKg: 0.01 }),
      part({ key: "x", name: "Part 7", bboxMm: box(0, 30, 0, 5, 0, 5), massKg: 0.01 }),
    );
    expect(verdict.isFastener).toBe(true);
    expect(verdict.basis).toBe("geometry");
  });

  it("does not call a chunky part hardware", () => {
    const verdict = classifyFastener(
      instance({ id: "x", name: "Bearing block", worldBoxMm: box(0, 40, 0, 40, 0, 40), massKg: 0.5 }),
      part({ key: "x", name: "Bearing block", bboxMm: box(0, 40, 0, 40, 0, 40), massKg: 0.5 }),
    );
    expect(verdict.isFastener).toBe(false);
  });

  it("does not call a long tube a screw, however slender", () => {
    // 1x1 box tube, 900 mm long: round-ish it is not, and it is far too long.
    const verdict = classifyFastener(
      instance({ id: "t", name: "Tube", worldBoxMm: box(0, 900, 0, 25.4, 0, 25.4), massKg: 0.6 }),
      part({ key: "t", name: "Tube", bboxMm: box(0, 900, 0, 25.4, 0, 25.4), massKg: 0.6 }),
    );
    expect(verdict.isFastener).toBe(false);
  });

  it("refuses to guess with no name match and no box", () => {
    const verdict = classifyFastener(instance({ id: "x", name: "Part 3" }), null);
    expect(verdict.isFastener).toBe(false);
    expect(verdict.basis).toBe("none");
  });
});

describe("buildAssemblyGraph", () => {
  it("links every instance a mate touches, and keeps FASTENED separate", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    expect(graph.adjacency.get("plate")).toEqual(new Set(["frame", "motor", "wheel", "screw"]));
    // The wheel turns on the plate, so it is NOT part of the same rigid clump.
    expect(graph.fastened.get("plate")).toEqual(new Set(["frame", "motor", "screw"]));
  });

  it("finds the rigid clump as one sub-assembly and leaves the wheel out of it", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    expect(graph.subAssemblies).toHaveLength(1);
    const members = graph.subAssemblies[0]!.instanceIds;
    expect(members).toContain("plate");
    expect(members).toContain("motor");
    expect(members).toContain("frame");
    expect(members).not.toContain("wheel");
  });

  it("does not call a pile of loose hardware a sub-assembly", () => {
    const boltsOnly = facts({
      parts: [part({ key: "b1", name: "8-32 screw" }), part({ key: "b2", name: "8-32 nut" })],
      instances: [instance({ id: "b1", name: "8-32 screw" }), instance({ id: "b2", name: "8-32 nut" })],
      mates: [mate("m", "FASTENED", ["b1", "b2"])],
    });
    expect(buildAssemblyGraph(boltsOnly).subAssemblies).toHaveLength(0);
  });

  it("lists an instance with no mates as unmated rather than inventing a link", () => {
    const loose = facts({
      parts: [part({ key: "a", name: "Plate" })],
      instances: [instance({ id: "a", name: "Plate" }), instance({ id: "b", name: "Spare" })],
      mates: [],
    });
    expect(buildAssemblyGraph(loose).unmated.sort()).toEqual(["a", "b"]);
  });

  it("reports the parts a fastener joins, never other hardware", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    expect(fastenerTargets(graph, "screw").sort()).toEqual(["motor", "plate"]);
  });
});
