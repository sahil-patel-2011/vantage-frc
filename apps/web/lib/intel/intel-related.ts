import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Related surfaces for Research (never DEMO research). */
export const INTEL_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "dossier", label: "Team Dossier", kind: "path" as const, path: "/dossier" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "team-data", label: "Team data", kind: "path" as const, path: "/team/data" },
  { id: "chemistry", label: "Alliance Chemistry", kind: "path" as const, path: "/chemistry" },
] as const;

export type IntelRelatedId = (typeof INTEL_RELATED_LINKS)[number]["id"];

export type IntelRelatedLink = {
  id: IntelRelatedId;
  label: string;
  href: string;
};

/** Focused header strip — Strategy · Dossier · Scouting. */
export const INTEL_RELATED_INCLUDE: IntelRelatedId[] = ["strategy", "dossier", "scouting"];

/**
 * Cross-links from Research → Strategy / Dossier / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function intelRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: IntelRelatedId;
    include?: IntelRelatedId[];
    teamNumber?: number | null;
  },
): IntelRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  const teamNumber = options?.teamNumber ?? null;
  return INTEL_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    if (link.id === "dossier" && teamNumber != null) {
      return {
        id: link.id,
        label: link.label,
        href: withOrgHref(`/dossier?team=${encodeURIComponent(String(teamNumber))}`, orgId),
      };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type IntelShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type IntelNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type IntelEmptyCopy = {
  kind: IntelShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type IntelSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type IntelScoutNote = {
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
  matchKey?: string;
};

export type IntelScoutNoteLine = {
  id: string;
  title: string;
  detail: string;
};

export type IntelActiveEvent = {
  eventKey: string;
  eventName: string | null;
};

const NOTE_STRING_KEYS = ["notes", "comments", "comment", "note", "observation"] as const;
const NOTE_NUMBER_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["cycles", "cycles"],
  ["gamePieces", "game pieces"],
  ["totalPoints", "points"],
  ["score", "score"],
  ["fouls", "fouls"],
];

function intelRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    intelRelatedLinks(orgId, { include: [...INTEL_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = intelRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function intelSetupSteps(orgId?: string | null): IntelSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to look up other FRC teams.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "team-data",
      label: "Sync season scores",
      detail: "Pull match and ranking rows so season scores can appear.",
      href: withOrgHref("/team/data", orgId),
    },
  ]);
}

/** Real finding counts only — never invent DEMO research totals. */
export function formatIntelMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** True when no team is looked up — empty until search. */
export function isIntelLookupEmpty(hasSelectedTeam: boolean): boolean {
  return !hasSelectedTeam;
}

/** Classify Research shell — never invents DEMO research. */
export function classifyIntelShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  hasSelectedTeam?: boolean;
}): IntelShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId) return "setup";
  if (isIntelLookupEmpty(input.hasSelectedTeam ?? false)) return "empty";
  return "ready";
}

/** Empty / setup / error copy — never DEMO research, never ranking-source jargon. */
export function intelShellCopy(kind: IntelShellKind): IntelEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Research…",
        description: "Checking which team you are on so you can look up another FRC team.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Research",
        description:
          "A network or server issue blocked the lookup. Retry, or open Strategy while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before looking up another FRC team.",
      };
    case "empty":
      return {
        kind,
        badge: "Look up a team",
        title: "Look up a team",
        description:
          "Type a team number or name. Season scores, our scouting, and public notes stay blank until they are on file.",
      };
    case "ready":
      return {
        kind,
        title: "Research",
        description:
          "Season scores and public notes stay blank until they exist. Check Strategy before locking a pick.",
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Next actions for Research. Empty/setup keep one EmptyState primary;
 * the panel paints only on ready and never repeats the header strip.
 */
export function intelNextActions(input: {
  orgId?: string | null;
  shell: IntelShellKind;
  teamNumber?: number | null;
  findingCount?: number;
  scoutNoteCount?: number;
}): IntelNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(intelSetupSteps(orgId));
  }

  switch (input.shell) {
    case "loading":
    case "empty":
    case "error":
      return [];
    case "ready": {
      const teamNumber = input.teamNumber ?? null;
      const findingCount = input.findingCount ?? 0;
      const scoutNoteCount = input.scoutNoteCount ?? 0;
      const pickDetail =
        teamNumber != null
          ? `Add team ${teamNumber} to this event's pick list when you are ready.`
          : "Open the pick list for this event.";
      const chemistryDetail =
        findingCount + scoutNoteCount > 0
          ? "Score how these robots complement each other from scores and our notes."
          : "Score how these robots complement each other once season scores are on file.";
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "pick-desk",
          label: "Open pick desk",
          detail: pickDetail,
          href: withOrgHref("/strategy?tab=picks", orgId),
          primary: true,
        },
        {
          id: "chemistry",
          label: "Open Chemistry",
          detail: chemistryDetail,
          href: withOrgHref("/chemistry", orgId),
        },
      ]);
    }
    default: {
      const _exhaustive: never = input.shell;
      return _exhaustive;
    }
  }
}

/** Lines from real scout payloads only — skip empty notes, never invent scores. */
export function intelScoutNoteLines(notes: IntelScoutNote[]): IntelScoutNoteLine[] {
  return notes.map((note, index) => {
    const title = note.matchKey ? `Match ${note.matchKey}` : "Pit notes";
    const parts: string[] = [];
    for (const [key, label] of NOTE_NUMBER_LABELS) {
      const value = note.payload[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        parts.push(`${label} ${value}`);
      }
    }
    for (const key of NOTE_STRING_KEYS) {
      const value = note.payload[key];
      if (typeof value === "string" && value.trim()) {
        parts.push(value.trim());
        break;
      }
    }
    return {
      id: `${note.matchKey ?? "pit"}-${index}`,
      title,
      detail: parts.join(" · ") || "Logged from our scouting.",
    };
  });
}

export function intelSourceTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case "cd_post":
      return "Chief Delphi";
    case "social":
      return "Social";
    case "news":
      return "News";
    case "reveal_video":
      return "Reveal video";
    case "team_site":
      return "Team site";
    case "other":
      return "Source";
    default:
      return sourceType.replaceAll("_", " ");
  }
}
