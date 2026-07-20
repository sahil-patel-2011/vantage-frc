// Pure, framework-free diff/severity math for CAD Change Impact Radar. Everything here is
// deterministic and grounded only in the two parameter snapshots the caller supplies — it never
// fabricates a value. compute-cad-change-radar.ts wraps this with DB I/O; the API route and
// client render results.

import type { CadChangeRadarParamDelta, CadChangeRadarSeverity } from "./types";

export const CAD_CHANGE_RADAR_SEVERITIES: CadChangeRadarSeverity[] = ["minor", "moderate", "major"];

/** Tracked-parameter keys the radar recognizes as high-impact for mount/interface compatibility. */
export const CAD_CHANGE_RADAR_CRITICAL_PARAMS = new Set([
  "mass_kg",
  "envelope_length_mm",
  "envelope_width_mm",
  "envelope_height_mm",
  "mount_hole_pattern",
  "gear_ratio",
  "bore_diameter_mm",
]);

/** Percent-change diff between two raw param values; null when either side is non-numeric or missing. */
function percentChange(from: number | string | null, to: number | string | null): number | null {
  const a = typeof from === "number" ? from : Number(from);
  const b = typeof to === "number" ? to : Number(to);
  if (from == null || to == null || !Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

/** Diffs two flat parameter maps into a list of per-key deltas (additions, removals, changes only). */
export function diffParams(
  fromParams: Record<string, number | string> | null,
  toParams: Record<string, number | string>,
): CadChangeRadarParamDelta[] {
  const from = fromParams ?? {};
  const keys = new Set([...Object.keys(from), ...Object.keys(toParams)]);
  const deltas: CadChangeRadarParamDelta[] = [];
  for (const key of keys) {
    const fromValue = Object.prototype.hasOwnProperty.call(from, key) ? from[key]! : null;
    const toValue = Object.prototype.hasOwnProperty.call(toParams, key) ? toParams[key]! : null;
    if (fromValue === toValue) continue;
    if (fromValue != null && toValue != null && String(fromValue) === String(toValue)) continue;
    deltas.push({ key, fromValue, toValue, percentChange: percentChange(fromValue, toValue) });
  }
  return deltas.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Deterministic severity from the changed-param set: any critical-param change with >=15% delta
 * (or any critical param add/remove) is major; any other critical-param touch is moderate;
 * everything else is minor. Mirrors the recorded thresholds used for notification fan-out.
 */
export function classifySeverity(deltas: CadChangeRadarParamDelta[]): CadChangeRadarSeverity {
  let touchesCritical = false;
  for (const delta of deltas) {
    if (!CAD_CHANGE_RADAR_CRITICAL_PARAMS.has(delta.key)) continue;
    touchesCritical = true;
    if (delta.fromValue == null || delta.toValue == null) return "major";
    if (delta.percentChange != null && Math.abs(delta.percentChange) >= 15) return "major";
  }
  if (touchesCritical) return "moderate";
  return deltas.length > 0 ? "minor" : "minor";
}

/** Plain-language, deterministic (non-AI) fallback summary of a diff — used when AI is unavailable. */
export function summarizeDiffDeterministic(input: {
  partName: string;
  toRevision: string;
  deltas: CadChangeRadarParamDelta[];
}): string {
  if (input.deltas.length === 0) return `${input.partName} revision ${input.toRevision}: no tracked-parameter change.`;
  const parts = input.deltas.slice(0, 4).map((delta) => {
    if (delta.fromValue == null) return `${delta.key} added (${delta.toValue})`;
    if (delta.toValue == null) return `${delta.key} removed`;
    if (delta.percentChange != null) {
      const sign = delta.percentChange >= 0 ? "+" : "";
      return `${delta.key} ${delta.fromValue} → ${delta.toValue} (${sign}${delta.percentChange.toFixed(1)}%)`;
    }
    return `${delta.key} ${delta.fromValue} → ${delta.toValue}`;
  });
  const more = input.deltas.length > 4 ? ` and ${input.deltas.length - 4} more` : "";
  return `${input.partName} revision ${input.toRevision}: ${parts.join(", ")}${more}.`;
}

/** Notification message fanned out to a subscriber for a given diff. */
export function buildNotificationMessage(input: {
  partName: string;
  toRevision: string;
  severity: CadChangeRadarSeverity;
  summary: string;
}): string {
  const tag = input.severity === "major" ? "Major change" : input.severity === "moderate" ? "Change" : "Minor change";
  return `${tag} on ${input.partName} (rev ${input.toRevision}): ${input.summary}`;
}
