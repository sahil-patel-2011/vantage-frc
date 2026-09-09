import { fastenerTargets, instanceBulk, type AssemblyGraph } from "./graph";
import { boxExtent, boxesOverlap, type BoxMm, type FeasibilityCheck, type InstanceFacts } from "./model";

/**
 * The build order, derived twice and then checked a third time.
 *
 * WHY TWICE
 *
 * A mate-dependency order follows how the designer said the machine goes
 * together. A geometry-first order follows how a person actually builds one:
 * the biggest structural member on the bench, then everything that hangs off it.
 * Both are reasonable and they disagree — routinely. Picking one silently would
 * make the manual look more certain than it is, so both are computed, both are
 * scored against the same feasibility checks, and every place they disagree is
 * counted and reported. A step where they disagree AND the chosen order fails a
 * check is "unresolved", and the run report says so out loud.
 *
 * WHAT "FEASIBLE" MEANS HERE
 *
 * Not a vibe. Four checks, all against boxes Onshape measured:
 *
 *   prerequisites   every part this step depends on is already placed
 *   fastener_order  a fastener never precedes the parts it joins
 *   reachable       the part can be brought in from at least one direction
 *                   without passing through something already placed
 *   head_clear      a fastener has a clear run along its own axis for at least
 *                   one of its two ends, so a driver can reach the head
 *
 * `reachable` and `head_clear` sweep the part's axis-aligned box along each of
 * the six axes and look for a placed box in the way. That is coarse — a box is
 * bigger than the part inside it — but it is coarse in the safe direction: it
 * can warn about a step that would actually have been fine, and it cannot clear
 * a step that is genuinely enclosed.
 */

export type OrderStrategy = "mate" | "geometry";

export type OrderStep = {
  /** The part this step is about. */
  primaryId: string;
  /** Fasteners installed in the same step, because they join the primary. */
  fastenerIds: string[];
  checks: FeasibilityCheck[];
};

export type Disagreement = {
  instanceId: string;
  name: string;
  matePosition: number;
  geometryPosition: number;
  note: string;
};

export type Unresolved = {
  instanceId: string;
  name: string;
  reason: string;
};

export type OrderResult = {
  steps: OrderStep[];
  strategyUsed: OrderStrategy;
  scores: Record<OrderStrategy, { checksRun: number; checksPassed: number }>;
  checksRun: number;
  checksPassed: number;
  disagreements: Disagreement[];
  unresolved: Unresolved[];
  notes: string[];
};

/** Clearance used when deciding whether a placed box blocks a path, in mm. */
const CONTACT_SLACK_MM = 1;
/** How far past the part's own face a sweep starts, in mm. */
const SWEEP_START_MM = 0.5;
/**
 * Repair bounds. A robot assembly is a few hundred steps and each trial order
 * costs a full simulation, so the search is a small window around the failing
 * step and a handful of attempts. Anything it cannot fix inside that budget is
 * reported as unresolved rather than searched for indefinitely.
 */
const MAX_REPAIR_ATTEMPTS = 8;
const REPAIR_WINDOW = 12;

type Axis = 0 | 1 | 2;
type Direction = { axis: Axis; sign: 1 | -1; label: string };

const DIRECTIONS: Direction[] = [
  { axis: 0, sign: 1, label: "+X" },
  { axis: 0, sign: -1, label: "-X" },
  { axis: 1, sign: 1, label: "+Y" },
  { axis: 1, sign: -1, label: "-Y" },
  { axis: 2, sign: 1, label: "+Z" },
  { axis: 2, sign: -1, label: "-Z" },
];

const HUGE = 1e9;

/**
 * The volume the part sweeps through if it is brought in along `direction`.
 * The cross-section is shrunk by the contact slack so a part sliding flush
 * against a neighbour is not treated as passing through it.
 */
