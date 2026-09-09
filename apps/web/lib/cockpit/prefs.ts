import { withSavepoint } from "@vantage/db";
/**
 * Tesla-style cockpit: a handful of useful knobs, not a settings maze.
 *
 * Stored on `profiles.cockpit_prefs`. Unknown / hostile JSON falls back to
 * defaults so a bad write cannot break the product.
 */

export const BUGBOT_INSTRUCTION_MAX = 500;
export const BUGBOT_MODES = ["subscription", "ultra"] as const;
export type CockpitBugbotMode = (typeof BUGBOT_MODES)[number];

export type CockpitPrefs = {
  /** Extra confirm before opening a Bugbot write-PR. Default on. */
  confirmWrites: boolean;
  /** Pause TBA / pit polls while the tab is hidden. Default on. */
  pauseLiveWhenHidden: boolean;
  /** Include the team's own test sources in a repo scan. Default off. */
  includeScanTests: boolean;
  /** Short notes Bugbot must follow. Empty = no extra instructions. */
  bugbotInstructions: string;
  /** Which Bugbot billing mode the workbench opens on. */
  defaultBugbotMode: CockpitBugbotMode;
};

export const DEFAULT_COCKPIT_PREFS: CockpitPrefs = {
  confirmWrites: true,
  pauseLiveWhenHidden: true,
  includeScanTests: false,
  bugbotInstructions: "",
  defaultBugbotMode: "subscription",
};

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asMode(value: unknown): CockpitBugbotMode {
  return value === "ultra" || value === "subscription" ? value : DEFAULT_COCKPIT_PREFS.defaultBugbotMode;
}

type CockpitQueryClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ cockpitPrefs?: unknown }> }>;
};

export function clipBugbotInstructions(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, BUGBOT_INSTRUCTION_MAX);
}

/** Tolerant of partial / legacy / hostile JSON — always a complete object. */
export function parseCockpitPrefs(value: unknown): CockpitPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_COCKPIT_PREFS };
  }
  const record = value as Record<string, unknown>;
  return {
    confirmWrites: asBool(record.confirmWrites, DEFAULT_COCKPIT_PREFS.confirmWrites),
    pauseLiveWhenHidden: asBool(
      record.pauseLiveWhenHidden,
      DEFAULT_COCKPIT_PREFS.pauseLiveWhenHidden,
    ),
    includeScanTests: asBool(record.includeScanTests, DEFAULT_COCKPIT_PREFS.includeScanTests),
    bugbotInstructions: clipBugbotInstructions(record.bugbotInstructions),
    defaultBugbotMode: asMode(record.defaultBugbotMode),
  };
}

export function cockpitEquals(a: CockpitPrefs, b: CockpitPrefs): boolean {
  return (
    a.confirmWrites === b.confirmWrites &&
    a.pauseLiveWhenHidden === b.pauseLiveWhenHidden &&
    a.includeScanTests === b.includeScanTests &&
    a.bugbotInstructions === b.bugbotInstructions &&
    a.defaultBugbotMode === b.defaultBugbotMode
  );
}

/** Live poll helper: default pause-when-hidden, overridable from cockpit. */
export function shouldPollWhileVisible(
  visibilityState: string | null | undefined,
  pauseWhenHidden = true,
): boolean {
  if (!pauseWhenHidden) return true;
  return visibilityState !== "hidden";
}

export async function loadCockpitPrefs(
  client: CockpitQueryClient,
  userId: string,
): Promise<CockpitPrefs> {
  // `profiles.cockpit_prefs` may predate its migration, so defaults are the right
  // answer — but only under a savepoint. /api/code calls this partway through a
  // request; a plain catch left the transaction aborted and the coding-assistant
  // work that followed failed on a dead transaction.
  return withSavepoint(
    client,
    async () => {
      const result = (await client.query(
        `SELECT cockpit_prefs AS "cockpitPrefs" FROM profiles WHERE user_id = $1::uuid`,
        [userId],
      )) as { rows: Array<{ cockpitPrefs?: unknown }> };
      return parseCockpitPrefs(result.rows[0]?.cockpitPrefs);
    },
    { ...DEFAULT_COCKPIT_PREFS },
  );
}

/** Column-scoped upsert — never touches appearance / island / notification prefs. */
export async function saveCockpitPrefs(
  client: CockpitQueryClient,
  userId: string,
  value: unknown,
): Promise<CockpitPrefs> {
  const cockpit = parseCockpitPrefs(value);
  await client.query(
    `INSERT INTO profiles(user_id, cockpit_prefs)
     VALUES ($1::uuid, $2::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET cockpit_prefs = excluded.cockpit_prefs`,
    [userId, JSON.stringify(cockpit)],
  );
  return cockpit;
}
