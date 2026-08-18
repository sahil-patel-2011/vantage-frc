// Robot software / firmware version tracker. FRC robots run a stack of libraries
// and firmware (WPILib, roboRIO image, CTRE Phoenix, REVLib, PathPlanner, radio
// firmware, driver station…) that must be kept in sync — a version mismatch is a
// classic, hard-to-diagnose source of "it worked yesterday" bugs. This tracks the
// installed version vs. the team's target version for each component.

export const VERSION_CATEGORIES = ["library", "firmware", "image", "tool", "other"] as const;
export type VersionCategory = (typeof VERSION_CATEGORIES)[number];

export const VERSION_CATEGORY_LABEL: Record<VersionCategory, string> = {
  library: "Vendor library",
  firmware: "Device firmware",
  image: "Image / OS",
  tool: "Tool / driver station",
  other: "Other",
};

/** Common components offered as quick-adds. */
export const COMMON_COMPONENTS: { name: string; category: VersionCategory }[] = [
  { name: "WPILib", category: "library" },
  { name: "roboRIO image", category: "image" },
  { name: "CTRE Phoenix 6", category: "library" },
  { name: "CTRE Phoenix 5", category: "library" },
  { name: "REVLib", category: "library" },
  { name: "PathPlanner", category: "library" },
  { name: "PhotonVision", category: "tool" },
  { name: "Limelight", category: "firmware" },
  { name: "Radio firmware", category: "firmware" },
  { name: "Driver Station / NI Game Tools", category: "tool" },
  { name: "Talon FX firmware", category: "firmware" },
  { name: "SPARK MAX firmware", category: "firmware" },
];

export type VersionStatus = "ok" | "update_available" | "unknown";

/** Exact-string compare: teams set target to the precise version they want. */
export function versionStatus(installed: string, target: string | null): VersionStatus {
  if (!target || !target.trim()) return "unknown";
  return installed.trim() === target.trim() ? "ok" : "update_available";
}

export type ComponentInput = { component: string; category: VersionCategory; installedVersion: string; targetVersion: string | null; notes: string };

export function validateComponent(raw: Record<string, unknown>): { ok: true; value: ComponentInput } | { ok: false; error: string } {
  const component = typeof raw.component === "string" ? raw.component.trim() : "";
  if (!component) return { ok: false, error: "Component name is required" };
  const category = String(raw.category ?? "library");
  if (!VERSION_CATEGORIES.includes(category as VersionCategory)) return { ok: false, error: "Invalid category" };
  const installedVersion = typeof raw.installedVersion === "string" ? raw.installedVersion.trim() : "";
  if (!installedVersion) return { ok: false, error: "Installed version is required" };
  const targetRaw = typeof raw.targetVersion === "string" ? raw.targetVersion.trim() : "";
  return {
    ok: true,
    value: {
      component,
      category: category as VersionCategory,
      installedVersion,
      targetVersion: targetRaw || null,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    },
  };
}

export function summarizeVersions(components: { installedVersion: string; targetVersion: string | null }[]) {
  let ok = 0;
  let updateAvailable = 0;
  let unknown = 0;
  for (const c of components) {
    const status = versionStatus(c.installedVersion, c.targetVersion);
    if (status === "ok") ok += 1;
    else if (status === "update_available") updateAvailable += 1;
    else unknown += 1;
  }
  return { total: components.length, ok, updateAvailable, unknown };
}

/** FIRST released VH-109 firmware 2.01 before 2026 events. Cue only from a logged radio row. */
export const VH109_MIN_FIRMWARE = [2, 1] as const;
export const VH109_FIRMWARE_CUE =
  "Logged radio firmware is below VH-109 2.01 — update on the official FRC radio page before you travel.";

function dottedVersionParts(raw: string): number[] | null {
  const nums = raw.trim().match(/\d+/g);
  if (!nums?.length) return null;
  return nums.map((n) => Number(n));
}

