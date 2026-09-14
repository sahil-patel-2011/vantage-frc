/**
 * Lovat scouter assignment: pick first and last match, then fill every
 * official match in between. Slots come from the real schedule — we never
 * invent qm numbers that are not on the board.
 */

export type CompLevel = "qm" | "ef" | "qf" | "sf" | "f" | "unknown";

export type ParsedMatchKey = {
  raw: string;
  eventKey: string;
  compLevel: CompLevel;
  setNumber: number;
  matchNumber: number;
  sortKey: number;
};

const COMP_ORDER: Record<CompLevel, number> = {
  qm: 0,
  ef: 1,
  qf: 2,
  sf: 3,
  f: 4,
  unknown: 5,
};

const QUAL = /^([0-9]{4}[a-z0-9]+)_qm(\d+)$/i;
const BRACKET = /^([0-9]{4}[a-z0-9]+)_(ef|qf|sf|f)(\d+)m(\d+)$/i;

export function parseMatchKey(matchKey: string | null | undefined): ParsedMatchKey | null {
  if (!matchKey || typeof matchKey !== "string") return null;
  const raw = matchKey.trim();
  if (!raw) return null;
  const qual = QUAL.exec(raw);
  if (qual) {
    const matchNumber = Number(qual[2]);
    if (!Number.isInteger(matchNumber) || matchNumber < 1) return null;
    return {
      raw,
      eventKey: (qual[1] ?? "").toLowerCase(),
      compLevel: "qm",
      setNumber: 1,
      matchNumber,
      sortKey: COMP_ORDER.qm * 1_000_000 + matchNumber,
    };
  }
  const bracket = BRACKET.exec(raw);
  if (bracket) {
    const level = (bracket[2] ?? "").toLowerCase() as CompLevel;
    const setNumber = Number(bracket[3]);
    const matchNumber = Number(bracket[4]);
    if (!Number.isInteger(setNumber) || !Number.isInteger(matchNumber)) return null;
    return {
      raw,
      eventKey: (bracket[1] ?? "").toLowerCase(),
      compLevel: level,
      setNumber,
      matchNumber,
      sortKey: (COMP_ORDER[level] ?? 5) * 1_000_000 + setNumber * 1_000 + matchNumber,
    };
  }
  return null;
}

export function compareParsedMatches(a: ParsedMatchKey, b: ParsedMatchKey): number {
  if (a.eventKey !== b.eventKey) return a.eventKey.localeCompare(b.eventKey);
  return a.sortKey - b.sortKey;
}

export function isQualMatch(matchKey: string): boolean {
  return parseMatchKey(matchKey)?.compLevel === "qm";
}

export type AssignmentRangeInput = {
  firstMatchKey: string;
  lastMatchKey: string;
  teamKey: string;
  matchKeys: readonly string[];
  qualsOnly?: boolean;
};

export type AssignmentRangeSlot = {
  matchKey: string;
  teamKey: string;
  matchNumber: number;
  compLevel: CompLevel;
};

export type AssignmentRangeResult =
  | { ok: true; slots: AssignmentRangeSlot[]; skipped: string[] }
  | { ok: false; error: string; slots: AssignmentRangeSlot[]; skipped: string[] };

function normalizeTeamKey(teamKey: string): string | null {
  const trimmed = teamKey.trim();
  if (!trimmed) return null;
  if (/^frc\d+[a-z]?$/i.test(trimmed)) return `frc${trimmed.slice(3)}`;
  if (/^\d+[a-z]?$/i.test(trimmed)) return `frc${trimmed}`;
  return null;
}

