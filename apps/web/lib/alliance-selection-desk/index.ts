import type { DeskConflictFlag, DeskPickSlot, DeskSlot } from "./types";

export type {
  DeskAlliance,
  DeskConflictFlag,
  DeskEvidence,
  DeskEvidenceKind,
  DeskExportSnapshot,
  DeskMember,
  DeskPickSlot,
  DeskSessionStatus,
  DeskSessionSummary,
  DeskSetupStep,
  DeskSlot,
} from "./types";

export {
  attachDeskEvidence,
  computeAllianceSelectionDeskView,
  createDeskExport,
  createDeskSession,
  removeDeskEvidence,
  setDeskSlotTeam,
  updateDeskSession,
  type AllianceSelectionDeskView,
} from "./compute-alliance-selection-desk";

export function teamNumberFromKey(teamKey: string | null | undefined): number | null {
  if (!teamKey) return null;
  const m = /^frc(\d+)$/i.exec(teamKey.trim());
  return m ? Number(m[1]) : null;
}

export function normalizeTeamKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^frc\d+$/i.test(trimmed)) return `frc${trimmed.slice(3)}`;
  if (/^\d+$/.test(trimmed)) return `frc${trimmed}`;
  return null;
}

/** Pure conflict detection — no DEMO metrics; only flags when real TBA/scout rows exist. */
export function detectDeskConflicts(input: {
  slots: Array<Pick<DeskSlot, "id" | "allianceSeed" | "pickSlot" | "teamKey" | "tbaRank" | "tbaEpa" | "matchScoutCount" | "pitScoutCount">>;
  eventHasTbaMetrics: boolean;
}): DeskConflictFlag[] {
  const flags: DeskConflictFlag[] = [];
  const taken = new Map<string, { allianceSeed: number; pickSlot: DeskPickSlot; slotId: string }>();

  for (const slot of input.slots) {
    if (!slot.teamKey) continue;

    const prior = taken.get(slot.teamKey);
    if (prior) {
      flags.push({
        id: `dup-${slot.id}`,
        severity: "block",
        code: "duplicate_pick",
        message: `${slot.teamKey} is already on alliance ${prior.allianceSeed} (${prior.pickSlot}).`,
        teamKey: slot.teamKey,
        allianceSeed: slot.allianceSeed,
        pickSlot: slot.pickSlot,
      });
    } else {
      taken.set(slot.teamKey, {
        allianceSeed: slot.allianceSeed,
        pickSlot: slot.pickSlot,
        slotId: slot.id,
      });
    }

    if (input.eventHasTbaMetrics && slot.tbaRank == null && slot.tbaEpa == null) {
      flags.push({
        id: `missing-tba-${slot.id}`,
        severity: "warn",
        code: "missing_tba_metrics",
        message: `${slot.teamKey} has no event ratings for this event — confirm they are attending.`,
        teamKey: slot.teamKey,
        allianceSeed: slot.allianceSeed,
        pickSlot: slot.pickSlot,
      });
    }

    if (slot.matchScoutCount === 0 && slot.pitScoutCount === 0) {
      flags.push({
        id: `no-scout-${slot.id}`,
        severity: "info",
        code: "no_scout_evidence",
        message: `${slot.teamKey} has no match or pit scout entries attached for this event yet.`,
        teamKey: slot.teamKey,
        allianceSeed: slot.allianceSeed,
        pickSlot: slot.pickSlot,
      });
    }
  }

  return flags;
}

export function groupSlotsByAlliance(slots: DeskSlot[]): Array<{ seed: number; slots: DeskSlot[] }> {
  const bySeed = new Map<number, DeskSlot[]>();
  for (const slot of slots) {
    const list = bySeed.get(slot.allianceSeed) ?? [];
    list.push(slot);
    bySeed.set(slot.allianceSeed, list);
  }
  return [...bySeed.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([seed, seedSlots]) => ({
      seed,
      slots: seedSlots.sort((a, b) => a.sortOrder - b.sortOrder || a.pickSlot.localeCompare(b.pickSlot)),
    }));
}

export function pickSlotLabel(slot: DeskPickSlot): string {
  if (slot === "captain") return "Captain";
  if (slot === "first") return "1st pick";
  return "2nd pick";
}

export function deskStatusLabel(status: "draft" | "live" | "locked"): string {
  if (status === "live") return "Live";
  if (status === "locked") return "Locked";
  return "Draft";
}
