// Pure helper functions for the pre-match checklist — no I/O, unit-testable.

import type {
  BumperColor,
  ChecklistItem,
  ChecklistItemKey,
  MatchChecklistRun,
  MatchChecklistSummary,
} from "./types";

export const LEGACY_CHECKLIST_ITEM_KEYS: ChecklistItemKey[] = ["bumper", "battery", "tether", "code"];
export const CHECKLIST_ITEM_KEYS: ChecklistItemKey[] = [
  ...LEGACY_CHECKLIST_ITEM_KEYS,
  "sb50",
  "ds_power",
  "ds_ethernet",
  "ds_estop",
  "ds_shelf",
  "lenses",
  "bolts",
  "kraken_screws",
  "anderson_lock",
  "controller_lock",
  "ds_usb",
];

const ITEM_LABELS: Record<ChecklistItemKey, string> = {
  bumper: "Bumpers secured",
  battery: "Battery seated & strap (not zip ties)",
  tether: "Tether / e-stop clipped",
  code: "Code deployed & radio linked",
  sb50: "SB50 locked (zip tie / clip)",
  ds_power: "DS laptop charging (never sleep)",
  ds_ethernet: "Ethernet seated + strain-relieved",
  ds_estop: "Spacebar E-Stop works (Game Bar off)",
  ds_shelf: "DS hook-and-loop on shelf (won't slide)",
  lenses: "Vision lenses wiped (ball fuzz)",
  bolts: "Bolt check (swerve / bumpers)",
  kraken_screws: "Kraken power screws 1.2 N·m (spec 0.9) + check",
  anderson_lock: "Anderson fully seated + zip-tied / bolted",
  controller_lock: "Tape accidental USB controller buttons",
  ds_usb: "USB joysticks strain-relieved (won't yank off the shelf)",
};

const LEVEL_LABELS: Record<string, string> = { qm: "Qual", qf: "QF", sf: "SF", f: "Final" };

export type ParsedMatchLabel = { compLevel: string; matchNumber: number; matchKey: string | null };

/** Strip the TBA `frc` prefix so 254 matches `frc254`. */
export function stripTeamKey(teamKey: string): string {
  return teamKey.replace(/^frc/i, "").trim();
}

/**
 * Bumper color from TBA alliance lists only.
 * Returns null when the team is missing, on both alliances, or the lists are empty — never guessed.
 */
export function bumperColorForTeam(
  teamNumber: number | null | undefined,
  redKeys: string[] | undefined,
  blueKeys: string[] | undefined,
): BumperColor | null {
  if (teamNumber == null || !Number.isFinite(teamNumber)) return null;
  const needle = String(Math.trunc(teamNumber));
  const on = (keys?: string[]) => (keys ?? []).some((key) => stripTeamKey(String(key)) === needle);
  const red = on(redKeys);
  const blue = on(blueKeys);
  if (red === blue) return null;
  return red ? "red" : "blue";
}

export function bumperBanner(color: BumperColor | null): string {
  if (color === "red") return "RED bumpers";
  if (color === "blue") return "BLUE bumpers";
  return "Bumper color unknown";
}

export function bumperItemLabel(color: BumperColor | null): string {
  if (color === "red") return "RED bumpers secured";
  if (color === "blue") return "BLUE bumpers secured";
  return ITEM_LABELS.bumper;
}

export function formatScheduleLabel(compLevel: string, matchNumber: number): string {
  return `${LEVEL_LABELS[compLevel] ?? compLevel.toUpperCase()} ${matchNumber}`;
}

/** Parse pit labels like "Qualification 12", "Qual 12", "qm12", or a TBA match key. */
export function parseMatchLabel(label: string): ParsedMatchLabel | null {
  const raw = label.trim();
  if (!raw) return null;

  const keyMatch = raw.match(/(?:^|_)(qm|qf|sf|f)(\d+)(?:m\d+)?$/i);
  if (keyMatch && /_/u.test(raw)) {
    return {
      compLevel: keyMatch[1]!.toLowerCase(),
      matchNumber: Number(keyMatch[2]),
      matchKey: raw.includes("_") ? raw.toLowerCase() : null,
    };
  }

  const named = raw.match(
    /^(qual(?:ification)?s?|q|qm|qf|quarter\s*finals?|sf|semi\s*finals?|f|finals?)\s*#?\s*(\d+)$/i,
  );
  if (!named) return null;
  const token = named[1]!.toLowerCase().replace(/\s+/g, "");
  const matchNumber = Number(named[2]);
  if (!Number.isFinite(matchNumber) || matchNumber < 1) return null;
  let compLevel = "qm";
  if (token === "qf" || token.startsWith("quarter")) compLevel = "qf";
  else if (token === "sf" || token.startsWith("semi")) compLevel = "sf";
  else if (token === "f" || token.startsWith("final")) compLevel = "f";
  return { compLevel, matchNumber, matchKey: null };
}

