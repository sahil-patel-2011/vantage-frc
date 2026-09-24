/**
 * What the team already knows about its next match, for the pit TV: the stored win
 * prediction and the tendencies the strategy engine saved with the match plan (from scouting
 * and public metrics — packages/prediction-strategy/src/signals.ts). Read-only, never
 * invented: a match with no stored prediction or plan shows neither.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { normalizePlanTendencies } from "../briefing/plan-sections";

export type DisplayTeamIntel = { teamKey: string; tags: string[] };

export type DisplayMatchIntel = {
  matchKey: string;
  /** Our chance to win, 0–100, when a prediction is stored. */
  ourWinPct: number | null;
  ourColor: "red" | "blue" | null;
  teams: DisplayTeamIntel[];
};

/** Plain words a pit crew can read from across the pit. Labels without a phrase are dropped. */
const TAG_WORDS: Record<string, string> = {
  "autonomous-leaning": "Strong auto",
  "scout-auto-capable": "Scores in auto",
  "scout-teleop-capable": "Scores in teleop",
  "endgame-leaning": "Strong endgame",
  "scout-endgame-capable": "Does the endgame",
  "defense-capable": "Plays defense",
  "contact-aware": "Physical",
  "foul-prone": "Draws fouls",
  "reliability-risk": "Breaks down sometimes",
};

export function intelTags(labels: readonly string[]): string[] {
  const out: string[] = [];
  for (const label of labels) {
    const words = TAG_WORDS[label];
    if (words && !out.includes(words)) out.push(words);
  }
  return out.slice(0, 3);
}

type RawIntel = {
  matchKey?: string;
  prediction?: { pRed?: number | null; pBlue?: number | null } | null;
  plan?: { alliance?: string | null; tendencies?: unknown } | null;
} | null;

/** The function's / query's JSON → what the TV draws. */
export function toDisplayMatchIntel(raw: RawIntel, ownTeamKey: string | null, schedule: { red: string[]; blue: string[] } | null): DisplayMatchIntel | null {
  if (!raw?.matchKey) return null;
  const onRed = ownTeamKey ? schedule?.red.includes(ownTeamKey) : false;
  const onBlue = ownTeamKey ? schedule?.blue.includes(ownTeamKey) : false;
  const planColor = raw.plan?.alliance === "red" || raw.plan?.alliance === "blue" ? raw.plan.alliance : null;
  const ourColor = onRed ? "red" : onBlue ? "blue" : planColor;
  const p = ourColor === "red" ? raw.prediction?.pRed : ourColor === "blue" ? raw.prediction?.pBlue : null;
  const ourWinPct = typeof p === "number" && Number.isFinite(p) ? Math.round(p * 100) : null;
  const teams = normalizePlanTendencies({ tendencies: raw.plan?.tendencies ?? [] })
    .map((row) => ({ teamKey: row.teamKey, tags: intelTags(row.labels) }))
    .filter((row) => row.tags.length > 0);
  return { matchKey: raw.matchKey, ourWinPct, ourColor, teams };
}

/**
 * Only what the TV draws: win chances and, per team, the engine's labels. Evidence text, entry
 * ids and timestamps stay on the server, because a TV link sits in a browser that anyone at
 * the pit can pick up.
 */
export function publicMatchIntel(raw: unknown): RawIntel {
  const value = raw as RawIntel;
  if (!value?.matchKey) return null;
  const p = value.prediction;
  const tendencies = Array.isArray(value.plan?.tendencies) ? (value.plan!.tendencies as unknown[]) : [];
  return {
    matchKey: value.matchKey,
    prediction:
      p && typeof p.pRed === "number" && typeof p.pBlue === "number" ? { pRed: p.pRed, pBlue: p.pBlue } : null,
    plan: value.plan
      ? {
          alliance: value.plan.alliance === "red" || value.plan.alliance === "blue" ? value.plan.alliance : null,
          tendencies: tendencies
            .map((row) => row as { teamKey?: unknown; labels?: unknown })
            .filter((row) => typeof row?.teamKey === "string")
            .map((row) => ({
              teamKey: row.teamKey as string,
              labels: Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === "string").slice(0, 6) : [],
              evidence: [],
            })),
        }
      : null,
  };
}

/** Signed-in path (a pit laptop logged in as a member): the same read under RLS. */
export async function loadDisplayMatchIntel(client: PoolClient, orgId: string, matchKey: string): Promise<RawIntel> {
  const row = (
    await client.query<{ intel: RawIntel }>(
      `SELECT jsonb_build_object(
                'matchKey', $2::text,
                'prediction', (
                  SELECT jsonb_build_object('pRed', p.p_red, 'pBlue', p.p_blue)
                    FROM predictions p
                   WHERE p.org_id = $1::uuid AND p.match_key = $2::text
                   ORDER BY p.scored_at DESC LIMIT 1),
                'plan', (
                  SELECT jsonb_build_object('alliance', s.alliance, 'tendencies', COALESCE(s.plan -> 'tendencies', '[]'::jsonb))
                    FROM match_strategies s
                   WHERE s.org_id = $1::uuid AND s.match_key = $2::text
                   ORDER BY s.updated_at DESC LIMIT 1)
              ) AS intel
         FROM org_active_context c
         JOIN matches_ref m ON m.match_key = $2::text AND m.event_key = c.active_event_key
        WHERE c.org_id = $1::uuid`,
      [orgId, matchKey],
    )
  ).rows[0];
  return row?.intel ?? null;
}
