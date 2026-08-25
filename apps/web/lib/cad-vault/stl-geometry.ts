/**
 * STL parsing and geometry summary — pure over Uint8Array (works in node tests
 * and in the browser preview). STL carries no units, so every quantity is
 * reported in the file's own (unknown) units and labeled that way in the UI.
 * Never fabricates values: formats we cannot parse simply have no geometry.
 */

import { isAsciiStl, isBinaryStl } from "./format-detect";

export const MAX_STL_TRIANGLES = 2_000_000;

export class StlTooLargeError extends Error {
  constructor(readonly triangleCount: number) {
    super(`STL has ${triangleCount.toLocaleString()} triangles — above the ${MAX_STL_TRIANGLES.toLocaleString()} parse limit.`);
    this.name = "StlTooLargeError";
  }
}

export class StlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StlParseError";
  }
}

/** Flat triangle soup: 9 floats per triangle (v0x v0y v0z v1x … v2z). */
export type StlTriangles = Float32Array;

export type StlGeometrySummary = {
  triangleCount: number;
  /** Axis-aligned bounding box in file units. */
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  /** Absolute enclosed volume (signed-tetrahedron sum) in file units cubed. */
  volume: number;
  /** Total surface area in file units squared. */
  surfaceArea: number;
  /** Triangles with (near-)zero area. */
  degenerateTriangleCount: number;
  /** STL files carry no units; all quantities are in the file's own units. */
  units: "unknown";
};

export type ParseStlOptions = { maxTriangles?: number };

export function parseStl(data: Uint8Array, options: ParseStlOptions = {}): StlTriangles {
  const maxTriangles = options.maxTriangles ?? MAX_STL_TRIANGLES;
  if (isBinaryStl(data)) return parseBinaryStl(data, maxTriangles);
  if (isAsciiStl(data)) return parseAsciiStl(data, maxTriangles);
  throw new StlParseError("Not a valid STL file (neither binary nor ASCII structure found).");
}

function parseBinaryStl(data: Uint8Array, maxTriangles: number): StlTriangles {
  const triangleCount = (data.length - 84) / 50;
  if (triangleCount > maxTriangles) throw new StlTooLargeError(triangleCount);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Float32Array(triangleCount * 9);
  for (let t = 0; t < triangleCount; t++) {
    const base = 84 + t * 50 + 12; // skip the 12-byte facet normal
    for (let f = 0; f < 9; f++) out[t * 9 + f] = view.getFloat32(base + f * 4, true);
  }
  return out;
}

function parseAsciiStl(data: Uint8Array, maxTriangles: number): StlTriangles {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const vertexPattern = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const coords: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = vertexPattern.exec(text)) !== null) {
    coords.push(Number(match[1]), Number(match[2]), Number(match[3]));
    if (coords.length > maxTriangles * 9) throw new StlTooLargeError(Math.floor(coords.length / 9));
  }
  if (coords.length === 0 || coords.length % 9 !== 0) {
    throw new StlParseError("ASCII STL has an incomplete facet — vertex count is not a multiple of three.");
  }
  if (coords.some((value) => !Number.isFinite(value))) {
    throw new StlParseError("ASCII STL contains non-numeric vertex coordinates.");
  }
  return Float32Array.from(coords);
}

const DEGENERATE_AREA_EPSILON = 1e-12;

export function summarizeTriangles(triangles: StlTriangles): StlGeometrySummary {
  const triangleCount = triangles.length / 9;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let signedVolume = 0;
  let surfaceArea = 0;
  let degenerateTriangleCount = 0;

  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    const ax = triangles[o]!, ay = triangles[o + 1]!, az = triangles[o + 2]!;
    const bx = triangles[o + 3]!, by = triangles[o + 4]!, bz = triangles[o + 5]!;
    const cx = triangles[o + 6]!, cy = triangles[o + 7]!, cz = triangles[o + 8]!;

    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] as const) {
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }

    // Signed volume of tetrahedron (origin, a, b, c) = dot(a, cross(b, c)) / 6.
    signedVolume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
    if (area <= DEGENERATE_AREA_EPSILON) degenerateTriangleCount += 1;
    else surfaceArea += area;
  }

  if (triangleCount === 0) {
    return {
      triangleCount: 0,
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
      volume: 0,
      surfaceArea: 0,
      degenerateTriangleCount: 0,
      units: "unknown",
    };
  }

  return {
    triangleCount,
    boundingBox: { min, max },
    volume: Math.abs(signedVolume),
    surfaceArea,
    degenerateTriangleCount,
    units: "unknown",
  };
}

export function computeStlGeometry(data: Uint8Array, options: ParseStlOptions = {}): StlGeometrySummary {
  return summarizeTriangles(parseStl(data, options));
}
