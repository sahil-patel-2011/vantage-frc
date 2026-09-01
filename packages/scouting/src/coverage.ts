export type CoverageCell = {
  matchKey: string;
  teamKey: string;
  assignmentCount: number;
  entryCount: number;
};

export type CoverageSlotInput = CoverageCell & {
  matchNumber: number;
  compLevel: string;
  /** Playoff set number; qualification matches normally use 1. */
  setNumber?: number;
  alliance?: "red" | "blue";
  scoutNames?: string[];
  scoutUserIds?: string[];
  eventTime?: string | null;
};

export type CoverageGapStatus = "unscouted" | "assigned" | "covered" | "double";

export type CoverageGapSlot = CoverageSlotInput & {
  status: CoverageGapStatus;
  teamNumber: number | null;
};

export type CoverageGapSummary = {
  totalSlots: number;
  unscouted: number;
  assignedWaiting: number;
  covered: number;
  doubleCovered: number;
  coverageRate: number | null;
  doubleRate: number | null;
};

function teamNumberFromKey(teamKey: string): number | null {
  const match = /^frc(\d+)$/i.exec(teamKey);
  return match ? Number(match[1]) : null;
}

export function coverageState(cell: CoverageCell): "missing" | "assigned" | "covered" | "double_covered" {
  if (cell.entryCount > 1) return "double_covered";
  if (cell.entryCount === 1) return "covered";
  if (cell.assignmentCount > 0) return "assigned";
  return "missing";
}

export function toGapStatus(cell: CoverageCell): CoverageGapStatus {
  const state = coverageState(cell);
  if (state === "double_covered") return "double";
  if (state === "missing") return "unscouted";
  if (state === "assigned") return "assigned";
  return "covered";
}

export function buildCoverageGapBoard(slots: CoverageSlotInput[]): CoverageGapSlot[] {
  return slots
    .map((slot) => ({
      ...slot,
      status: toGapStatus(slot),
      teamNumber: teamNumberFromKey(slot.teamKey),
      scoutNames: slot.scoutNames ?? [],
      scoutUserIds: slot.scoutUserIds ?? [],
    }))
    .sort((a, b) => {
      const level = (a.compLevel === "qm" ? 0 : 1) - (b.compLevel === "qm" ? 0 : 1);
      if (level) return level;
      if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
      if (a.alliance !== b.alliance) return (a.alliance === "red" ? 0 : 1) - (b.alliance === "red" ? 0 : 1);
      return (a.teamNumber ?? 0) - (b.teamNumber ?? 0);
    });
}

export function summarizeCoverageGaps(slots: Array<{ status: CoverageGapStatus }>): CoverageGapSummary {
  let unscouted = 0;
  let assignedWaiting = 0;
  let covered = 0;
  let doubleCovered = 0;
  for (const slot of slots) {
    if (slot.status === "unscouted") unscouted++;
    else if (slot.status === "assigned") assignedWaiting++;
    else if (slot.status === "double") doubleCovered++;
    else covered++;
  }
  const totalSlots = slots.length;
  const withEntry = covered + doubleCovered;
  return {
    totalSlots,
    unscouted,
    assignedWaiting,
    covered,
    doubleCovered,
    coverageRate: totalSlots ? withEntry / totalSlots : null,
    doubleRate: totalSlots ? doubleCovered / totalSlots : null,
  };
}

export function focusLiveCoverage(
  slots: CoverageGapSlot[],
  options?: { matchKey?: string | null; windowSize?: number },
): {
  focusMatchKeys: string[];
  focusSlots: CoverageGapSlot[];
  gapSlots: CoverageGapSlot[];
  doubleSlots: CoverageGapSlot[];
} {
  const windowSize = Math.max(1, Math.trunc(options?.windowSize ?? 4));
  const orderedKeys: string[] = [];
  for (const slot of slots) {
    if (!orderedKeys.includes(slot.matchKey)) orderedKeys.push(slot.matchKey);
  }
  let start = 0;
  if (options?.matchKey) {
    const index = orderedKeys.indexOf(options.matchKey);
    if (index >= 0) start = index;
  }
  const focusMatchKeys = orderedKeys.slice(start, start + windowSize);
  const focusSet = new Set(focusMatchKeys);
  const focusSlots = slots.filter((slot) => focusSet.has(slot.matchKey));
  return {
    focusMatchKeys,
    focusSlots,
    gapSlots: focusSlots.filter((slot) => slot.status === "unscouted" || slot.status === "assigned"),
    doubleSlots: focusSlots.filter((slot) => slot.status === "double"),
  };
}