export function expandAssignmentRange(input: AssignmentRangeInput): AssignmentRangeResult {
  const teamKey = normalizeTeamKey(input.teamKey);
  if (!teamKey) return { ok: false, error: "Choose which robot this scout is covering.", slots: [], skipped: [] };

  const first = parseMatchKey(input.firstMatchKey);
  const last = parseMatchKey(input.lastMatchKey);
  if (!first || !last) {
    return { ok: false, error: "First and last match have to be real schedule keys.", slots: [], skipped: [] };
  }
  if (first.eventKey !== last.eventKey) {
    return { ok: false, error: "First and last match must be at the same event.", slots: [], skipped: [] };
  }
  if (compareParsedMatches(first, last) > 0) {
    return { ok: false, error: "Last match is before the first match.", slots: [], skipped: [] };
  }

  const skipped: string[] = [];
  const seen = new Set<string>();
  const parsed: ParsedMatchKey[] = [];
  for (const raw of input.matchKeys) {
    const match = parseMatchKey(raw);
    if (!match) {
      skipped.push(raw);
      continue;
    }
    if (match.eventKey !== first.eventKey) {
      skipped.push(raw);
      continue;
    }
    if (input.qualsOnly !== false && match.compLevel !== "qm") {
      skipped.push(raw);
      continue;
    }
    if (seen.has(match.raw)) continue;
    seen.add(match.raw);
    parsed.push(match);
  }
  parsed.sort(compareParsedMatches);

  const slots: AssignmentRangeSlot[] = [];
  for (const match of parsed) {
    if (compareParsedMatches(match, first) < 0) continue;
    if (compareParsedMatches(match, last) > 0) continue;
    slots.push({
      matchKey: match.raw,
      teamKey,
      matchNumber: match.matchNumber,
      compLevel: match.compLevel,
    });
  }

  if (slots.length === 0) {
    return { ok: false, error: "No official matches sit between those two keys.", slots, skipped };
  }
  return { ok: true, slots, skipped };
}

export type CompactAssignment = {
  userId: string;
  teamKey: string;
  firstMatchKey: string;
  lastMatchKey: string;
  matchCount: number;
};

/**
 * Collapse per-match rows into first–last ranges for the same scout + robot.
 * Gaps break the range so we do not hide a hole in the schedule.
 */
export function compactAssignments(
  rows: Array<{ userId: string; teamKey: string; matchKey: string }>,
): CompactAssignment[] {
  const groups = new Map<string, ParsedMatchKey[]>();
  for (const row of rows) {
    const parsed = parseMatchKey(row.matchKey);
    if (!parsed) continue;
    const key = `${row.userId}::${row.teamKey}`;
    const list = groups.get(key) ?? [];
    list.push(parsed);
    groups.set(key, list);
  }

  const ranges: CompactAssignment[] = [];
  for (const [key, matches] of groups) {
    const [userId, teamKey] = key.split("::");
    if (!userId || !teamKey) continue;
    const ordered = [...matches].sort(compareParsedMatches);
    let start = ordered[0];
    let prev = ordered[0];
    if (!start || !prev) continue;
    const flush = (from: ParsedMatchKey, to: ParsedMatchKey, count: number) => {
      ranges.push({
        userId,
        teamKey,
        firstMatchKey: from.raw,
        lastMatchKey: to.raw,
        matchCount: count,
      });
    };
    let count = 1;
    for (let index = 1; index < ordered.length; index += 1) {
      const current = ordered[index];
      if (!current) continue;
      const adjacent = current.sortKey === prev.sortKey + 1 && current.compLevel === prev.compLevel;
      if (adjacent) {
        prev = current;
        count += 1;
        continue;
      }
      flush(start, prev, count);
      start = current;
      prev = current;
      count = 1;
    }
    flush(start, prev, count);
  }
  return ranges.sort((a, b) => a.firstMatchKey.localeCompare(b.firstMatchKey) || a.teamKey.localeCompare(b.teamKey));
}

export function rangeLabel(range: CompactAssignment): string {
  if (range.firstMatchKey === range.lastMatchKey) return range.firstMatchKey;
  return `${range.firstMatchKey} → ${range.lastMatchKey}`;
}

export function uniqueMatchKeys(slots: Array<{ matchKey: string }>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const slot of slots) {
    if (seen.has(slot.matchKey)) continue;
    seen.add(slot.matchKey);
    keys.push(slot.matchKey);
  }
  return keys.sort((a, b) => {
    const left = parseMatchKey(a);
    const right = parseMatchKey(b);
    if (left && right) return compareParsedMatches(left, right);
    return a.localeCompare(b);
  });
}