function versionAtLeast(installed: number[], min: readonly number[]): boolean {
  for (let i = 0; i < min.length; i += 1) {
    const a = installed[i] ?? 0;
    const b = min[i] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

export function vh109FirmwareCue(
  components: Array<{ component: string; installedVersion: string }>,
): string | null {
  const radio = components.find((row) => /radio/i.test(row.component));
  if (!radio) return null;
  const parsed = dottedVersionParts(radio.installedVersion);
  if (!parsed) return null;
  if (versionAtLeast(parsed, VH109_MIN_FIRMWARE)) return null;
  return VH109_FIRMWARE_CUE;
}

/** CD: firmware 2.0+ removed DIP switch 3. Cue only from a logged radio row at 2.0 or later. */
export const VH109_DIP_SWITCH_MIN = [2, 0] as const;
export const VH109_DIP_SWITCH_CUE =
  "Logged VH-109 firmware is 2.0+ — DIP switch 3 no longer enables 2.4 GHz. Reconfigure home after the event kiosk and turn on Enable 2.4 GHz Wi-Fi in the radio web UI.";

export function vh109DipSwitchCue(
  components: Array<{ component: string; installedVersion: string }>,
): string | null {
  const radio = components.find((row) => /radio/i.test(row.component));
  if (!radio) return null;
  const parsed = dottedVersionParts(radio.installedVersion);
  if (!parsed) return null;
  if (!versionAtLeast(parsed, VH109_DIP_SWITCH_MIN)) return null;
  return VH109_DIP_SWITCH_CUE;
}

const SEASON_STACK_NAME = /wpilib|roborio|driver.?station|game tools/i;

/** CD: 2026 Tuner / Game Tools will not talk to a leftover 2025 RIO image. Cue only from a logged stack row. */
export const STALE_SEASON_STACK_CUE =
  "Logged WPILib, roboRIO image, or Driver Station is still last season's year — install this season's Game Tools and matching RIO image before Phoenix Tuner and the field will talk.";

function installedCalendarYear(raw: string): number | null {
  const match = raw.trim().match(/20\d{2}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isInteger(year) ? year : null;
}

export function staleSeasonStackCue(
  components: Array<{ component: string; installedVersion: string }>,
  seasonYear: number,
): string | null {
  if (!Number.isInteger(seasonYear) || seasonYear < 2000) return null;
  const stale = components.some((row) => {
    if (!SEASON_STACK_NAME.test(row.component)) return false;
    const year = installedCalendarYear(row.installedVersion);
    return year != null && year < seasonYear;
  });
  return stale ? STALE_SEASON_STACK_CUE : null;
}

/** 2026 inspection checklist: roboRIO image 2026_v1.2 or later. Cue only from a logged RIO row. */
export const INSPECTION_RIO_IMAGE_MIN_2026 = [2026, 1, 2] as const;
export const INSPECTION_RIO_IMAGE_CUE =
  "Logged roboRIO image is below 2026_v1.2 — inspectors fail an older 2026 image even when the year is current.";

/** 2026 inspection checklist: Driver Station / Game Tools 26.0 or later. Cue only from a logged DS row. */
export const INSPECTION_DS_MIN_2026 = [2026, 0] as const;
export const INSPECTION_DS_CUE =
  "Logged Driver Station is below 26.0 — 2026 inspection wants Game Tools 26.0 or later on the field laptop.";

/** Game Tools uses 26.0; roboRIO images use 2026_v1.2. Two-digit 20–99 years become 20xx. */
function frcYearParts(raw: string): number[] | null {
  const parts = dottedVersionParts(raw);
  if (!parts?.length) return null;
  const first = parts[0] ?? 0;
  if (first >= 2000) return parts;
  if (first >= 20 && first <= 99) return [2000 + first, ...parts.slice(1)];
  return parts;
}

export function inspectionRioImageCue(
  components: Array<{ component: string; installedVersion: string }>,
  seasonYear: number,
): string | null {
  if (seasonYear !== 2026) return null;
  const rio = components.find((row) => /roborio/i.test(row.component));
  if (!rio) return null;
  const parsed = frcYearParts(rio.installedVersion);
  if (!parsed) return null;
  if (versionAtLeast(parsed, INSPECTION_RIO_IMAGE_MIN_2026)) return null;
  return INSPECTION_RIO_IMAGE_CUE;
}

export function inspectionDsCue(
  components: Array<{ component: string; installedVersion: string }>,
  seasonYear: number,
): string | null {
  if (seasonYear !== 2026) return null;
  const ds = components.find((row) => /driver.?station|game tools/i.test(row.component));
  if (!ds) return null;
  const parsed = frcYearParts(ds.installedVersion);
  if (!parsed) return null;
  if (versionAtLeast(parsed, INSPECTION_DS_MIN_2026)) return null;
  return INSPECTION_DS_CUE;
}

// ---- request validation --------------------------------------------------

export type SoftwareVersionAction =
  | ({ action: "save_component"; orgId: string; seasonYear: number } & ComponentInput)
  | { action: "delete_component"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseSoftwareVersionAction(raw: unknown): SoftwareVersionAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "save_component": {
      const validated = validateComponent(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "delete_component":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported software version action");
  }
}
