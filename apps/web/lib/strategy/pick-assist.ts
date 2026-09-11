import type { PoolClient } from "@neondatabase/serverless";
import { epaDrift } from "@vantage/scouting/trust";
import type { PickCandidate, PickDataMode } from "@vantage/prediction-strategy";

export type PickAssistDrift = {
  teamKey: string;
  seasonEpa: number;
  recentAverage: number;
  delta: number;
  divergent: boolean;
  /** Glanceable callout; only set when divergent. */
  label: string;
};

type AllianceBlob = {
  score?: number | null;
  teamKeys?: string[] | null;
};

/**
 * Last scored matches → per-team alliance-share proxies (alliance score / alliance size).
 * Comparable-ish to season rating for lag detection; never invents rows without match results.
 */
export async function loadRecentAllianceShares(
  client: PoolClient,
  eventKey: string,
  teamKeys: string[],
  limitPerTeam = 3,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!teamKeys.length) return out;

  const matches = await client.query<{
    redAlliance: AllianceBlob;
    blueAlliance: AllianceBlob;
  }>(
    `SELECT red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
     FROM matches_ref
     WHERE event_key = $1
       AND (
         (red_alliance->>'score') IS NOT NULL
         OR (blue_alliance->>'score') IS NOT NULL
       )
     ORDER BY COALESCE(actual_time, predicted_time, event_time) DESC NULLS LAST
     LIMIT 400`,
    [eventKey],
  );

  const wanted = new Set(teamKeys);
  for (const match of matches.rows) {
    for (const alliance of [match.redAlliance, match.blueAlliance]) {
      const score = Number(alliance?.score);
      const keys = (alliance?.teamKeys ?? []).filter((key): key is string => typeof key === "string");
      if (!Number.isFinite(score) || keys.length === 0) continue;
      const share = score / keys.length;
      for (const teamKey of keys) {
        if (!wanted.has(teamKey)) continue;
        const list = out.get(teamKey) ?? [];
        if (list.length >= limitPerTeam) continue;
        list.push(share);
        out.set(teamKey, list);
      }
    }
    let complete = true;
    for (const teamKey of wanted) {
      if ((out.get(teamKey)?.length ?? 0) < limitPerTeam) {
        complete = false;
        break;
      }
    }
    if (complete) break;
  }
  return out;
}

export function buildEpaDriftCallouts(
  candidates: Array<Pick<{ teamKey: string; epa: number | null }, "teamKey" | "epa">>,
  recentByTeam: Map<string, number[]>,
): PickAssistDrift[] {
  const callouts: PickAssistDrift[] = [];
  for (const candidate of candidates) {
    if (candidate.epa == null || !Number.isFinite(candidate.epa)) continue;
    const recent = recentByTeam.get(candidate.teamKey) ?? [];
    const drift = epaDrift({ seasonEpa: candidate.epa, recentScores: recent });
    if (!drift?.divergent) continue;
    const direction = drift.delta > 0 ? "above" : "below";
    const recentText = Number.isInteger(drift.recentAverage)
      ? String(drift.recentAverage)
      : drift.recentAverage.toFixed(1);
    const epaText = Number.isInteger(candidate.epa) ? String(candidate.epa) : candidate.epa.toFixed(1);
    const deltaText = `${drift.delta > 0 ? "+" : ""}${drift.delta.toFixed(1)}`;
    callouts.push({
      teamKey: candidate.teamKey,
      seasonEpa: candidate.epa,
      recentAverage: drift.recentAverage,
      delta: drift.delta,
      divergent: true,
      label: `Rating may lag — last-${recent.length} share ~${recentText} (${deltaText}) ${direction} rating ${epaText}`,
    });
  }
  return callouts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.teamKey.localeCompare(b.teamKey));
}

export function pickModeSources(mode: PickDataMode, baseSources: string[]): string[] {
  if (mode === "low_data_tba") {
    const tagged = [...baseSources.filter(Boolean), "low_data_tba"];
    return [...new Set(tagged)];
  }
  return baseSources;
}

export function driftByTeamKey(drifts: PickAssistDrift[]): Map<string, PickAssistDrift> {
  return new Map(drifts.map((row) => [row.teamKey, row]));
}

/** Attach drift metadata used by pick-clock / draft without inventing ratings. */
export function candidateWithDrift(
  candidate: PickCandidate,
  drift: PickAssistDrift | undefined,
): PickCandidate & { epaDrift: PickAssistDrift | null } {
  return { ...candidate, epaDrift: drift ?? null };
}
