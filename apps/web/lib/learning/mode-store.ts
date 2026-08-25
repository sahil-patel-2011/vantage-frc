// Learning-mode preference resolution + the device-storage compatibility layer.
//
// Phase 1 kept the "Learning mode" toggle in localStorage only. Phase 2 persists
// it per member (and optionally per surface) in learning_mode_prefs, so a
// student's choice follows them across devices. This module is the single place
// that decides which stored value wins, with a documented precedence:
//
//   1. explicit per-surface preference   (learning_mode_prefs, surface = '...')
//   2. member default across surfaces    (learning_mode_prefs, surface IS NULL)
//   3. legacy device value               (localStorage — pre-phase-2 choice,
//                                         honoured until it is migrated up)
//   4. role default                      (students on, mentors off — learning-mode.ts)
//
// The device layer never goes away: localStorage stays the offline/optimistic
// cache so a failed fetch never breaks a calculator. The legacy global value is
// migrated to the server-side member default exactly once (shouldMigrateDeviceMode),
// so nobody's current choice is lost when this ships.
//
// Resolution functions are pure (no window, no I/O); the read/write helpers at
// the bottom guard `typeof window` so they are safe to import anywhere.

import { resolveLearningModeEnabled, type LearningSurface } from "./learning-mode";

/** The pre-phase-2 global toggle key — still read, still written, migrated once. */
export const LEGACY_MODE_STORAGE_KEY = "vantage:learning-mode";

export function surfaceModeStorageKey(surface: LearningSurface): string {
  return `${LEGACY_MODE_STORAGE_KEY}:${surface}`;
}

export type ModeSource = "surface_pref" | "member_default" | "device" | "role_default";

export type StoredModeInputs = {
  role: string | null | undefined;
  /** learning_mode_prefs row for this exact surface, when one exists. */
  surfacePref: boolean | null | undefined;
  /** learning_mode_prefs row with surface IS NULL — the member's default. */
  memberDefault: boolean | null | undefined;
  /** Whatever this device remembered (legacy global or per-surface key). */
  deviceStored: boolean | null | undefined;
};

export type EffectiveMode = { enabled: boolean; source: ModeSource };

const asChoice = (value: boolean | null | undefined): boolean | null =>
  typeof value === "boolean" ? value : null;

/**
 * The stored choice that should feed resolveLearningModeEnabled / shouldGateResult,
 * or null when no explicit choice exists anywhere (role default applies).
 */
export function resolveStoredMode(input: Omit<StoredModeInputs, "role">): boolean | null {
  return asChoice(input.surfacePref) ?? asChoice(input.memberDefault) ?? asChoice(input.deviceStored);
}

/** Full resolution including the role default, with the winning source named. */
export function resolveEffectiveMode(input: StoredModeInputs): EffectiveMode {
  const surfacePref = asChoice(input.surfacePref);
  if (surfacePref != null) return { enabled: surfacePref, source: "surface_pref" };
  const memberDefault = asChoice(input.memberDefault);
  if (memberDefault != null) return { enabled: memberDefault, source: "member_default" };
  const deviceStored = asChoice(input.deviceStored);
  if (deviceStored != null) return { enabled: deviceStored, source: "device" };
  return { enabled: resolveLearningModeEnabled(input.role, null), source: "role_default" };
}

/**
 * Migrate the legacy device-only choice to the server exactly once: only when
 * the device has an explicit value AND the server knows nothing (no per-surface
 * pref, no member default). It lands as the member DEFAULT because the legacy
 * key was global, not per-surface — so the migrated meaning matches the old one.
 */
export function shouldMigrateDeviceMode(input: Omit<StoredModeInputs, "role">): boolean {
  return (
    asChoice(input.deviceStored) != null &&
    asChoice(input.surfacePref) == null &&
    asChoice(input.memberDefault) == null
  );
}

/** "on"/"off" is the wire + storage format, unchanged from phase 1. */
export function parseStoredMode(raw: unknown): boolean | null {
  return raw === "on" ? true : raw === "off" ? false : null;
}

export function serializeStoredMode(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

// ---- server payload parsing ---------------------------------------------

export type ModePrefs = {
  /** surface IS NULL row, when the member has set one. */
  memberDefault: boolean | null;
  /** Explicit per-surface overrides only — absent surfaces inherit. */
  surfaces: Partial<Record<LearningSurface, boolean>>;
};

export const EMPTY_MODE_PREFS: ModePrefs = { memberDefault: null, surfaces: {} };

/** Fold learning_mode_prefs rows (surface, enabled) into a ModePrefs shape. */
export function foldModePrefRows(
  rows: Array<{ surface: string | null; enabled: boolean }>,
  isSurface: (value: unknown) => value is LearningSurface,
): ModePrefs {
  const prefs: ModePrefs = { memberDefault: null, surfaces: {} };
  for (const row of rows) {
    if (typeof row.enabled !== "boolean") continue;
    if (row.surface == null) prefs.memberDefault = row.enabled;
    else if (isSurface(row.surface)) prefs.surfaces[row.surface] = row.enabled;
  }
  return prefs;
}

// ---- device storage (guarded; safe under SSR and private mode) -----------

/** Per-surface key first (a phase-2 write), then the legacy global key. */
export function readDeviceMode(surface: LearningSurface): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    return (
      parseStoredMode(window.localStorage.getItem(surfaceModeStorageKey(surface))) ??
      parseStoredMode(window.localStorage.getItem(LEGACY_MODE_STORAGE_KEY))
    );
  } catch {
    return null;
  }
}

/**
 * Mirror a choice to this device. Writes both the per-surface key (the precise
 * meaning) and the legacy key (so phase-1 code paths still agree while deployed).
 */
export function writeDeviceMode(surface: LearningSurface, enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(surfaceModeStorageKey(surface), serializeStoredMode(enabled));
    window.localStorage.setItem(LEGACY_MODE_STORAGE_KEY, serializeStoredMode(enabled));
  } catch {
    /* private mode — the toggle just does not persist on this device. */
  }
}
