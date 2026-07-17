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
