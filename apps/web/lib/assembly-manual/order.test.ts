import { describe, expect, it } from "vitest";
import { box, enclosedPartAssembly, facts, instance, mate, part, wheelBeforeScrewsAssembly } from "./fixtures";
import { buildAssemblyGraph } from "./graph";
import {
  checkStep,
  deriveBuildOrder,
  dominantAxis,
  escapeDirections,
  orderByGeometry,
  orderByMates,
  revalidate,
  simulate,
  sweptVolume,
} from "./order";

describe("sweep geometry", () => {
  it("sweeps away from the face it starts at, in the axis it is given", () => {
    const swept = sweptVolume(box(0, 10, 0, 10, 0, 10), { axis: 0, sign: 1, label: "+X" });
    expect(swept.minX).toBeGreaterThan(10);
    expect(swept.maxX).toBeGreaterThan(1e6);
    // Cross-section is shrunk, so a flush neighbour is not treated as blocking.
    expect(swept.minY).toBeGreaterThan(0);
    expect(swept.maxY).toBeLessThan(10);
  });

  it("finds all six directions clear when nothing is placed", () => {
    expect(escapeDirections(box(0, 10, 0, 10, 0, 10), [])).toHaveLength(6);
  });

  it("finds no direction clear for a part inside a bigger one", () => {
    const outer = box(0, 200, 0, 200, 0, 200);
    const inner = box(80, 120, 80, 120, 80, 120);
    expect(escapeDirections(inner, [outer])).toHaveLength(0);
  });

  it("reads a fastener's shank as its long axis", () => {
    expect(dominantAxis(box(-20, 25, 40, 44, 40, 44))).toBe(0);
    expect(dominantAxis(box(0, 4, 0, 40, 0, 4))).toBe(1);
    expect(dominantAxis(box(0, 4, 0, 4, 0, 40))).toBe(2);
  });
});

describe("feasibility checks", () => {
  it("refuses a step whose only mates are to parts not yet on the bench", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    const checks = checkStep(graph, new Set(["frame"]), "wheel", []);
    const prerequisites = checks.find((check) => check.id === "prerequisites")!;
    expect(prerequisites.passed).toBe(false);
    expect(prerequisites.detail).toContain("not on the bench");
  });

  it("refuses hardware that would go in before the part it joins", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    // Placing the screw with the plate, while the motor it also joins is absent.
    const checks = checkStep(graph, new Set(["frame"]), "plate", ["screw"]);
    const order = checks.find((check) => check.id === "fastener_order")!;
    expect(order.passed).toBe(false);
    expect(order.detail).toContain("NEO motor");
  });

  it("refuses a part that would be enclosed by what is already placed", () => {
    const graph = buildAssemblyGraph(enclosedPartAssembly());
    const checks = checkStep(graph, new Set(["shell"]), "core", []);
    const reachable = checks.find((check) => check.id === "reachable")!;
    expect(reachable.passed).toBe(false);
    expect(reachable.detail).toContain("enclosed");
  });

  it("refuses a fastener whose head has no driver access at either end", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    // Everything but the screw is already on: +X is behind the wheel, -X behind
    // the frame, and neither is a part the screw joins.
    const checks = checkStep(graph, new Set(["plate", "motor", "frame", "wheel"]), "motor", ["screw"]);
    const head = checks.find((check) => check.id === "head_clear")!;
    expect(head.passed).toBe(false);
    expect(head.detail).toContain("10-32");
  });

  it("passes the same fastener when the wheel is not on yet", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    const checks = checkStep(graph, new Set(["plate", "frame"]), "motor", ["screw"]);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("does not invent a verdict for a part with no bounding box", () => {
    const noBox = facts({
      parts: [part({ key: "a", name: "Bracket" })],
      instances: [instance({ id: "a", name: "Bracket" }), instance({ id: "b", name: "Rail" })],
      mates: [mate("m", "FASTENED", ["a", "b"])],
    });
    const graph = buildAssemblyGraph(noBox);
    const reachable = checkStep(graph, new Set(["b"]), "a", []).find((check) => check.id === "reachable")!;
    expect(reachable.passed).toBe(true);
    expect(reachable.detail).toContain("no bounding box");
  });
});

