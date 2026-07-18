/**
 * Active FRC season year for strategy / kickoff / CAD rule tools.
 *
 * Priority:
 * 1. Explicit seasonYear (caller or events_ref.year)
 * 2. Year prefix of org active_event_key (e.g. 2027nysu → 2027)
 * 3. Year prefix of selected matchKey
 * 4. Calendar FRC season (championship year; Sep+ rolls forward)
 *
 * Never use an arbitrary year from chat text — that mixes prior-season rules.
 */

export type SeasonResolveInput = {
  seasonYear?: number | null;
  activeEventKey?: string | null;
  matchKey?: string | null;
  now?: Date;
};

export function isValidSeasonYear(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1992 && value <= 2100;
}

/** Parse leading YYYY from TBA event/match keys (`2027nysu`, `2027nysu_qm12`). */
export function seasonYearFromEventKey(eventOrMatchKey: string | null | undefined): number | null {
  if (!eventOrMatchKey) return null;
  const match = /^(\d{4})/.exec(eventOrMatchKey.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return isValidSeasonYear(year) ? year : null;
}

/** FRC championship year; fall kickoff (Sep+) belongs to the next spring season. */
export function calendarSeasonYear(now: Date = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

export function resolveActiveSeasonYear(input: SeasonResolveInput = {}): number {
  if (isValidSeasonYear(input.seasonYear)) return input.seasonYear;
  const fromEvent = seasonYearFromEventKey(input.activeEventKey);
  if (fromEvent != null) return fromEvent;
  const fromMatch = seasonYearFromEventKey(input.matchKey);
  if (fromMatch != null) return fromMatch;
  return calendarSeasonYear(input.now);
}

/** True when a tool payload's seasonYear matches the locked active season. */
export function isSameSeasonYear(payloadSeason: unknown, activeSeasonYear: number): boolean {
  if (payloadSeason == null || payloadSeason === "") return true;
  const year = Number(payloadSeason);
  return isValidSeasonYear(year) && year === activeSeasonYear;
}
