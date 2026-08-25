/**
 * Flatten the part that will actually be BUILT into the feature list the DFM
 * rules check.
 *
 * `featurescript/part-schema` describes buildable geometry (a plate, a hole
 * pattern, a boss). `dfm/types` describes the things a rule has an opinion about
 * (a wall thickness, a hole centre-to-edge distance, an insert bore depth). This
 * module is the one-way map between them, so `checkPart` never has to guess at a
 * dimension and the generator never has to know a DFM rule.
 *
 * Hole POSITIONS come from `generatePartFeatureScript`, which already expands
 * every pattern (grid, corners, linear, circular, explicit) into concrete
 * centres. Re-implementing that expansion here would be the same arithmetic in
 * two places, free to drift; calling the generator is also what `preview.ts`
 * describes as the zero-Onshape-call dry run the DFM pass inspects. Nothing here
 * touches the network.
 *
 * WHAT IS DELIBERATELY NOT DERIVED. A rule is emitted only where the schema
 * pins the number down exactly:
 *  - A hollow box's pocket floor is skipped: the material under a pocket in a
 *    box with `wallMm` is the cavity, not `height - cutDepth`, and the schema
 *    does not say where the cavity ends under that pocket.
 *  - Sloped faces do not exist in this schema (plate, box, bracket, rib and boss
 *    are all prismatic), so the only derived overhang is the one a `selection:
 *    "all"` fillet or chamfer puts on the bottom perimeter. Any other overhang
 *    has to be supplied by the caller.
 *  - A bracket's Y = 0 face is treated as a free edge even though the upright
 *    leg stands there. That over-reports how close a hole is to an edge, which
 *    is the safe direction to be wrong in.
 */

import { generatePartFeatureScript, type PredictedGeometry } from "../featurescript/generate";
import type { PartBase, PartDefinition as ModelledPart } from "../featurescript/part-schema";
import { HEAT_SET_INSERTS, requireInsert, type HeatSetInsert } from "./inserts";
import type {
  HoleFeature,
  InsertFeature,
  OverhangFeature,
  PartDefinition,
  SmallFeature,
  WallFeature,
} from "./types";

/**
 * A `selection: "all"` chamfer is emitted as `ChamferType.EQUAL_OFFSETS`, so its
 * face sits at 45 degrees from vertical — exactly on the clean-overhang bound.
 */
const CHAMFER_ANGLE_FROM_VERTICAL_DEG = 45;

/**
 * A `selection: "all"` fillet on the bottom perimeter runs tangent to the build
 * plate where it meets it, i.e. 90 degrees from vertical at its worst point.
 */
const FILLET_ANGLE_FROM_VERTICAL_DEG = 90;

/**
 * How close a boss bore has to be to a tabulated insert's installation hole
 * before the boss is assumed to be for that insert. This absorbs the caller
 * rounding 4 mm to 4.0 mm, not a manufacturing tolerance — a bore that misses
 * every row by more than this is reported as unmatched instead of snapped.
 */
const INSERT_BORE_MATCH_MM = 0.05;

export type FootprintRect = { minXMm: number; maxXMm: number; minYMm: number; maxYMm: number };

/**
 * Footprint of the BASE only, matching the corners `generate.ts` builds the base
 * cuboid from. Ribs and bosses can push the bounding box past this, but they add
 * material rather than moving the edge a hole has to stay clear of.
 */
export function baseFootprintMm(base: PartBase): FootprintRect {
  if (base.kind === "bracket") {
    return { minXMm: -base.widthMm / 2, maxXMm: base.widthMm / 2, minYMm: 0, maxYMm: base.legAMm };
  }
  return {
    minXMm: -base.widthMm / 2,
    maxXMm: base.widthMm / 2,
    minYMm: -base.depthMm / 2,
    maxYMm: base.depthMm / 2,
  };
}

/** Z of the face holes, pockets, ribs and bosses are referenced from. */
export function topFaceZMm(base: PartBase): number {
  if (base.kind === "plate") return base.thicknessMm;
  if (base.kind === "box") return base.heightMm;
  return base.thicknessMm;
}

/** True when there is solid material all the way from the top face to Z = 0. */
function baseIsSolid(base: PartBase): boolean {
  return base.kind !== "box" || base.wallMm === undefined;
}

function distanceToEdgeMm(xMm: number, yMm: number, footprint: FootprintRect): number {
  return Math.min(
    xMm - footprint.minXMm,
    footprint.maxXMm - xMm,
    yMm - footprint.minYMm,
    footprint.maxYMm - yMm,
  );
}

