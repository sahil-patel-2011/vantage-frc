/**
 * Lovat auto-path playhead: sample each robot at t, then flag pairs closer
 * than two robot radii. Missing paths stay null — never invent a route.
 */

export const ROBOT_RADIUS_IN = 12;

export type PathPoint = { t: number; x: number; y: number };

export type PlayheadConflict = {
  pair: [number, number];
  distance: number;
};

export function interpolatePath(points: readonly PathPoint[], t: number): PathPoint | null {
  if (points.length === 0) return null;
  if (points.length === 1) return points[0]!;
  const lo = points[0]!;
  const hi = points[points.length - 1]!;
  if (t <= lo.t) return lo;
  if (t >= hi.t) return hi;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      const u = span === 0 ? 0 : (t - a.t) / span;
      return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
    }
  }
  return hi;
}

export function playheadSample(paths: readonly (readonly PathPoint[])[], t: number): Array<PathPoint | null> {
  return paths.map((path) => interpolatePath(path, t));
}

const PATH_KEYS = ["autoPath", "auto_path", "path", "waypoints", "poses", "autoWaypoints"] as const;

function asFinite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function pointFromUnknown(value: unknown, index: number): PathPoint | null {
  if (Array.isArray(value)) {
    if (value.length >= 3) {
      const t = asFinite(value[0]);
      const x = asFinite(value[1]);
      const y = asFinite(value[2]);
      if (t == null || x == null || y == null) return null;
      return { t, x, y };
    }
    if (value.length === 2) {
      const x = asFinite(value[0]);
      const y = asFinite(value[1]);
      if (x == null || y == null) return null;
      return { t: index, x, y };
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const x = asFinite(row.x) ?? asFinite(row.X);
  const y = asFinite(row.y) ?? asFinite(row.Y);
  if (x == null || y == null) return null;
  const t = asFinite(row.t) ?? asFinite(row.time) ?? index;
  return { t, x, y };
}

/** Real waypoint list only — a single point is a pose, not a path. */
export function pathFromUnknown(value: unknown): PathPoint[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const points: PathPoint[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const point = pointFromUnknown(value[index], index);
    if (!point) return null;
    points.push(point);
  }
  return points;
}

/** Pull auto paths from scout payloads. Missing keys stay empty — never invented. */
export function pathsFromScoutPayloads(payloads: Array<Record<string, unknown>>): PathPoint[][] {
  const paths: PathPoint[][] = [];
  for (const payload of payloads) {
    for (const key of PATH_KEYS) {
      const path = pathFromUnknown(payload[key]);
      if (path) paths.push(path);
    }
    const auto = payload.auto;
    if (auto && typeof auto === "object" && !Array.isArray(auto)) {
      const nested = pathFromUnknown((auto as Record<string, unknown>).path);
      if (nested) paths.push(nested);
    }
  }
  return paths;
}

/** Field size in the same units as the logged points. */
export function fieldBoundsForPaths(paths: readonly (readonly PathPoint[])[]): { width: number; height: number } {
  const points = paths.flat();
  const maxX = Math.max(0, ...points.map((point) => point.x));
  const maxY = Math.max(0, ...points.map((point) => point.y));
  if (maxX <= 60 && maxY <= 32) return { width: 54, height: 27 };
  return { width: 648, height: 324 };
}

export function playheadRange(paths: readonly (readonly PathPoint[])[]): { min: number; max: number } | null {
  const times = paths.flat().map((point) => point.t).filter((value) => Number.isFinite(value));
  if (times.length < 2) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (max <= min) return null;
  return { min, max };
}

export function playheadConflicts(
  paths: readonly (readonly PathPoint[])[],
  t: number,
  radius = ROBOT_RADIUS_IN,
): PlayheadConflict[] {
  const samples = playheadSample(paths, t);
  const hits: PlayheadConflict[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const a = samples[i];
      const b = samples[j];
      if (!a || !b) continue;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < radius * 2) hits.push({ pair: [i, j], distance });
    }
  }
  return hits;
}
