/**
 * Per-member appearance preferences.
 *
 * These are *profile* level, not device level: a student who turns on compact
 * density on the pit laptop expects it on their phone too. They ride in
 * `profiles.appearance_prefs` (migration 0467) and are written only by
 * /api/branding/appearance, exactly like notification_prefs are written only by
 * /api/account. The localStorage copy is a paint-flash cache, never the source
 * of truth.
 */

export const DENSITY_KEYS = ["comfortable", "compact"] as const;
export type DensityPreference = (typeof DENSITY_KEYS)[number];

export const MOTION_KEYS = ["full", "reduced"] as const;
export type MotionPreference = (typeof MOTION_KEYS)[number];

/**
 * How translucent the floating chrome is — the top bar, the tab pill, the
 * drawer.
 *
 * iOS 27 added a slider for exactly this after iOS 26 shipped glass people
 * could not read, and the reason generalises: the right amount of
 * transparency depends on what is behind it and on the eyes in front of it.
 * "solid" is not a downgrade — outdoors, on a phone at arm's length, it is
 * the legible choice, and it composites cheaper on an old tablet in the pit.
 */
export const CLARITY_KEYS = ["clear", "regular", "solid"] as const;
export type ClarityPreference = (typeof CLARITY_KEYS)[number];

export type AppearancePrefs = {
  density: DensityPreference;
  motion: MotionPreference;
  clarity: ClarityPreference;
  /** false = ignore the team accent and stay on the neutral Vantage blue. */
  teamAccent: boolean;
};

export const DEFAULT_APPEARANCE_PREFS: AppearancePrefs = {
  density: "comfortable",
  motion: "full",
  clarity: "regular",
  teamAccent: true,
};

/** Device-level cache key. Server value always wins once it arrives. */
export const APPEARANCE_CACHE_KEY = "vantage.appearance";

/**
 * Scale applied to the `--space-*` ramp. Kept here (and asserted by tests)
 * so the TypeScript view and the CSS in app/system.css cannot drift apart.
 */
export const DENSITY_SCALE: Record<DensityPreference, number> = {
  comfortable: 1,
  compact: 0.78,
};

/** The base spacing ramp, in px, before the density scale is applied. */
export const SPACE_RAMP = [4, 8, 12, 16, 20, 24] as const;

/**
 * Resolved spacing ramp for a density. `--space-1` … `--space-6`.
 * The CSS computes the same values with calc(); this is the testable mirror.
 */
export function densityTokens(density: DensityPreference): Record<string, number> {
  const scale = DENSITY_SCALE[density];
  return Object.fromEntries(
    SPACE_RAMP.map((base, index) => [`--space-${index + 1}`, base * scale]),
  );
}

/** Attributes stamped on <html>. `null` means "remove the attribute". */
export function appearanceAttributes(prefs: AppearancePrefs): Record<string, string | null> {
  return {
    "data-density": prefs.density === "compact" ? "compact" : null,
    "data-motion": prefs.motion === "reduced" ? "reduced" : null,
    // "regular" is what the stylesheet already does, so it stays off the
    // element — an attribute that changes nothing is a thing to debug later.
    "data-clarity": prefs.clarity === "regular" ? null : prefs.clarity,
  };
}

function isDensity(value: unknown): value is DensityPreference {
  return DENSITY_KEYS.includes(value as DensityPreference);
}

function isMotion(value: unknown): value is MotionPreference {
  return MOTION_KEYS.includes(value as MotionPreference);
}

function isClarity(value: unknown): value is ClarityPreference {
  return CLARITY_KEYS.includes(value as ClarityPreference);
}

/** Tolerant of partial / legacy / hostile JSON — always returns a complete object. */
export function parseAppearancePrefs(value: unknown): AppearancePrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_APPEARANCE_PREFS };
  }
  const record = value as Record<string, unknown>;
  return {
    density: isDensity(record.density) ? record.density : DEFAULT_APPEARANCE_PREFS.density,
    motion: isMotion(record.motion) ? record.motion : DEFAULT_APPEARANCE_PREFS.motion,
    clarity: isClarity(record.clarity) ? record.clarity : DEFAULT_APPEARANCE_PREFS.clarity,
    teamAccent:
      typeof record.teamAccent === "boolean"
        ? record.teamAccent
        : DEFAULT_APPEARANCE_PREFS.teamAccent,
  };
}

/** True when the two preference sets would render identically. */
export function appearanceEquals(a: AppearancePrefs, b: AppearancePrefs): boolean {
  return (
    a.density === b.density &&
    a.motion === b.motion &&
    a.clarity === b.clarity &&
    a.teamAccent === b.teamAccent
  );
}
