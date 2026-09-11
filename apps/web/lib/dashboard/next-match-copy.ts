/**
 * Student-facing next-match score line and drivers.
 * Red/Blue are two alliance totals, never a dash "range".
 */

import { typicalScoreErrorCopy } from "@vantage/prediction-strategy";

export function nextMatchScoreLine(input: {
  redPredicted: number;
  bluePredicted: number;
  errorBand?: number | null;
}): string {
  const red = Math.round(input.redPredicted);
  const blue = Math.round(input.bluePredicted);
  const band =
    typeof input.errorBand === "number" && Number.isFinite(input.errorBand)
      ? ` · ${typicalScoreErrorCopy(input.errorBand)}`
      : "";
  return `Red ${red} · Blue ${blue}${band}`;
}

function asDriverList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .map((line) => line.trim())
    .slice(0, 3);
}

/** Prefer live score drivers; stored key-factor rows are a fallback. */
export function nextMatchDriverLines(data: Record<string, unknown>): string[] {
  const live = asDriverList(data.scoreDrivers);
  if (live.length) return live;
  if (!Array.isArray(data.keyFactors)) return [];
  const lines: string[] = [];
  for (const factor of data.keyFactors) {
    if (typeof factor === "string" && factor.trim()) {
      lines.push(factor.trim());
      continue;
    }
    if (!factor || typeof factor !== "object") continue;
    const record = factor as { name?: unknown; impact?: unknown };
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const impact = typeof record.impact === "string" ? record.impact.trim() : "";
    const line = [name, impact].filter(Boolean).join(" — ");
    if (line) lines.push(line);
  }
  return lines.slice(0, 3);
}
