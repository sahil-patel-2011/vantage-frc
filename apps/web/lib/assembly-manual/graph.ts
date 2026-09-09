import {
  boxExtent,
  type AssemblyFacts,
  type BoxMm,
  type InstanceFacts,
  type MateFacts,
  type PartFacts,
} from "./model";

/**
 * The structure the build order is derived from.
 *
 * Two graphs, because they answer different questions:
 *   * `adjacency` — everything a mate touches. "What is this connected to?"
 *   * `fastened`  — FASTENED mates only. "What moves as one rigid lump?"
 *
 * Connected components of the FASTENED graph are the sub-assemblies. That is
 * not a heuristic dressed up as one: a set of parts joined only by FASTENED
 * mates is, by Onshape's own definition, rigid relative to each other, which is
 * exactly what "you can build this on the bench and bring it over" means. A
 * REVOLUTE mate crossing between two clumps is a joint, and a joint is where one
 * sub-assembly ends and the next begins.
 */

export type FastenerClass = {
  isFastener: boolean;
  /** "name" when the part name said so, "geometry" when the shape did. */
  basis: "name" | "geometry" | "none";
  detail: string;
};

export type SubAssembly = {
  id: string;
  /** Filled in later by the writer; starts as the largest member's name. */
  name: string;
  instanceIds: string[];
  /** Instances in this component that are fasteners. */
  fastenerIds: string[];
};

export type AssemblyGraph = {
  instances: Map<string, InstanceFacts>;
  parts: Map<string, PartFacts>;
  /** instanceId → every instance it shares any mate with. */
  adjacency: Map<string, Set<string>>;
  /** instanceId → instances it shares a FASTENED mate with. */
  fastened: Map<string, Set<string>>;
  matesByInstance: Map<string, MateFacts[]>;
  fasteners: Map<string, FastenerClass>;
  subAssemblies: SubAssembly[];
  /** Instances with no mate at all — they float, and the manual says so. */
  unmated: string[];
};

const FASTENER_WORDS = [
  "screw", "bolt", "nut", "washer", "rivet", "standoff", "spacer", "shcs", "bhcs",
  "fhcs", "sems", "setscrew", "set screw", "dowel", "retaining ring", "circlip",
  "cotter", "e-clip", "clevis pin", "shoulder bolt", "thread", "hex cap",
];

/**
 * Is this instance a fastener?
 *
 * Name first, because a team that named the part "10-32 x 1.00 SHCS" has told
 * us directly and no geometric inference beats that. Geometry second, and
 * conservatively: a small, light, near-axisymmetric part whose length is at
 * least 1.4x its cross-section. Both tests are recorded with their basis so the
 * run report can show why a part was treated as hardware.
 *
 * Getting this wrong in the "not a fastener" direction is safe — the part just
 * gets its own step. Getting it wrong in the "is a fastener" direction would
 * bury a real component in a hardware callout, so the geometric thresholds are
 * tight.
 */
export function classifyFastener(instance: InstanceFacts, part: PartFacts | null): FastenerClass {
  const name = `${instance.name} ${part?.name ?? ""}`.toLowerCase();
  const word = FASTENER_WORDS.find((candidate) => name.includes(candidate));
  if (word) {
    return { isFastener: true, basis: "name", detail: `part name contains "${word}"` };
  }

  const box = part?.bboxMm ?? instance.worldBoxMm;
  if (!box) return { isFastener: false, basis: "none", detail: "no name match and no bounding box" };

  const [a, b, c] = boxExtent(box).slice().sort((x, y) => x - y) as [number, number, number];
  const massKg = instance.massKg ?? part?.massKg ?? null;

  // Cross-section under 20 mm, length under 200 mm, roughly round (the two
  // small extents within 15% of each other), and slender.
  const roundish = a > 0 && Math.abs(b - a) / Math.max(a, 1e-6) <= 0.15;
  const slender = c >= 1.4 * b;
  const small = b <= 20 && c <= 200;
  const light = massKg === null || massKg <= 0.06;

  if (roundish && slender && small && light) {
    return {
      isFastener: true,
      basis: "geometry",
      detail: `round shank ${b.toFixed(1)} mm across, ${c.toFixed(1)} mm long${massKg === null ? "" : `, ${(massKg * 1000).toFixed(0)} g`}`,
    };
  }
  return { isFastener: false, basis: "none", detail: "shape is not a slender round shank" };
}