/** A boss whose bore matches no tabulated insert, so its depth rule cannot be applied. */
export type UnresolvedBoss = {
  bossId: string;
  boreDiameterMm: number;
  boreDepthMm: number;
  bossWallMm: number;
};

/** Where a compensated diameter has to be written back into the modelled part. */
export type DiameterTarget = {
  /** `setDefinitionPath`-compatible path, e.g. "holes.0.diameterMm". */
  path: string;
  /** Human label for the report line. */
  label: string;
};

export type DerivedPart = {
  /** The flat feature list every rule in `checks.ts` reads. */
  description: PartDefinition;
  geometry: PredictedGeometry;
  footprintMm: FootprintRect;
  /** DFM feature id -> where to write its compensated diameter back. */
  diameterTargets: ReadonlyMap<string, DiameterTarget>;
  /** DFM insert-feature id -> the insert used, and whether that was inferred. */
  bossInserts: ReadonlyMap<string, { insert: HeatSetInsert; inferred: boolean }>;
  unresolvedBosses: readonly UnresolvedBoss[];
};

export type DeriveOptions = {
  /** Reuse an existing `dryRunPart` result instead of regenerating the source. */
  geometry?: PredictedGeometry;
  /** Boss id -> heat-set insert id, for a bore that matches more than one row or none. */
  inserts?: Readonly<Record<string, string>>;
  /** Sloped faces this prismatic schema cannot express. */
  overhangs?: readonly OverhangFeature[];
  /** Engraving, pins and other detail the schema does not model. */
  smallFeatures?: readonly SmallFeature[];
};

/**
 * Pick the insert a boss bore is for.
 *
 * Several rows share a bore diameter (M2.5x4, M3x3 and M3x5.7 all install into
 * 4.0 mm), so an inference cannot be certain. The LONGEST body is chosen: it
 * carries the deepest bore requirement of the candidates, so an inference that
 * is wrong asks for too much depth rather than passing a boss that is too
 * shallow. This is the same "longest body" rule `defaultInsertIdForThread` uses.
 */
function inferInsertForBore(boreDiameterMm: number): HeatSetInsert | undefined {
  let best: HeatSetInsert | undefined;
  for (const insert of HEAT_SET_INSERTS) {
    if (Math.abs(insert.boreDiameterMm - boreDiameterMm) > INSERT_BORE_MATCH_MM) continue;
    if (!best || insert.lengthMm > best.lengthMm) best = insert;
  }
  return best;
}

function deriveWalls(part: ModelledPart, footprint: FootprintRect): WallFeature[] {
  const walls: WallFeature[] = [];
  const base = part.base;

  if (base.kind === "plate" || base.kind === "bracket") {
    walls.push({ id: "base.thickness", thicknessMm: base.thicknessMm });
  } else if (base.wallMm !== undefined) {
    walls.push({ id: "base.wall", thicknessMm: base.wallMm });
    walls.push({ id: "base.floor", thicknessMm: base.floorMm ?? base.wallMm });
    // `openTop` defaults to true in the generator, so a top wall exists only
    // when the caller explicitly closed the box.
    if (base.openTop === false) walls.push({ id: "base.top", thicknessMm: base.wallMm });
  }

  // Pockets before ribs, matching the order the fields are declared in
  // `PartDefinition`, so the report reads in the order the part was described.
  const topZ = topFaceZMm(base);
  const solid = baseIsSolid(base);
  for (const pocket of part.pockets ?? []) {
    if (solid) {
      const floorMm = topZ - pocket.cutDepthMm;
      // <= 0 is a through pocket: there is no floor left to be too thin.
      if (floorMm > 0) walls.push({ id: `pocket:${pocket.id}.floor`, thicknessMm: floorMm });
    }
    const gapMm = Math.min(
      pocket.centerXMm - pocket.widthMm / 2 - footprint.minXMm,
      footprint.maxXMm - (pocket.centerXMm + pocket.widthMm / 2),
      pocket.centerYMm - pocket.depthMm / 2 - footprint.minYMm,
      footprint.maxYMm - (pocket.centerYMm + pocket.depthMm / 2),
    );
    // <= 0 means the pocket runs out through the side, which is a slot, not a
    // wall that is too thin.
    if (gapMm > 0) walls.push({ id: `pocket:${pocket.id}.wall`, thicknessMm: gapMm });
  }

  for (const rib of part.ribs ?? []) {
    walls.push({ id: `rib:${rib.id}`, thicknessMm: rib.thicknessMm });
  }

  return walls;
}

