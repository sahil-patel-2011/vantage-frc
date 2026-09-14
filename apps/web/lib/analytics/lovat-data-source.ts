/**
 * Lovat Dashboard data-source picker: our scouting, every team at the event,
 * or a hand-picked set. Missing selections never invent a field average.
 */

export const ANALYTICS_SOURCE_MODES = ["own", "all", "selected"] as const;
export type AnalyticsSourceMode = (typeof ANALYTICS_SOURCE_MODES)[number];

export type AnalyticsSourceSettings = {
  mode: AnalyticsSourceMode;
  teamKeys: string[];
  eventKeys: string[];
};

export const DEFAULT_ANALYTICS_SOURCE: AnalyticsSourceSettings = {
  mode: "all",
  teamKeys: [],
  eventKeys: [],
};

export function isAnalyticsSourceMode(value: unknown): value is AnalyticsSourceMode {
  return value === "own" || value === "all" || value === "selected";
}

export function normalizeTeamKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^frc\d+[a-z]?$/i.test(trimmed)) return `frc${trimmed.slice(3)}`;
  if (/^\d+[a-z]?$/i.test(trimmed)) return `frc${trimmed}`;
  return null;
}

export function normalizeEventKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return /^\d{4}[a-z0-9]+$/.test(trimmed) ? trimmed : null;
}

export function uniqueKeys(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

export function parseTeamKeyList(raw: unknown): string[] {
  if (typeof raw === "string") {
    return uniqueKeys(
      raw
        .split(/[\s,]+/)
        .map((part) => normalizeTeamKey(part))
        .filter((part): part is string => Boolean(part)),
    );
  }
  if (!Array.isArray(raw)) return [];
  return uniqueKeys(
    raw
      .map((part) => (typeof part === "string" ? normalizeTeamKey(part) : null))
      .filter((part): part is string => Boolean(part)),
  );
}

export function parseEventKeyList(raw: unknown): string[] {
  if (typeof raw === "string") {
    return uniqueKeys(
      raw
        .split(/[\s,]+/)
        .map((part) => normalizeEventKey(part))
        .filter((part): part is string => Boolean(part)),
    );
  }
  if (!Array.isArray(raw)) return [];
  return uniqueKeys(
    raw
      .map((part) => (typeof part === "string" ? normalizeEventKey(part) : null))
      .filter((part): part is string => Boolean(part)),
  );
}

export function parseAnalyticsSource(raw: unknown): AnalyticsSourceSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ANALYTICS_SOURCE };
  const row = raw as Record<string, unknown>;
  const mode = isAnalyticsSourceMode(row.mode) ? row.mode : "all";
  return {
    mode,
    teamKeys: parseTeamKeyList(row.teamKeys ?? row.team_keys),
    eventKeys: parseEventKeyList(row.eventKeys ?? row.event_keys),
  };
}

export function analyticsSourceLabel(mode: AnalyticsSourceMode): string {
  switch (mode) {
    case "own":
      return "Our scouting";
    case "all":
      return "All teams at this event";
    case "selected":
      return "Selected teams";
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export function analyticsSourceDetail(settings: AnalyticsSourceSettings): string {
  switch (settings.mode) {
    case "own":
      return "Only this team's scout rows. Event ratings still use the whole field.";
    case "all":
      return "Every team with real rows at this event.";
    case "selected":
      return settings.teamKeys.length
        ? `${settings.teamKeys.length} team${settings.teamKeys.length === 1 ? "" : "s"} you picked.`
        : "Needs setup — pick at least one team.";
    default: {
      const exhaustive: never = settings.mode;
      return exhaustive;
    }
  }
}

export function sourceAllowsTeam(
  settings: AnalyticsSourceSettings,
  teamKey: string,
  ownTeamKey: string | null,
): boolean {
  const normalized = normalizeTeamKey(teamKey);
  if (!normalized) return false;
  switch (settings.mode) {
    case "all":
      return true;
    case "own":
      return ownTeamKey != null && normalized === normalizeTeamKey(ownTeamKey);
    case "selected":
      return settings.teamKeys.includes(normalized);
    default: {
      const exhaustive: never = settings.mode;
      return exhaustive;
    }
  }
}

export function sourceAllowsEvent(settings: AnalyticsSourceSettings, eventKey: string | null | undefined): boolean {
  if (settings.eventKeys.length === 0) return true;
  const normalized = normalizeEventKey(eventKey);
  return normalized != null && settings.eventKeys.includes(normalized);
}

export function filterRowsBySource<T extends { teamKey: string; eventKey?: string | null }>(
  rows: readonly T[],
  settings: AnalyticsSourceSettings,
  ownTeamKey: string | null,
): T[] {
  return rows.filter((row) => sourceAllowsEvent(settings, row.eventKey) && sourceAllowsTeam(settings, row.teamKey, ownTeamKey));
}

export function filterPayloadsBySource<T extends { teamKey: string; eventKey?: string | null }>(
  rows: readonly T[],
  settings: AnalyticsSourceSettings,
  ownTeamKey: string | null,
): T[] {
  if (settings.mode === "all" && settings.eventKeys.length === 0) return [...rows];
  return filterRowsBySource(rows, settings, ownTeamKey);
}

export type AnalyticsSourceIssue =
  | { kind: "ok" }
  | { kind: "needs_own_team"; message: string }
  | { kind: "needs_selected"; message: string };

export function analyticsSourceIssue(
  settings: AnalyticsSourceSettings,
  ownTeamKey: string | null,
): AnalyticsSourceIssue {
  if (settings.mode === "own" && !normalizeTeamKey(ownTeamKey)) {
    return { kind: "needs_own_team", message: "Choose your team before filtering to our scouting." };
  }
  if (settings.mode === "selected" && settings.teamKeys.length === 0) {
    return { kind: "needs_selected", message: "Needs setup — pick the teams this board should use." };
  }
  return { kind: "ok" };
}

export function serializeAnalyticsSource(settings: AnalyticsSourceSettings): AnalyticsSourceSettings {
  return {
    mode: settings.mode,
    teamKeys: uniqueKeys(settings.teamKeys.map((key) => normalizeTeamKey(key)).filter((key): key is string => Boolean(key))),
    eventKeys: uniqueKeys(settings.eventKeys.map((key) => normalizeEventKey(key)).filter((key): key is string => Boolean(key))),
  };
}