export function applyBumperCue(items: ChecklistItem[], color: BumperColor | null): ChecklistItem[] {
  return items.map((item) => {
    if (item.key === "bumper" && color) return { ...item, label: bumperItemLabel(color) };
    if (item.key === "battery") return { ...item, label: ITEM_LABELS.battery };
    if (item.key === "sb50") return { ...item, label: ITEM_LABELS.sb50 };
    if (item.key === "ds_power") return { ...item, label: ITEM_LABELS.ds_power };
    if (item.key === "ds_ethernet") return { ...item, label: ITEM_LABELS.ds_ethernet };
    if (item.key === "ds_estop") return { ...item, label: ITEM_LABELS.ds_estop };
    if (item.key === "ds_shelf") return { ...item, label: ITEM_LABELS.ds_shelf };
    if (item.key === "lenses") return { ...item, label: ITEM_LABELS.lenses };
    if (item.key === "bolts") return { ...item, label: ITEM_LABELS.bolts };
    if (item.key === "kraken_screws") return { ...item, label: ITEM_LABELS.kraken_screws };
    if (item.key === "anderson_lock") return { ...item, label: ITEM_LABELS.anderson_lock };
    if (item.key === "controller_lock") return { ...item, label: ITEM_LABELS.controller_lock };
    if (item.key === "ds_usb") return { ...item, label: ITEM_LABELS.ds_usb };
    return item;
  });
}

/**
 * Keep whatever keys were stored. Never append newer items (SB50 / DS / lenses) as
 * unchecked holes on a completed older run.
 */
export function keysForStoredChecklist(raw: unknown): ChecklistItemKey[] {
  if (!Array.isArray(raw)) return CHECKLIST_ITEM_KEYS;
  const present = new Set<ChecklistItemKey>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const key = (entry as { key?: unknown }).key;
    if (typeof key === "string" && (CHECKLIST_ITEM_KEYS as string[]).includes(key)) {
      present.add(key as ChecklistItemKey);
    }
  }
  const ordered = CHECKLIST_ITEM_KEYS.filter((key) => present.has(key));
  return ordered.length > 0 ? ordered : CHECKLIST_ITEM_KEYS;
}

export function sanitizeChecklistItems(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return buildDefaultItems();
  const byKey = new Map<string, ChecklistItem>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : null;
    if (!key || !(CHECKLIST_ITEM_KEYS as string[]).includes(key)) continue;
    byKey.set(key, {
      key: key as ChecklistItemKey,
      label: typeof record.label === "string" ? record.label : checklistItemLabel(key as ChecklistItemKey),
      done: Boolean(record.done),
      checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : null,
    });
  }
  return keysForStoredChecklist(raw).map(
    (key) => byKey.get(key) ?? { key, label: checklistItemLabel(key), done: false, checkedAt: null },
  );
}

export function allianceTeamKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const keys = (raw as { teamKeys?: unknown }).teamKeys;
  if (!Array.isArray(keys)) return [];
  return keys.filter((key): key is string => typeof key === "string");
}

export function checklistItemLabel(key: ChecklistItemKey): string {
  return ITEM_LABELS[key] ?? key;
}

/** Fresh default item set for a newly-started checklist run. */
export function buildDefaultItems(): ChecklistItem[] {
  return CHECKLIST_ITEM_KEYS.map((key) => ({
    key,
    label: checklistItemLabel(key),
    done: false,
    checkedAt: null,
  }));
}

export function isRunComplete(items: ChecklistItem[]): boolean {
  return items.length > 0 && items.every((item) => item.done);
}

/** Seconds between startedAt and (completedAt ?? now). Null if startedAt is missing/invalid. */
export function computeElapsedSeconds(
  startedAt: string | null,
  completedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  const end = completedAt ? new Date(completedAt).getTime() : now.getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function summarizeRuns(runs: MatchChecklistRun[]): MatchChecklistSummary {
  const totalRuns = runs.length;
  const completed = runs.filter((run) => run.completedAt != null);
  const completedRuns = completed.length;
  const openRuns = totalRuns - completedRuns;

  const completedElapsed = completed
    .map((run) => run.elapsedSeconds)
    .filter((value): value is number => value != null);

  const averageElapsedSeconds =
    completedElapsed.length > 0
      ? Math.round(completedElapsed.reduce((sum, value) => sum + value, 0) / completedElapsed.length)
      : null;
  const fastestElapsedSeconds = completedElapsed.length > 0 ? Math.min(...completedElapsed) : null;

  return {
    totalRuns,
    completedRuns,
    openRuns,
    averageElapsedSeconds,
    fastestElapsedSeconds,
  };
}

export function formatElapsed(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