export function sweptVolume(box: BoxMm, direction: Direction): BoxMm {
  const shrunk: BoxMm = {
    minX: box.minX + CONTACT_SLACK_MM,
    minY: box.minY + CONTACT_SLACK_MM,
    minZ: box.minZ + CONTACT_SLACK_MM,
    maxX: box.maxX - CONTACT_SLACK_MM,
    maxY: box.maxY - CONTACT_SLACK_MM,
    maxZ: box.maxZ - CONTACT_SLACK_MM,
  };
  const swept = { ...shrunk };
  if (direction.axis === 0) {
    if (direction.sign > 0) {
      swept.minX = box.maxX + SWEEP_START_MM;
      swept.maxX = box.maxX + HUGE;
    } else {
      swept.maxX = box.minX - SWEEP_START_MM;
      swept.minX = box.minX - HUGE;
    }
  } else if (direction.axis === 1) {
    if (direction.sign > 0) {
      swept.minY = box.maxY + SWEEP_START_MM;
      swept.maxY = box.maxY + HUGE;
    } else {
      swept.maxY = box.minY - SWEEP_START_MM;
      swept.minY = box.minY - HUGE;
    }
  } else if (direction.sign > 0) {
    swept.minZ = box.maxZ + SWEEP_START_MM;
    swept.maxZ = box.maxZ + HUGE;
  } else {
    swept.maxZ = box.minZ - SWEEP_START_MM;
    swept.minZ = box.minZ - HUGE;
  }
  return swept;
}

/** Directions along which nothing already placed stands in the way. */
export function escapeDirections(
  target: BoxMm,
  obstacles: BoxMm[],
  only?: Axis,
): Direction[] {
  return DIRECTIONS.filter((direction) => {
    if (only !== undefined && direction.axis !== only) return false;
    const swept = sweptVolume(target, direction);
    // A degenerate cross-section (a part thinner than twice the slack) cannot
    // be swept meaningfully, so it is treated as reachable rather than as
    // mysteriously blocked.
    if (swept.maxX <= swept.minX || swept.maxY <= swept.minY || swept.maxZ <= swept.minZ) return true;
    return !obstacles.some((obstacle) => boxesOverlap(swept, obstacle));
  });
}

/** The long axis of a box — a fastener's shank runs along it. */
export function dominantAxis(box: BoxMm): Axis {
  const [x, y, z] = boxExtent(box);
  if (x >= y && x >= z) return 0;
  if (y >= x && y >= z) return 1;
  return 2;
}

function placedBoxes(graph: AssemblyGraph, placed: Set<string>, exclude: Set<string>): BoxMm[] {
  const boxes: BoxMm[] = [];
  for (const id of placed) {
    if (exclude.has(id)) continue;
    const box = graph.instances.get(id)?.worldBoxMm;
    if (box) boxes.push(box);
  }
  return boxes;
}

/**
 * Run the four checks for placing `instanceId` (plus its fasteners) into a
 * partial assembly. Pure: no mutation of `placed`.
 */