describe("the two strategies", () => {
  it("disagree on this assembly, which is the whole reason both are run", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    expect(orderByMates(graph)).not.toEqual(orderByGeometry(graph));
  });

  it("both put the wheel before the motor screws, and both are therefore infeasible", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    for (const order of [orderByMates(graph), orderByGeometry(graph)]) {
      expect(order.indexOf("wheel")).toBeLessThan(order.indexOf("motor"));
      const run = simulate(graph, order);
      const failed = run.steps.flatMap((step) => step.checks.filter((check) => !check.passed));
      expect(failed.some((check) => check.id === "head_clear")).toBe(true);
    }
  });

  it("is deterministic — the same CAD gives the same book twice", () => {
    const a = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    const b = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    expect(orderByMates(a)).toEqual(orderByMates(b));
    expect(orderByGeometry(a)).toEqual(orderByGeometry(b));
  });
});

describe("revalidate", () => {
  it("moves the motor ahead of the wheel so the screws can still be driven", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    const naive = orderByGeometry(graph);
    const repaired = revalidate(graph, naive);

    expect(repaired.order.indexOf("motor")).toBeLessThan(repaired.order.indexOf("wheel"));
    expect(repaired.repairs.length).toBeGreaterThan(0);
    expect(repaired.steps.every((step) => step.checks.every((check) => check.passed))).toBe(true);
  });

  it("never drops a part, even one it could not make feasible", () => {
    const graph = buildAssemblyGraph(enclosedPartAssembly());
    const repaired = revalidate(graph, ["shell", "core"]);
    expect(repaired.order.slice().sort()).toEqual(["core", "shell"]);
    expect(repaired.steps).toHaveLength(2);
  });
});

describe("deriveBuildOrder", () => {
  it("reports what it rejected rather than quietly shipping the naive order", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    const result = deriveBuildOrder(graph);

    // The order that ships is feasible …
    expect(result.unresolved).toHaveLength(0);
    expect(result.checksPassed).toBe(result.checksRun);

    // … and it is NOT either raw strategy, because both were infeasible.
    const shipped = result.steps.map((step) => step.primaryId);
    expect(shipped.indexOf("motor")).toBeLessThan(shipped.indexOf("wheel"));

    // The disagreement between the strategies is recorded, not hidden.
    expect(result.disagreements.length).toBeGreaterThan(0);
    for (const disagreement of result.disagreements) {
      expect(disagreement.matePosition).not.toBe(disagreement.geometryPosition);
      expect(disagreement.note).toMatch(/step \d+/);
    }
    expect(result.notes.some((note) => /Moved "NEO motor"/.test(note))).toBe(true);
  });

  it("puts every fastener after every part it joins", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    const result = deriveBuildOrder(graph);
    const placedAt = new Map<string, number>();
    for (const [index, step] of result.steps.entries()) {
      placedAt.set(step.primaryId, index);
      for (const fastenerId of step.fastenerIds) placedAt.set(fastenerId, index);
    }
    expect(placedAt.get("screw")!).toBeGreaterThanOrEqual(placedAt.get("plate")!);
    expect(placedAt.get("screw")!).toBeGreaterThanOrEqual(placedAt.get("motor")!);
  });

  it("keeps every non-fastener instance exactly once", () => {
    const graph = buildAssemblyGraph(wheelBeforeScrewsAssembly());
    const result = deriveBuildOrder(graph);
    const ids = result.steps.map((step) => step.primaryId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice().sort()).toEqual(["frame", "motor", "plate", "wheel"]);
  });

  it("survives an assembly with no mates at all and says so", () => {
    const loose = facts({
      parts: [part({ key: "a", name: "Plate A" }), part({ key: "b", name: "Plate B" })],
      instances: [
        instance({ id: "a", name: "Plate A", worldBoxMm: box(0, 10, 0, 10, 0, 10) }),
        instance({ id: "b", name: "Plate B", worldBoxMm: box(40, 50, 0, 10, 0, 10) }),
      ],
      mates: [],
    });
    const result = deriveBuildOrder(buildAssemblyGraph(loose));
    expect(result.steps).toHaveLength(2);
    expect(result.notes.some((note) => /no mate at all/.test(note))).toBe(true);
  });
});
