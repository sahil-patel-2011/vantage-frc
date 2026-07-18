// Shooter / launcher lookup table. Teams tune a set of distance -> (flywheel RPM,
// hood angle) points, then interpolate between them on the field to hit shots from
// anywhere. This stores the calibrated points and does the linear interpolation
// that teams otherwise bury in a spreadsheet.

export type ShooterPointInput = { distanceFt: number; rpm: number | null; hoodAngle: number | null; notes: string };

function optNonNeg(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${field} must be zero or greater`);
  return parsed;
}

export function validatePoint(raw: Record<string, unknown>): { ok: true; value: ShooterPointInput } | { ok: false; error: string } {
  const distance = Number(raw.distanceFt);
  if (!Number.isFinite(distance) || distance <= 0) return { ok: false, error: "Distance must be greater than zero" };
  let rpm: number | null;
  let hoodAngle: number | null;
  try {
    rpm = optNonNeg(raw.rpm, "RPM");
    hoodAngle = optNonNeg(raw.hoodAngle, "Hood angle");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Invalid number" };
  }
  if (rpm == null && hoodAngle == null) return { ok: false, error: "Enter at least an RPM or a hood angle" };
  return {
    ok: true,
    value: { distanceFt: Math.round(distance * 100) / 100, rpm, hoodAngle, notes: typeof raw.notes === "string" ? raw.notes.trim() : "" },
  };
}

export type ShooterPoint = { distanceFt: number; rpm: number | null; hoodAngle: number | null };

function lerp(x: number, x0: number, y0: number, x1: number, y1: number) {
  if (x1 === x0) return y0;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

function interpField(points: { distanceFt: number; value: number }[], distance: number): number | null {
  if (points.length === 0) return null;
  if (distance <= points[0]!.distanceFt) return round2(points[0]!.value);
  const last = points[points.length - 1]!;
  if (distance >= last.distanceFt) return round2(last.value);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (distance >= a.distanceFt && distance <= b.distanceFt) {
      return round2(lerp(distance, a.distanceFt, a.value, b.distanceFt, b.value));
    }
  }
  return null;
}

/**
 * Linear-interpolates RPM and hood angle at a query distance from the calibrated
 * points. Clamps to the nearest endpoint outside the calibrated range (and flags
 * that as extrapolation). Each field interpolates only over points that define it.
 */
export function interpolateShot(points: ShooterPoint[], distanceFt: number) {
  const sorted = [...points].sort((a, b) => a.distanceFt - b.distanceFt);
  const rpmPoints = sorted.filter((p) => p.rpm != null).map((p) => ({ distanceFt: p.distanceFt, value: p.rpm as number }));
  const anglePoints = sorted.filter((p) => p.hoodAngle != null).map((p) => ({ distanceFt: p.distanceFt, value: p.hoodAngle as number }));
  const within = sorted.length > 0 && distanceFt >= sorted[0]!.distanceFt && distanceFt <= sorted[sorted.length - 1]!.distanceFt;
  return {
    rpm: interpField(rpmPoints, distanceFt),
    hoodAngle: interpField(anglePoints, distanceFt),
    extrapolated: sorted.length > 0 && !within,
  };
}

export function summarizeTable(points: ShooterPoint[]) {
  const distances = points.map((p) => p.distanceFt).sort((a, b) => a - b);
  return {
    count: points.length,
    minDistanceFt: distances[0] ?? null,
    maxDistanceFt: distances[distances.length - 1] ?? null,
  };
}

// ---- request validation --------------------------------------------------

export type ShooterAction =
  | ({ action: "save_point"; orgId: string; seasonYear: number; tableName: string } & ShooterPointInput)
  | { action: "delete_point"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseShooterAction(raw: unknown): ShooterAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "save_point": {
      const validated = validatePoint(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      const tableName = typeof body.tableName === "string" && body.tableName.trim() ? body.tableName.trim() : "Shooter";
      return { action: "save_point", orgId, seasonYear, tableName, ...validated.value };
    }
    case "delete_point":
      return { action: "delete_point", orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported shooter action");
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
