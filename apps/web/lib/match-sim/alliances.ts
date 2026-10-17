/**
 * Playoff alliances to predict, from the team's alliance selection board.
 *
 * During alliance selection there is no playoff schedule yet, so the match list has nothing to
 * pick. The board the team fills in at selection (Pick list → Run alliance selection) already says
 * who is on each alliance; this turns it into "Alliance 1 vs Alliance 8". Once the playoff
 * matches are posted, the schedule list on Predict carries them like any other match.
 *
 * Pure (no I/O) so the Predict page can import it; the database read is load-alliances.ts.
 */
export type PlayoffAlliance = {
  seed: number;
  /** Captain, first pick, second pick, in that order; empty slots left out. */
  teamKeys: string[];
};

export type PlayoffAlliancesView =
  | { status: "ready"; eventKey: string; boardName: string; updatedAt: string; alliances: PlayoffAlliance[] }
  | { status: "empty"; eventKey: string | null };

const SLOT_ORDER: Record<string, number> = { captain: 0, first: 1, second: 2 };

export type BoardSlotRow = { allianceSeed: number | null; pickSlot: string | null; teamKey: string | null };

/** Groups the board's slots into alliances, best seed first. Only alliances with a team on them. */
export function groupAllianceSlots(rows: BoardSlotRow[]): PlayoffAlliance[] {
  const bySeed = new Map<number, Array<{ order: number; teamKey: string }>>();
  for (const row of rows) {
    const seed = Number(row.allianceSeed);
    const teamKey = typeof row.teamKey === "string" ? row.teamKey.trim().toLowerCase() : "";
    if (!Number.isInteger(seed) || seed < 1 || seed > 8 || !/^frc\d+$/.test(teamKey)) continue;
    const list = bySeed.get(seed) ?? [];
    if (!list.some((slot) => slot.teamKey === teamKey)) list.push({ order: SLOT_ORDER[row.pickSlot ?? ""] ?? 9, teamKey });
    bySeed.set(seed, list);
  }
  return [...bySeed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([seed, slots]) => ({ seed, teamKeys: slots.sort((a, b) => a.order - b.order).map((slot) => slot.teamKey) }));
}

/**
 * Which two alliances to show first: ours against the alliance it would meet in the first
 * round of an eight-alliance bracket (1–8, 2–7, 3–6, 4–5), else the top two seeds.
 */
export function defaultMatchup(alliances: PlayoffAlliance[], teamKey: string | null): [number, number] | null {
  if (alliances.length < 2) return null;
  const seeds = alliances.map((alliance) => alliance.seed);
  const ours = teamKey ? alliances.find((alliance) => alliance.teamKeys.includes(teamKey))?.seed ?? null : null;
  if (ours != null) {
    const opponent = 9 - ours;
    if (opponent !== ours && seeds.includes(opponent)) return [ours, opponent];
    const other = seeds.find((seed) => seed !== ours);
    return other != null ? [ours, other] : null;
  }
  return [seeds[0]!, seeds[1]!];
}