export function checkStep(
  graph: AssemblyGraph,
  placed: Set<string>,
  primaryId: string,
  fastenerIds: string[],
): FeasibilityCheck[] {
  const checks: FeasibilityCheck[] = [];
  const instance = graph.instances.get(primaryId);
  if (!instance) {
    return [{ id: "prerequisites", passed: false, detail: `Instance ${primaryId} is not in the assembly.` }];
  }

  // --- prerequisites -----------------------------------------------------
  const neighbours = [...(graph.adjacency.get(primaryId) ?? [])].filter((id) => !graph.fasteners.has(id));
  const placedNeighbours = neighbours.filter((id) => placed.has(id));
  if (!placed.size) {
    checks.push({ id: "prerequisites", passed: true, detail: "First part on the bench — nothing to attach to yet." });
  } else if (!neighbours.length) {
    checks.push({
      id: "prerequisites",
      passed: true,
      detail: `"${instance.name}" has no mates in CAD, so nothing constrains when it goes on.`,
    });
  } else if (placedNeighbours.length) {
    checks.push({
      id: "prerequisites",
      passed: true,
      detail: `Mates to ${placedNeighbours.length} part(s) already placed.`,
    });
  } else {
    checks.push({
      id: "prerequisites",
      passed: false,
      detail: `"${instance.name}" mates only to parts that are not on the bench yet.`,
    });
  }

  // --- fastener order ----------------------------------------------------
  const misordered: string[] = [];
  for (const fastenerId of fastenerIds) {
    for (const targetId of fastenerTargets(graph, fastenerId)) {
      if (targetId === primaryId || placed.has(targetId)) continue;
      misordered.push(`${graph.instances.get(fastenerId)?.name ?? fastenerId} → ${graph.instances.get(targetId)?.name ?? targetId}`);
    }
  }
  checks.push(
    misordered.length
      ? {
          id: "fastener_order",
          passed: false,
          detail: `Hardware would go in before the part it joins: ${misordered.slice(0, 3).join("; ")}.`,
        }
      : {
          id: "fastener_order",
          passed: true,
          detail: fastenerIds.length
            ? `${fastenerIds.length} fastener(s) follow the parts they join.`
            : "No hardware in this step.",
        },
  );

  // --- reachable ---------------------------------------------------------
  const box = instance.worldBoxMm;
  if (!box) {
    checks.push({
      id: "reachable",
      passed: true,
      detail: "Onshape reported no bounding box for this part, so reach was not checked.",
    });
  } else {
    const obstacles = placedBoxes(graph, placed, new Set([primaryId, ...fastenerIds]));
    const escapes = escapeDirections(box, obstacles);
    checks.push(
      escapes.length
        ? { id: "reachable", passed: true, detail: `Can be brought in along ${escapes.map((d) => d.label).join(", ")}.` }
        : {
            id: "reachable",
            passed: false,
            detail: `"${instance.name}" would be enclosed by parts already placed — there is no straight path in along any axis.`,
          },
    );
  }

  // --- fastener head clearance -------------------------------------------
  const blockedHeads: string[] = [];
  let headChecked = 0;
  for (const fastenerId of fastenerIds) {
    const fastener = graph.instances.get(fastenerId);
    const fastenerBox = fastener?.worldBoxMm;
    if (!fastener || !fastenerBox) continue;
    headChecked += 1;
    const axis = dominantAxis(fastenerBox);
    const exclude = new Set([fastenerId, primaryId, ...fastenerTargets(graph, fastenerId)]);
    const obstacles = placedBoxes(graph, placed, exclude);
    if (!escapeDirections(fastenerBox, obstacles, axis).length) blockedHeads.push(fastener.name);
  }
  checks.push(
    blockedHeads.length
      ? {
          id: "head_clear",
          passed: false,
          detail: `No driver access along the axis of ${blockedHeads.slice(0, 3).join(", ")} once the parts already placed are in the way.`,
        }
      : {
          id: "head_clear",
          passed: true,
          detail: headChecked
            ? `${headChecked} fastener axis/axes have a clear run for a driver.`
            : "No fastener axis to check.",
        },
  );

  return checks;
}

function nonFasteners(graph: AssemblyGraph): InstanceFacts[] {
  return [...graph.instances.values()].filter((instance) => !graph.fasteners.has(instance.id));
}

/** Deterministic tie-break so two runs of the same CAD produce the same book. */
function stableCompare(a: InstanceFacts, b: InstanceFacts): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Strategy 1 — mate dependency.
 *
 * Seed with the most-mated part (the thing everything else hangs off), then
 * repeatedly take the unplaced part with the most already-placed neighbours.
 * This is a topological walk of the mate graph rather than a strict topological
 * sort, because the mate graph is undirected and usually cyclic: a real chassis
 * has loops in it.
 */
export function orderByMates(graph: AssemblyGraph): string[] {
  const remaining = new Map(nonFasteners(graph).map((instance) => [instance.id, instance]));
  const order: string[] = [];
  const placed = new Set<string>();

  const seed = [...remaining.values()].sort(
    (a, b) =>
      (graph.adjacency.get(b.id)?.size ?? 0) - (graph.adjacency.get(a.id)?.size ?? 0) ||
      instanceBulk(b) - instanceBulk(a) ||
      stableCompare(a, b),
  )[0];
  if (!seed) return order;

  order.push(seed.id);
  placed.add(seed.id);
  remaining.delete(seed.id);

  while (remaining.size) {
    const next = [...remaining.values()]
      .map((instance) => ({
        instance,
        connected: [...(graph.adjacency.get(instance.id) ?? [])].filter((id) => placed.has(id)).length,
      }))
      .sort(
        (a, b) =>
          b.connected - a.connected ||
          instanceBulk(b.instance) - instanceBulk(a.instance) ||
          stableCompare(a.instance, b.instance),
      )[0]!;
    order.push(next.instance.id);
    placed.add(next.instance.id);
    remaining.delete(next.instance.id);
  }
  return order;
}

/**
 * Strategy 2 — geometry first.
 *
 * Biggest structural member out of the box first, then repeatedly the biggest
 * remaining part that actually touches what is already on the bench (mated, or
 * boxes overlapping). Only when nothing touches does it fall back to the next
 * biggest, which is the honest representation of "start a second sub-assembly".
 */
