import type { PickCandidate, PickDataMode, PickTier } from "@vantage/prediction-strategy";
import type { PickAssistDrift } from "./pick-assist";

/** Alliance Selection timer — captains get 45 seconds per pick. */
export const PICK_CLOCK_SECONDS = 45;

export type PickClockReasonTone = "strong" | "caution" | "neutral";

export type PickClockReason = {
  /** Short line readable at a glance under time pressure. */
  label: string;
  tone: PickClockReasonTone;
};

export type PickClockListHint = {
  teamKey: string;
  rank: number;
  tier: string | null;
  notes: string | null;
  listName: string | null;
};

export type PickClockRecommendation = {
  teamKey: string;
  teamNumber: number | null;
  nickname: string | null;
  suggestedTier: PickTier | null;
  listRank: number | null;
  listName: string | null;
  /** One-line primary "why this pick". */
  headline: string;
  reasons: PickClockReason[];
  epa: number | null;
  autoEpa: number | null;
  endgameEpa: number | null;
  rank: number | null;
  record: string | null;
  reliability: number | null;
  foulRate: number | null;
  scoutSample: number;
  /** Present when last-3 alliance share diverges from season rating. */
  epaDrift: PickAssistDrift | null;
};

export type PickClockResult = {
  recommendation: PickClockRecommendation | null;
  alternates: PickClockRecommendation[];
  availableCount: number;
  excludedCount: number;
};

export type PickClockReasonOptions = {
  pickMode?: PickDataMode;
  epaDrift?: PickAssistDrift | null;
};

function teamLabel(candidate: PickCandidate): string {
  if (candidate.teamNumber != null) return String(candidate.teamNumber);
  return candidate.teamKey.replace(/^frc/i, "") || candidate.teamKey;
}

function tierLabel(tier: PickTier | string | null): string | null {
  if (!tier) return null;
  if (tier === "first") return "1st-round caliber";
  if (tier === "second") return "2nd-round caliber";
  if (tier === "third") return "3rd-round caliber";
  if (tier === "watch") return "Watch-list tier";
  return null;
}

