/**
 * Student-facing next-match score line and drivers.
 * Red/Blue are two alliance totals, never a dash "range".
 */

import { typicalScoreErrorCopy } from "@vantage/prediction-strategy";

const usable = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Two alliance totals, each with the doubt that belongs to *this* match.
 *
 * It used to read "Red 94 · Blue 81 · typical error ±4 (last measured set)" —
 * one number describing how the model does on average, printed identically on
 * a match between robots with a season of history and one between robots
 * nobody has watched. The average is a fact about the model; a person reading
 * a card before a match is asking about the match.
 *
 * `redBand` / `blueBand` are preferred when the caller has them. The old line
 * is kept as the fallback rather than dropped, because a stored prediction
 * from before this change has only `errorBand`, and printing nothing would be
 * worse than printing what it knew.
 */
export function nextMatchScoreLine(input: {
  redPredicted: number;
  bluePredicted: number;
  errorBand?: number | null;
  redBand?: number | null;
  blueBand?: number | null;
}): string {
  const red = Math.round(input.redPredicted);
  const blue = Math.round(input.bluePredicted);

  if (usable(input.redBand) && usable(input.blueBand)) {
    return `Red ${red} ±${Math.round(input.redBand)} · Blue ${blue} ±${Math.round(input.blueBand)}`;
  }

  const band = usable(input.errorBand) ? ` · ${typicalScoreErrorCopy(input.errorBand)}` : "";
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
