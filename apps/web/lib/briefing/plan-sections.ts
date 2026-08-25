// Pure parsers for the saved strategy-plan JSONB (match_strategies.plan).
//
// computeStrategyView persists a rich plan: { playbook, matchup, tendencies,
// operations, scoutProvenance }. The original briefing only read `playbook`;
// these helpers defensively read `operations` (per-robot scout-derived
// capabilities — the form-builder role bridge output) and `tendencies`
// (opponent labels + evidence) so the ONE briefing shows the org's own
// scouting without recomputing anything. Unknown/partial JSON degrades to
// empty arrays — the UI then shows honest "no scouting yet" hints.

import type { BriefingScoutedTeam, BriefingTendency } from "./types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function num01(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
}

function finiteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, max);
}

/** Per-robot scouted capabilities from plan.operations, or [] when absent. */
export function normalizePlanOperations(planJson: unknown): BriefingScoutedTeam[] {
  const plan = asRecord(planJson);
  if (!plan || !Array.isArray(plan.operations)) return [];
  const rows: BriefingScoutedTeam[] = [];
  for (const entry of plan.operations) {
    const record = asRecord(entry);
    if (!record) continue;
    const teamKey = typeof record.teamKey === "string" ? record.teamKey.trim() : "";
    if (!teamKey) continue;
    const scoutSample = Number(record.scoutSample);
    rows.push({
      teamKey,
      scoutSample: Number.isFinite(scoutSample) && scoutSample > 0 ? Math.floor(scoutSample) : 0,
      autoCapability: num01(record.autoCapability),
      teleopCapability: num01(record.teleopCapability),
      endgameCapability: num01(record.endgameCapability),
      defenseLikely: typeof record.defenseLikely === "boolean" ? record.defenseLikely : null,
      foulRate: finiteOrNull(record.foulRate),
      pitNotes: stringList(record.pitNotes, 4),
    });
  }
  return rows.slice(0, 12);
}

/** Opponent tendency labels/evidence from plan.tendencies, or [] when absent. */
export function normalizePlanTendencies(planJson: unknown): BriefingTendency[] {
  const plan = asRecord(planJson);
  if (!plan || !Array.isArray(plan.tendencies)) return [];
  const rows: BriefingTendency[] = [];
  for (const entry of plan.tendencies) {
    const record = asRecord(entry);
    if (!record) continue;
    const teamKey = typeof record.teamKey === "string" ? record.teamKey.trim() : "";
    if (!teamKey) continue;
    const labels = stringList(record.labels, 6);
    const evidence = stringList(record.evidence, 6);
    if (!labels.length && !evidence.length) continue;
    rows.push({ teamKey, labels, evidence });
  }
  return rows.slice(0, 6);
}

/** Split scouted rows into our alliance vs opponents, preserving lineup order. */
export function splitScoutedByAlliance(
  rows: BriefingScoutedTeam[],
  ourKeys: string[],
  opponentKeys: string[],
): { allies: BriefingScoutedTeam[]; opponents: BriefingScoutedTeam[] } {
  const byKey = new Map(rows.map((row) => [row.teamKey, row]));
  const pick = (keys: string[]) =>
    keys
      .map((key) => byKey.get(key))
      .filter((row): row is BriefingScoutedTeam => Boolean(row && row.scoutSample > 0));
  return { allies: pick(ourKeys), opponents: pick(opponentKeys) };
}

/** Human label for a 0–1 scout capability score; null hides the chip. */
export function capabilityLabel(value: number | null): string | null {
  if (value == null) return null;
  if (value >= 0.75) return "strong";
  if (value >= 0.45) return "solid";
  if (value > 0) return "developing";
  return "not shown";
}

/** frc1234 → 1234, or null for malformed keys. */
export function teamNumberFromKey(teamKey: string): number | null {
  const match = /^frc(\d+)$/.exec(teamKey);
  return match ? Number(match[1]) : null;
}