export function orderByGeometry(graph: AssemblyGraph): string[] {
  const remaining = new Map(nonFasteners(graph).map((instance) => [instance.id, instance]));
  const order: string[] = [];
  const placed = new Set<string>();

  const touchesPlaced = (instance: InstanceFacts): boolean => {
    for (const neighbour of graph.adjacency.get(instance.id) ?? []) {
      if (placed.has(neighbour)) return true;
    }
    const box = instance.worldBoxMm;
    if (!box) return false;
    for (const id of placed) {
      const other = graph.instances.get(id)?.worldBoxMm;
      if (other && boxesOverlap(box, other, CONTACT_SLACK_MM)) return true;
    }
    return false;
  };

  while (remaining.size) {
    const candidates = [...remaining.values()].sort(
      (a, b) => instanceBulk(b) - instanceBulk(a) || stableCompare(a, b),
    );
    const attached = placed.size ? candidates.find((instance) => touchesPlaced(instance)) : undefined;
    const next = attached ?? candidates[0]!;
    order.push(next.id);
    placed.add(next.id);
    remaining.delete(next.id);
  }
  return order;
}

/**
 * Attach each fastener to the step of the LAST part it joins, so hardware
 * always follows every part it passes through. A fastener whose targets never
 * all get placed (it joins something outside this assembly) goes on the end
 * with the reason recorded.
 */
function assignFasteners(
  graph: AssemblyGraph,
  order: string[],
): { byPrimary: Map<string, string[]>; orphans: string[] } {
  const position = new Map(order.map((id, index) => [id, index]));
  const byPrimary = new Map<string, string[]>(order.map((id) => [id, []]));
  const orphans: string[] = [];

  for (const fastenerId of graph.fasteners.keys()) {
    const targets = fastenerTargets(graph, fastenerId);
    const positions = targets.map((id) => position.get(id)).filter((value): value is number => value !== undefined);
    if (!positions.length) {
      orphans.push(fastenerId);
      continue;
    }
    const last = order[Math.max(...positions)]!;
    byPrimary.get(last)!.push(fastenerId);
  }
  for (const ids of byPrimary.values()) {
    ids.sort((a, b) => (graph.instances.get(a)?.name ?? a).localeCompare(graph.instances.get(b)?.name ?? b));
  }
  return { byPrimary, orphans };
}

/** Walk an order from an empty bench and total up what the checks say. */
export function simulate(graph: AssemblyGraph, order: string[]): { steps: OrderStep[]; run: number; passed: number } {
  const { byPrimary } = assignFasteners(graph, order);
  const placed = new Set<string>();
  const steps: OrderStep[] = [];
  let run = 0;
  let passed = 0;

  for (const primaryId of order) {
    const fastenerIds = byPrimary.get(primaryId) ?? [];
    const checks = checkStep(graph, placed, primaryId, fastenerIds);
    run += checks.length;
    passed += checks.filter((check) => check.passed).length;
    steps.push({ primaryId, fastenerIds, checks });
    placed.add(primaryId);
    for (const fastenerId of fastenerIds) placed.add(fastenerId);
  }
  return { steps, run, passed };
}

/**
 * Third pass: replay the chosen order from empty and, where a step fails,
 * try to repair it by moving that part to the earliest position where every
 * check passes. Repairs are bounded (one move per failing part, and the whole
 * pass runs at most twice) so a pathological assembly cannot spin here.
 *
 * A part that cannot be repaired STAYS in the manual, with its failing checks
 * printed on the step. Dropping it would produce a manual that quietly omits a
 * part of the robot, which is the worst possible failure mode for this feature.
 */
