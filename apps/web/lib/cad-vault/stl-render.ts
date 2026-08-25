/**
 * Pure isometric software rasterizer for STL triangle soups. Shared by the
 * server thumbnail encoder (sharp) and the in-browser canvas preview so both
 * draw exactly the same parse result. RGBA output; no DOM, no node APIs.
 */

import type { StlTriangles } from "./stl-geometry";

export type RasterResult = {
  data: Uint8ClampedArray; // RGBA, width * height * 4
  width: number;
  height: number;
};

// Isometric-ish view direction and basis vectors.
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

/** Project a point into isometric screen space: returns [sx, sy, depth]. */
function project(x: number, y: number, z: number): [number, number, number] {
  const sx = (x - y) * COS30;
  const sy = (x + y) * SIN30 - z;
  const depth = x + y + z;
  return [sx, sy, depth];
}

const LIGHT: [number, number, number] = [0.5, -0.35, 0.79]; // normalized-ish

export type RasterOptions = {
  size?: number;
  /** RGB base color of lit facets. */
  color?: [number, number, number];
  /** RGBA background (default fully transparent). */
  background?: [number, number, number, number];
};

export function rasterizeStl(triangles: StlTriangles, options: RasterOptions = {}): RasterResult {
  const size = options.size ?? 220;
  const color = options.color ?? [122, 149, 255];
  const background = options.background ?? [0, 0, 0, 0];

  const data = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    data[p * 4] = background[0];
    data[p * 4 + 1] = background[1];
    data[p * 4 + 2] = background[2];
    data[p * 4 + 3] = background[3];
  }
  const result: RasterResult = { data, width: size, height: size };
  const triangleCount = triangles.length / 9;
  if (triangleCount === 0) return result;

  // Projected bounds for framing.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let t = 0; t < triangleCount; t++) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const [sx, sy] = project(triangles[o]!, triangles[o + 1]!, triangles[o + 2]!);
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(span) || span <= 0) return result;
  const margin = size * 0.08;
  const scale = (size - margin * 2) / span;
  const offsetX = margin + ((size - margin * 2) - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = margin + ((size - margin * 2) - (maxY - minY) * scale) / 2 - minY * scale;

  const zbuffer = new Float32Array(size * size).fill(-Infinity);
  const lightLen = Math.hypot(...LIGHT);

  for (let t = 0; t < triangleCount; t++) {
    const o = t * 9;
    const ax = triangles[o]!, ay = triangles[o + 1]!, az = triangles[o + 2]!;
    const bx = triangles[o + 3]!, by = triangles[o + 4]!, bz = triangles[o + 5]!;
    const cx = triangles[o + 6]!, cy = triangles[o + 7]!, cz = triangles[o + 8]!;

    // Facet normal for flat shading.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen === 0) continue;
    nx /= nLen; ny /= nLen; nz /= nLen;
    const lambert = Math.abs((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / lightLen);
    const shade = 0.35 + 0.65 * lambert;

    const [pax, pay, pad] = project(ax, ay, az);
    const [pbx, pby, pbd] = project(bx, by, bz);
    const [pcx, pcy, pcd] = project(cx, cy, cz);
    const x0 = pax * scale + offsetX, y0 = pay * scale + offsetY;
    const x1 = pbx * scale + offsetX, y1 = pby * scale + offsetY;
    const x2 = pcx * scale + offsetX, y2 = pcy * scale + offsetY;

    const minPx = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxPx = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minPy = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxPy = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (denom === 0) continue;

    for (let py = minPy; py <= maxPy; py++) {
      for (let px = minPx; px <= maxPx; px++) {
        const w0 = ((y1 - y2) * (px + 0.5 - x2) + (x2 - x1) * (py + 0.5 - y2)) / denom;
        const w1 = ((y2 - y0) * (px + 0.5 - x2) + (x0 - x2) * (py + 0.5 - y2)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = w0 * pad + w1 * pbd + w2 * pcd;
        const idx = py * size + px;
        if (depth <= zbuffer[idx]!) continue;
        zbuffer[idx] = depth;
        data[idx * 4] = Math.round(color[0] * shade);
        data[idx * 4 + 1] = Math.round(color[1] * shade);
        data[idx * 4 + 2] = Math.round(color[2] * shade);
        data[idx * 4 + 3] = 255;
      }
    }
  }

  return result;
}