function formatEpa(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Build glanceable "why" lines from pick-desk signals only — never invent metrics.
 * Prefers pick-list position, then rating tier / reliability / foul risk / event rank.
 * Surfaces rating-drift and low-data event mode when provided.
 */
export function buildPickReasons(
  candidate: PickCandidate,
  listHint: PickClockListHint | null,
  options?: PickClockReasonOptions,
): { headline: string; reasons: PickClockReason[] } {
  const reasons: PickClockReason[] = [];
  let headline: string | null = null;
  const pickMode = options?.pickMode ?? "full";
  const drift = options?.epaDrift ?? null;

  if (listHint) {
    const listBit = listHint.listName ? ` on ${listHint.listName}` : " on your pick list";
    headline = `#${listHint.rank}${listBit}`;
    reasons.push({
      label: listHint.notes?.trim()
        ? `List note: ${listHint.notes.trim().slice(0, 80)}`
        : `Ranked #${listHint.rank}${listBit}`,
      tone: "strong",
    });
  }

  if (pickMode === "low_data_tba" && !listHint) {
    const epaText = formatEpa(candidate.epa);
    headline = epaText ? `Quick pick · season score ${epaText}` : "Quick pick";
    reasons.push({
      label: "Low scout coverage — ranking from event numbers",
      tone: "caution",
    });
  }

  const tier = tierLabel(candidate.suggestedTier);
  const epaText = formatEpa(candidate.epa);
  if (tier && epaText) {
    const line = `${tier} · Rating ${epaText}`;
    if (!headline) headline = line;
    reasons.push({ label: line, tone: candidate.suggestedTier === "first" ? "strong" : "neutral" });
  } else if (epaText) {
    const line = `Rating ${epaText}`;
    if (!headline) headline = line;
    reasons.push({ label: line, tone: "neutral" });
  } else if (tier) {
    if (!headline) headline = tier;
    reasons.push({ label: tier, tone: "neutral" });
  }

  if (drift?.divergent) {
    const short =
      drift.delta > 0
        ? `Rating lag · recent ~${drift.recentAverage.toFixed(0)} > rating ${drift.seasonEpa.toFixed(0)}`
        : `Rating lag · recent ~${drift.recentAverage.toFixed(0)} < rating ${drift.seasonEpa.toFixed(0)}`;
    reasons.unshift({ label: short, tone: "caution" });
    if (!listHint && pickMode !== "low_data_tba") {
      headline = short;
    }
  }

  // In low-data mode, skip scout reliability/foul lines — they are thin or absent.
  if (pickMode === "full" && candidate.reliability != null && Number.isFinite(candidate.reliability)) {
    const score = Math.round(candidate.reliability);
    if (score >= 80) {
      reasons.push({ label: `High reliability ${score}`, tone: "strong" });
      if (!headline) headline = `Reliable pick (${score})`;
    } else if (score < 65) {
      reasons.push({ label: `Reliability caution ${score}`, tone: "caution" });
    } else {
      reasons.push({ label: `Reliability ${score}`, tone: "neutral" });
    }
  }

  if (pickMode === "full" && candidate.foulRate != null && Number.isFinite(candidate.foulRate)) {
    const rate = candidate.foulRate;
    const shown = rate < 1 ? rate.toFixed(2) : rate.toFixed(1);
    if (rate >= 1.5) {
      reasons.push({ label: `Foul risk ${shown}/match`, tone: "caution" });
    } else if (rate <= 0.4) {
      reasons.push({ label: `Low foul rate ${shown}`, tone: "strong" });
    } else {
      reasons.push({ label: `Foul rate ${shown}`, tone: "neutral" });
    }
  }

  if (candidate.rank != null && Number.isFinite(candidate.rank)) {
    reasons.push({
      label: candidate.record ? `Event rank #${candidate.rank} · ${candidate.record}` : `Event rank #${candidate.rank}`,
      tone: candidate.rank <= 8 ? "strong" : "neutral",
    });
    if (!headline) headline = `Event rank #${candidate.rank}`;
  }

  if (pickMode === "full") {
    if (candidate.scoutSample === 0) {
      reasons.push({ label: "No scout sample yet — event numbers only", tone: "caution" });
    } else if (candidate.scoutSample > 0 && candidate.scoutSample < 3) {
      reasons.push({ label: `Thin scout sample (${candidate.scoutSample})`, tone: "caution" });
    }
  }

  const endgame = formatEpa(candidate.endgameEpa);
  if (endgame && (candidate.endgameEpa ?? 0) >= 8) {
    reasons.push({ label: `Endgame rating ${endgame}`, tone: "neutral" });
  }

  // Cap to what fits on a glance screen; keep drift first when present.
  const trimmed = reasons.slice(0, 4);
  return {
    headline: headline ?? `Team ${teamLabel(candidate)}`,
    reasons: trimmed,
  };
}

function toRecommendation(
  candidate: PickCandidate,
  listHint: PickClockListHint | null,
  options?: PickClockReasonOptions,
): PickClockRecommendation {
  const { headline, reasons } = buildPickReasons(candidate, listHint, options);
  return {
    teamKey: candidate.teamKey,
    teamNumber: candidate.teamNumber,
    nickname: candidate.nickname,
    suggestedTier: candidate.suggestedTier,
    listRank: listHint?.rank ?? null,
    listName: listHint?.listName ?? null,
    headline,
    reasons,
    epa: candidate.epa,
    autoEpa: candidate.autoEpa,
    endgameEpa: candidate.endgameEpa,
    rank: candidate.rank,
    record: candidate.record,
    reliability: candidate.reliability,
    foulRate: candidate.foulRate,
    scoutSample: candidate.scoutSample,
    epaDrift: options?.epaDrift ?? null,
  };
}

/**
 * Next best pick for the 45-second clock.
 * Prefer the highest remaining pick-list entry; otherwise the top ranked
 * pick-desk candidate (rating tier + reliability/foul adjustments already applied).
 */
export function recommendNextPick(input: {
  candidates: PickCandidate[];
  excludedTeamKeys?: Iterable<string>;
  pickListEntries?: PickClockListHint[];
  alternateCount?: number;
  pickMode?: PickDataMode;
  epaDrifts?: PickAssistDrift[];
}): PickClockResult {
  const excluded = new Set(input.excludedTeamKeys ?? []);
  const available = input.candidates.filter((c) => !excluded.has(c.teamKey));
  const byKey = new Map(available.map((c) => [c.teamKey, c]));
  const driftMap = new Map((input.epaDrifts ?? []).map((row) => [row.teamKey, row]));
  const pickMode = input.pickMode ?? "full";

  const listHints = [...(input.pickListEntries ?? [])]
    .filter((entry) => byKey.has(entry.teamKey))
    .sort((a, b) => a.rank - b.rank || a.teamKey.localeCompare(b.teamKey));

  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const hint of listHints) {
    if (seen.has(hint.teamKey)) continue;
    orderedKeys.push(hint.teamKey);
    seen.add(hint.teamKey);
  }
  // Fall through to pick-desk ranking (candidates are already sorted by rankPickCandidates).
  for (const candidate of available) {
    if (seen.has(candidate.teamKey)) continue;
    orderedKeys.push(candidate.teamKey);
    seen.add(candidate.teamKey);
  }

  const hintByKey = new Map(listHints.map((h) => [h.teamKey, h]));
  const alternateCount = Math.max(0, input.alternateCount ?? 2);
  const picks: PickClockRecommendation[] = [];
  for (const key of orderedKeys) {
    const candidate = byKey.get(key);
    if (!candidate) continue;
    picks.push(
      toRecommendation(candidate, hintByKey.get(key) ?? null, {
        pickMode,
        epaDrift: driftMap.get(key) ?? null,
      }),
    );
    if (picks.length >= 1 + alternateCount) break;
  }

  return {
    recommendation: picks[0] ?? null,
    alternates: picks.slice(1),
    availableCount: available.length,
    excludedCount: excluded.size,
  };
}

/** Remaining seconds clamped for display; null clock = not started. */
export function clockRemaining(startedAtMs: number | null, nowMs: number, duration = PICK_CLOCK_SECONDS): number | null {
  if (startedAtMs == null) return null;
  const elapsed = Math.floor((nowMs - startedAtMs) / 1000);
  return Math.max(0, duration - elapsed);
}

export function clockUrgency(remaining: number | null): "idle" | "ok" | "warn" | "critical" {
  if (remaining == null) return "idle";
  if (remaining <= 10) return "critical";
  if (remaining <= 20) return "warn";
  return "ok";
}