export function revalidate(
  graph: AssemblyGraph,
  order: string[],
): { order: string[]; steps: OrderStep[]; run: number; passed: number; repairs: string[] } {
  const repairs: string[] = [];
  let current = order.slice();
  let best = simulate(graph, current);

  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt += 1) {
    const failing = best.steps.find((step) => step.checks.some((check) => !check.passed));
    if (!failing) break;

    const failingIndex = current.indexOf(failing.primaryId);
    const without = current.filter((id) => id !== failing.primaryId);

    // Only nearby positions are tried. Moving a part halfway across a 200-step
    // book to satisfy one check produces a manual nobody can follow, and the
    // search cost is quadratic in the window, so a window is both the cheaper
    // and the more useful choice.
    const from = Math.max(0, failingIndex - REPAIR_WINDOW);
    const to = Math.min(without.length, failingIndex + REPAIR_WINDOW);

    let winner: { position: number; run: ReturnType<typeof simulate> } | null = null;
    for (let position = from; position <= to; position += 1) {
      if (position === failingIndex) continue;
      const candidate = [...without.slice(0, position), failing.primaryId, ...without.slice(position)];
      const trial = simulate(graph, candidate);
      // The comparison is over the WHOLE order, not just the moved step. An
      // earlier version accepted any move that fixed the failing step, and
      // happily shunted parts to the front where their own checks pass
      // vacuously while breaking the steps behind them.
      if (!winner || trial.passed > winner.run.passed) winner = { position, run: trial };
    }

    if (!winner || winner.run.passed <= best.passed) break;

    repairs.push(
      `Moved "${graph.instances.get(failing.primaryId)?.name ?? failing.primaryId}" from step ${failingIndex + 1} to step ${winner.position + 1}; that order passes ${winner.run.passed} checks instead of ${best.passed}.`,
    );
    current = [...without.slice(0, winner.position), failing.primaryId, ...without.slice(winner.position)];
    best = winner.run;
  }

  return { order: current, ...best, repairs };
}

/**
 * The whole ordering pass: two strategies, scored, reconciled, revalidated.
 */
export function deriveBuildOrder(graph: AssemblyGraph): OrderResult {
  const notes: string[] = [];
  const mateOrder = orderByMates(graph);
  const geometryOrder = orderByGeometry(graph);

  const mateRun = simulate(graph, mateOrder);
  const geometryRun = simulate(graph, geometryOrder);

  // Tie goes to the mate order: when both are equally feasible, the designer's
  // own constraints are better evidence than a bounding-box heuristic.
  const strategyUsed: OrderStrategy = geometryRun.passed > mateRun.passed ? "geometry" : "mate";
  const chosen = strategyUsed === "geometry" ? geometryOrder : mateOrder;

  if (strategyUsed === "geometry") {
    notes.push(
      "The geometry-first order passed more feasibility checks than the mate-dependency order, so it was used. The disagreements below are where the two differ.",
    );
  }

  const matePosition = new Map(mateOrder.map((id, index) => [id, index]));
  const geometryPosition = new Map(geometryOrder.map((id, index) => [id, index]));
  const disagreements: Disagreement[] = [];
  for (const id of chosen) {
    const a = matePosition.get(id);
    const b = geometryPosition.get(id);
    if (a === undefined || b === undefined || a === b) continue;
    disagreements.push({
      instanceId: id,
      name: graph.instances.get(id)?.name ?? id,
      matePosition: a + 1,
      geometryPosition: b + 1,
      note: `Mate order puts this at step ${a + 1}; the geometry-first order puts it at step ${b + 1}.`,
    });
  }

  const validated = revalidate(graph, chosen);
  notes.push(...validated.repairs);

  const unresolved: Unresolved[] = [];
  for (const step of validated.steps) {
    const failed = step.checks.filter((check) => !check.passed);
    if (!failed.length) continue;
    unresolved.push({
      instanceId: step.primaryId,
      name: graph.instances.get(step.primaryId)?.name ?? step.primaryId,
      reason: failed.map((check) => check.detail).join(" "),
    });
  }

  const { orphans } = assignFasteners(graph, validated.order);
  if (orphans.length) {
    notes.push(
      `${orphans.length} fastener(s) mate only to other hardware, so there is no part they can follow. They are listed in the loose-hardware callout instead of a step.`,
    );
  }
  if (graph.unmated.length) {
    notes.push(
      `${graph.unmated.length} instance(s) have no mate at all in CAD. They were ordered by size, and the manual says where that is a guess about position rather than a fact.`,
    );
  }

  return {
    steps: validated.steps,
    strategyUsed,
    scores: {
      mate: { checksRun: mateRun.run, checksPassed: mateRun.passed },
      geometry: { checksRun: geometryRun.run, checksPassed: geometryRun.passed },
    },
    checksRun: validated.run,
    checksPassed: validated.passed,
    disagreements,
    unresolved,
    notes,
  };
}
