import type { MatchBriefContent, MatchBriefMove, MatchBriefOpponent } from "./types";

const MAX_TEXT = 600;

function text(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function firstJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * The model's reply → a brief, or null when it isn't usable. The win chance always comes from the
 * prediction (`winChance`), never the model, and the teams named must be the six in this match.
 */
export function parseMatchBrief(
  raw: string,
  facts: { winChance: number; teams: string[] },
): MatchBriefContent | null {
  const value = firstJsonObject(raw) as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return null;
  const allowed = new Set(facts.teams);
  const headline = text(value.headline, 160);
  const raiseOdds: MatchBriefMove[] = (Array.isArray(value.raiseOdds) ? value.raiseOdds : [])
    .slice(0, 6)
    .flatMap((row) => {
      const item = row as Record<string, unknown>;
      const action = text(item.action, 200);
      const why = text(item.why);
      if (!action || !why) return [];
      const gain = typeof item.gain === "number" && Number.isFinite(item.gain) ? Math.round(item.gain * 10) / 10 : null;
      return [{ action, why, gain }];
    });
  const opponents: MatchBriefOpponent[] = (Array.isArray(value.opponents) ? value.opponents : [])
    .slice(0, 3)
    .flatMap((row) => {
      const item = row as Record<string, unknown>;
      const team = text(String(item.team ?? "").replace(/^frc/i, ""), 8);
      const likely = text(item.likely);
      const how = text(item.how);
      const counter = text(item.counter);
      if (!team || !allowed.has(team) || !likely || !counter) return [];
      return [{ team, likely, how: how ?? "", counter }];
    });
  const partners = (Array.isArray(value.partners) ? value.partners : []).slice(0, 3).flatMap((row) => {
    const item = row as Record<string, unknown>;
    const team = text(String(item.team ?? "").replace(/^frc/i, ""), 8);
    const role = text(item.role, 300);
    return team && allowed.has(team) && role ? [{ team, role }] : [];
  });
  const phasesRaw = (value.phases ?? {}) as Record<string, unknown>;
  const phases = { auto: text(phasesRaw.auto) ?? "", teleop: text(phasesRaw.teleop) ?? "", endgame: text(phasesRaw.endgame) ?? "" };
  const watchFor = (Array.isArray(value.watchFor) ? value.watchFor : []).slice(0, 5).flatMap((row) => {
    const line = text(row, 300);
    return line ? [line] : [];
  });
  if (!headline || raiseOdds.length === 0) return null;
  return { headline, winChance: facts.winChance, raiseOdds, opponents, partners, phases, watchFor };
}
