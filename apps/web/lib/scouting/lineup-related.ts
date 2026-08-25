import type { CoverageGapStatus, CoverageSlotInput } from "@vantage/scouting/coverage";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Lineup & Coverage (never DEMO %). */
export const LINEUP_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "forms", label: "Form builder", kind: "hub" as const, tab: "forms" },
  { id: "coverage-live", label: "Scout Coverage Live", kind: "path" as const, path: "/scout-coverage-live" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
] as const;

export type LineupRelatedId = (typeof LINEUP_RELATED_LINKS)[number]["id"];

export type LineupRelatedLink = {
  id: LineupRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Strategy · Form builder. */
export const LINEUP_RELATED_INCLUDE: LineupRelatedId[] = ["scouting", "strategy", "forms"];

/**
 * Soft-UI cross-links from Lineup & Coverage → Scouting / Strategy / Form builder.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function lineupRelatedLinks(
  orgId?: string | null,
  options?: { active?: LineupRelatedId; include?: LineupRelatedId[] },
): LineupRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return LINEUP_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type LineupShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type LineupNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type LineupEmptyCopy = {
  kind: LineupShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO %. */
export type LineupSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function lineupSetupSteps(orgId?: string | null): LineupSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — coverage is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the TBA event your team is competing at — schedule stays blank until synced.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Assignments and entries stay blank until real scout rows exist — never DEMO %.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "forms",
      label: "Open Form builder",
      detail: "Publish a real schema before scouts fill match rows.",
      href: hubHref("/competition", "forms", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick desk reads the same coverage — never invents DEMO rates.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ];
}

/** Real slot counts only — never invent DEMO totals. */
export function formatLineupMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/**
 * Coverage / double rates from real slots only — blank until loaded; never DEMO %.
 * Null rates (no slots) render as an em dash, not 0%.
 */
export function formatLineupCoverage(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed KPI tiles when the board has no real slots — avoids DEMO %. */
export function shouldShowLineupSummaryTiles(totalSlots: number): boolean {
  return totalSlots > 0;
}

/** True when live coverage has no schedule slots yet — Soft-UI empty. */
export function isLineupBoardEmpty(input: { totalSlots: number }): boolean {
  return input.totalSlots === 0;
}

/** Deep-link into Scouting for a specific match/team — hubHref + query only. */
export function lineupScoutNowHref(
  orgId: string | null | undefined,
  matchKey: string,
  teamKey: string,
): string {
  const base = hubHref("/competition", "scouting", orgId);
  const params = new URLSearchParams({ matchKey, teamKey });
  return `${base}&${params.toString()}`;
}

/**
 * Live-board poll interval. Tablet-friendly: at least 15s so pit tablets on
 * battery do not hammer the network, and polling pauses while the tab is hidden.
 */
export const LINEUP_POLL_MS = 15_000;

/** Poll only while the tab is visible — battery-safe for pit tablets. */
export function shouldPollLineup(visibilityState: string | null | undefined): boolean {
  return visibilityState !== "hidden";
}

/** DB rows the coverage route joins — matches_ref alliances as stored (JSONB). */
export type LineupMatchRow = {
  matchKey: string;
  matchNumber: number;
  compLevel: string;
  redAlliance: { teamKeys?: string[] } | null;
  blueAlliance: { teamKeys?: string[] } | null;
  eventTime?: string | null;
};

export type LineupAssignmentCountRow = {
  matchKey: string;
  teamKey: string;
  count: number;
};

/** One row per membership-bound match entry — never typed scout names. */
export type LineupEntryScoutRow = {
  matchKey: string;
  teamKey: string;
  scoutUserId: string;
  scoutName: string | null;
};

/**
 * Assemble coverage slots from real schedule + assignment + entry rows only.
 * One slot per (match, alliance robot); counts come straight from the DB rows —
 * never invented, never DEMO %.
 */
export function buildLineupCoverageSlots(input: {
  matches: LineupMatchRow[];
  assignments: LineupAssignmentCountRow[];
  entryScouts: LineupEntryScoutRow[];
}): CoverageSlotInput[] {
  const assignmentCounts = new Map<string, number>();
  for (const row of input.assignments) {
    assignmentCounts.set(`${row.matchKey}|${row.teamKey}`, Number(row.count) || 0);
  }
  const entriesByCell = new Map<string, LineupEntryScoutRow[]>();
  for (const row of input.entryScouts) {
    const key = `${row.matchKey}|${row.teamKey}`;
    const list = entriesByCell.get(key) ?? [];
    list.push(row);
    entriesByCell.set(key, list);
  }
  const slots: CoverageSlotInput[] = [];
  for (const match of input.matches) {
    const alliances: Array<{ alliance: "red" | "blue"; teamKeys: string[] }> = [
      { alliance: "red", teamKeys: match.redAlliance?.teamKeys ?? [] },
      { alliance: "blue", teamKeys: match.blueAlliance?.teamKeys ?? [] },
    ];
    for (const { alliance, teamKeys } of alliances) {
      for (const teamKey of teamKeys) {
        if (typeof teamKey !== "string" || !teamKey) continue;
        const key = `${match.matchKey}|${teamKey}`;
        const entries = entriesByCell.get(key) ?? [];
        const scoutUserIds: string[] = [];
        const scoutNames: string[] = [];
        for (const entry of entries) {
          if (scoutUserIds.includes(entry.scoutUserId)) continue;
          scoutUserIds.push(entry.scoutUserId);
          scoutNames.push(entry.scoutName || "Team scout");
        }
        slots.push({
          matchKey: match.matchKey,
          teamKey,
          matchNumber: match.matchNumber,
          compLevel: match.compLevel,
          alliance,
          assignmentCount: assignmentCounts.get(key) ?? 0,
          entryCount: entries.length,
          scoutUserIds,
          scoutNames,
          eventTime: match.eventTime ?? null,
        });
      }
    }
  }
  return slots;
}

/**
 * Default live-window anchor: the first schedule-ordered match that still has a
 * gap (unscouted or assigned-but-empty). Null when nothing needs coverage —
 * the window then starts at the first match.
 */
export function defaultLineupFocusMatchKey(
  slots: Array<{ matchKey: string; status: CoverageGapStatus }>,
): string | null {
  for (const slot of slots) {
    if (slot.status === "unscouted" || slot.status === "assigned") return slot.matchKey;
  }
  return null;
}

/** Classify Lineup Soft-UI shell — never invents DEMO %. */
export function classifyLineupShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  totalSlots?: number;
}): LineupShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isLineupBoardEmpty({ totalSlots: input.totalSlots ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO %. */
export function lineupShellCopy(kind: LineupShellKind): LineupEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading lineup coverage…",
        description:
          "Checking workspace membership and live scouting slots — never DEMO %.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load lineup coverage",
        description:
          "A network or server issue blocked the coverage board. Retry, or open Scouting / Strategy / Form builder while it reloads — never invent DEMO %.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace and event",
        description:
          "Lineup & coverage is org- and event-scoped. Pick a workspace and active TBA event before gaps appear — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No schedule yet",
        title: "Waiting on match slots",
        description:
          "Coverage stays blank until the event schedule syncs and scouts start entering rows. Cross-check Scouting, Strategy, and Form builder — never DEMO %.",
      };
    default:
      return {
        kind: "ready",
        title: "Live coverage gaps",
        description:
          "Rates use only real assignments and membership-bound entries — never DEMO %.",
      };
  }
}

