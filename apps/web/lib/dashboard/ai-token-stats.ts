/**
 * Shape real ai_usage_events rows into dashboard token stats.
 * Never invents a count — missing days are zeros, missing models stay null.
 */

export const AI_TOKEN_WINDOW_DAYS = 30;
export const AI_TOKEN_SPARK_DAYS = 7;

export type TokenDayRow = {
  day: string;
  tokens: number;
  calls: number;
};

export type TokenModelRow = {
  model: string;
  tokens: number;
  calls: number;
};

export type TokenTeamRow = {
  orgId: string;
  name: string;
  teamNumber: number | null;
  tokens: number;
  calls: number;
  mostUsed: string | null;
  lastUsedAt: string | null;
};

export function safeTokenCount(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function formatTokenCount(value: number): string {
  const count = safeTokenCount(value);
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function pickMostUsedModel(rows: readonly TokenModelRow[]): TokenModelRow | null {
  let best: TokenModelRow | null = null;
  for (const row of rows) {
    const tokens = safeTokenCount(row.tokens);
    const calls = safeTokenCount(row.calls);
    if (tokens <= 0 && calls <= 0) continue;
    if (
      !best ||
      tokens > best.tokens ||
      (tokens === best.tokens && calls > best.calls)
    ) {
      best = { model: row.model, tokens, calls };
    }
  }
  return best;
}

/** Dense last-N-days sparkline ending at `end` (UTC YYYY-MM-DD). */
export function fillTokenSpark(
  rows: readonly TokenDayRow[],
  end: string,
  days = AI_TOKEN_SPARK_DAYS,
): TokenDayRow[] {
  const byDay = new Map<string, TokenDayRow>();
  for (const row of rows) {
    if (!row.day) continue;
    const existing = byDay.get(row.day) ?? { day: row.day, tokens: 0, calls: 0 };
    existing.tokens += safeTokenCount(row.tokens);
    existing.calls += safeTokenCount(row.calls);
    byDay.set(row.day, existing);
  }
  const series: TokenDayRow[] = [];
  const parsed = new Date(`${end}T00:00:00.000Z`);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(parsed);
    day.setUTCDate(parsed.getUTCDate() - offset);
    const key = day.toISOString().slice(0, 10);
    series.push(byDay.get(key) ?? { day: key, tokens: 0, calls: 0 });
  }
  return series;
}

export function rankTeamsByTokens(rows: readonly TokenTeamRow[]): TokenTeamRow[] {
  return [...rows]
    .map((row) => ({
      ...row,
      tokens: safeTokenCount(row.tokens),
      calls: safeTokenCount(row.calls),
      mostUsed: row.mostUsed?.trim() || null,
    }))
    .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls);
}

/** Compact model slug for tiles — never invents a name for an unknown model. */
export function shortModelLabel(model: string | null | undefined): string {
  const raw = model?.trim();
  if (!raw) return "—";
  const slash = raw.lastIndexOf("/");
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}