function addEdge(map: Map<string, Set<string>>, a: string, b: string): void {
  if (!map.has(a)) map.set(a, new Set());
  if (!map.has(b)) map.set(b, new Set());
  map.get(a)!.add(b);
  map.get(b)!.add(a);
}

function connectedComponents(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node)) continue;
    const stack = [node];
    const component: string[] = [];
    seen.add(node);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const neighbour of edges.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    components.push(component);
  }
  return components;
}

/** Volume of the instance's world box, for "which member is the biggest". */
export function instanceBulk(instance: InstanceFacts): number {
  const box: BoxMm | null = instance.worldBoxMm;
  if (!box) return 0;
  const [x, y, z] = boxExtent(box);
  return Math.max(0, x) * Math.max(0, y) * Math.max(0, z);
}

export function buildAssemblyGraph(facts: AssemblyFacts): AssemblyGraph {
  const instances = new Map(facts.instances.map((instance) => [instance.id, instance]));
  const parts = new Map(facts.parts.map((part) => [part.key, part]));

  const adjacency = new Map<string, Set<string>>();
  const fastened = new Map<string, Set<string>>();
  const matesByInstance = new Map<string, MateFacts[]>();

  for (const id of instances.keys()) {
    adjacency.set(id, new Set());
    fastened.set(id, new Set());
  }

  for (const mate of facts.mates) {
    for (const id of mate.instanceIds) {
      if (!matesByInstance.has(id)) matesByInstance.set(id, []);
      matesByInstance.get(id)!.push(mate);
    }
    for (let i = 0; i < mate.instanceIds.length; i += 1) {
      for (let j = i + 1; j < mate.instanceIds.length; j += 1) {
        const a = mate.instanceIds[i]!;
        const b = mate.instanceIds[j]!;
        addEdge(adjacency, a, b);
        if (mate.mateType === "FASTENED") addEdge(fastened, a, b);
      }
    }
  }

  const fasteners = new Map<string, FastenerClass>();
  for (const instance of instances.values()) {
    const part = instance.partKey ? (parts.get(instance.partKey) ?? null) : null;
    const verdict = classifyFastener(instance, part);
    if (verdict.isFastener) fasteners.set(instance.id, verdict);
  }

  // Sub-assemblies: FASTENED components, minus components that are nothing but
  // hardware (a pile of loose bolts is not a sub-assembly).
  const order = [...instances.keys()];
  const components = connectedComponents(order, fastened)
    .filter((component) => component.some((id) => !fasteners.has(id)))
    .map((component) => component.slice().sort((a, b) => instanceBulk(instances.get(b)!) - instanceBulk(instances.get(a)!)));

  const subAssemblies: SubAssembly[] = components
    // A component of one non-fastener part is just a part, not a sub-assembly.
    .filter((component) => component.filter((id) => !fasteners.has(id)).length >= 2)
    .map((component, index) => ({
      id: `sub-${index + 1}`,
      name: instances.get(component[0]!)?.name ?? `Sub-assembly ${index + 1}`,
      instanceIds: component,
      fastenerIds: component.filter((id) => fasteners.has(id)),
    }));

  const unmated = [...instances.keys()].filter((id) => (adjacency.get(id)?.size ?? 0) === 0);

  return { instances, parts, adjacency, fastened, matesByInstance, fasteners, subAssemblies, unmated };
}

/** The sub-assembly an instance belongs to, or null for a top-level part. */
export function subAssemblyOf(graph: AssemblyGraph, instanceId: string): SubAssembly | null {
  return graph.subAssemblies.find((sub) => sub.instanceIds.includes(instanceId)) ?? null;
}

/**
 * Which already-placed instances a fastener joins. A screw's prerequisites are
 * every part it is mated to — you cannot put the bolt in before the two plates
 * it goes through exist.
 */
export function fastenerTargets(graph: AssemblyGraph, fastenerId: string): string[] {
  return [...(graph.adjacency.get(fastenerId) ?? [])].filter((id) => !graph.fasteners.has(id));
}