/** Flatten a modelled part into the description the DFM rules read. */
export function describeModelledPart(part: ModelledPart, options: DeriveOptions = {}): DerivedPart {
  const geometry = options.geometry ?? generatePartFeatureScript(part).geometry;
  const footprint = baseFootprintMm(part.base);

  const holes: HoleFeature[] = [];
  const smallFeatures: SmallFeature[] = [...(options.smallFeatures ?? [])];
  const diameterTargets = new Map<string, DiameterTarget>();

  const specs = part.holes ?? [];
  specs.forEach((spec, index) => {
    const instances = geometry.holes.filter((hole) => hole.holeId === spec.id);
    if (!instances.length) return;
    let closestEdgeMm = Infinity;
    for (const instance of instances) {
      closestEdgeMm = Math.min(closestEdgeMm, distanceToEdgeMm(instance.xMm, instance.yMm, footprint));
    }

    const holeId = `hole:${spec.id}`;
    holes.push({
      id: holeId,
      kind: "plain",
      nominalDiameterMm: spec.diameterMm,
      centerToEdgeMm: closestEdgeMm,
      depthMm: spec.depthMm,
      through: spec.through !== false,
    });
    diameterTargets.set(holeId, {
      path: `holes.${index}.diameterMm`,
      label: `hole "${spec.id}" (${instances.length} place${instances.length === 1 ? "" : "s"})`,
    });

    const counterbore = spec.counterbore;
    if (!counterbore) return;
    const counterboreId = `${holeId}.counterbore`;
    holes.push({
      id: counterboreId,
      kind: "plain",
      nominalDiameterMm: counterbore.diameterMm,
      centerToEdgeMm: closestEdgeMm,
      depthMm: counterbore.depthMm,
      through: false,
    });
    diameterTargets.set(counterboreId, {
      path: `holes.${index}.counterbore.diameterMm`,
      label: `counterbore on hole "${spec.id}"`,
    });
    // The seat the bolt head lands on is an annulus this wide. Below one bead it
    // is not a seat at all.
    const ledgeMm = (counterbore.diameterMm - spec.diameterMm) / 2;
    if (ledgeMm > 0) {
      smallFeatures.push({ id: `${holeId}.counterboreLedge`, minDimensionMm: ledgeMm, kind: "other" });
    }
  });

  const inserts: InsertFeature[] = [];
  const bossInserts = new Map<string, { insert: HeatSetInsert; inferred: boolean }>();
  const unresolvedBosses: UnresolvedBoss[] = [];
  const bosses = part.bosses ?? [];
  bosses.forEach((boss, index) => {
    const featureId = `boss:${boss.id}`;
    const bossWallMm = (boss.outerDiameterMm - boss.insertDiameterMm) / 2;
    const named = options.inserts?.[boss.id];
    const insert = named ? requireInsert(named) : inferInsertForBore(boss.insertDiameterMm);
    if (!insert) {
      unresolvedBosses.push({
        bossId: boss.id,
        boreDiameterMm: boss.insertDiameterMm,
        boreDepthMm: boss.insertDepthMm,
        bossWallMm,
      });
      return;
    }
    inserts.push({ id: featureId, insert: insert.id, boreDepthMm: boss.insertDepthMm, bossWallMm });
    bossInserts.set(featureId, { insert, inferred: !named });
    diameterTargets.set(featureId, {
      path: `bosses.${index}.insertDiameterMm`,
      label: `boss "${boss.id}" insert bore (${insert.id})`,
    });
  });

  const overhangs: OverhangFeature[] = [...(options.overhangs ?? [])];
  for (const edge of part.edges ?? []) {
    // "corners" selects the vertical edges only, which produces no overhang.
    // "all" reaches the bottom perimeter, and the base sits on Z = 0.
    if (edge.selection !== "all") continue;
    overhangs.push({
      id: `edge:${edge.id}.bottom`,
      angleFromVerticalDeg:
        edge.kind === "fillet" ? FILLET_ANGLE_FROM_VERTICAL_DEG : CHAMFER_ANGLE_FROM_VERTICAL_DEG,
      spanMm: edge.sizeMm,
    });
  }

  const description: PartDefinition = {
    name: part.name,
    boundingBoxMm: { x: geometry.sizeMm.xMm, y: geometry.sizeMm.yMm, z: geometry.sizeMm.zMm },
    walls: deriveWalls(part, footprint),
    holes,
    inserts,
    overhangs,
    smallFeatures,
  };

  return { description, geometry, footprintMm: footprint, diameterTargets, bossInserts, unresolvedBosses };
}