/**
 * Soft-UI next actions for Lineup empty/setup shells.
 * Points at Scouting / Strategy / Form builder — never invents DEMO %.
 */
export function lineupNextActions(input: {
  orgId?: string | null;
  shell: LineupShellKind;
  totalSlots?: number;
  unscouted?: number;
  gapCount?: number;
}): LineupNextAction[] {
  const orgId = input.orgId ?? null;
  const unscouted = input.unscouted ?? 0;
  const gapCount = input.gapCount ?? 0;
  const totalSlots = input.totalSlots ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Coverage is org-scoped — pick a team before watching live gaps.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout rows stay blank until your team enters them — never DEMO %.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist — never DEMO rankings.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "forms",
          label: "Open Form builder",
          detail: "Schemas stay blank until you publish a real form — never DEMO fields.",
          href: hubHref("/competition", "forms", null),
        },
      ];
    }
    return [
      {
        id: "command",
        label: "Set active event",
        detail: "Lineup needs a TBA event context before match slots appear.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Confirm assignments and entries for the active event — never DEMO %.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Publish a schema so scouts can fill real match rows.",
        href: hubHref("/competition", "forms", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Pick desk coverage stays honest when the event is unset.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry lineup coverage",
        detail: "Reload real match slots and entries — nothing is pre-seeded while this fails.",
        href: withOrgHref("/scouting/lineup", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the board reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while coverage reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Form schemas stay available while coverage reloads.",
        href: hubHref("/competition", "forms", orgId),
      },
    ];
  }

  if (input.shell === "empty" || totalSlots === 0) {
    return [
      {
        id: "command",
        label: "Sync event schedule",
        detail: "Match slots stay blank until TBA publishes and syncs the schedule — never DEMO %.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Start assignments once the schedule lands — rates stay blank until then.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Confirm the published schema before scouts enter rows.",
        href: hubHref("/competition", "forms", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Pick desk waits on the same real schedule — never DEMO rates.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  return [
    {
      id: "gaps",
      label: gapCount > 0 || unscouted > 0 ? "Cover open gaps" : "Coverage looks solid",
      detail:
        gapCount > 0 || unscouted > 0
          ? `${Math.max(gapCount, unscouted)} slot${Math.max(gapCount, unscouted) === 1 ? "" : "s"} still need a scout — jump from Needs coverage.`
          : "Live window uses real entries only — rates never invent DEMO %.",
      href: gapCount > 0 || unscouted > 0 ? "#lineup-gaps" : hubHref("/competition", "scouting", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Fill match rows from membership-bound scout identity — never typed names.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Cross-check pick desk coverage against this live board.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "forms",
      label: "Open Form builder",
      detail: "Adjust the published schema if scouts need different fields.",
      href: hubHref("/competition", "forms", orgId),
    },
  ];
}
