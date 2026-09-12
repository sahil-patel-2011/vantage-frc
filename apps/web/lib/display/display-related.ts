import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related Event Day / Strategy surfaces for pit Displays (never DEMO placeholders). */
export const DISPLAY_RELATED_LINKS = [
  { id: "command", label: "Event Day", kind: "competition" as const, tab: "command" },
  { id: "strategy", label: "Strategy", kind: "competition" as const, tab: "strategy" },
  { id: "scouting", label: "Scouting", kind: "competition" as const, tab: "scouting" },
  { id: "match-checklist", label: "Match checklist", kind: "competition" as const, tab: "match-checklist" },
  { id: "team-data", label: "Team data", kind: "path" as const, path: "/team/data" },
] as const;

export type DisplayRelatedId = (typeof DISPLAY_RELATED_LINKS)[number]["id"];

export type DisplayRelatedLink = {
  id: DisplayRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip on Display setup — Event Day + Strategy first. */
export const DISPLAY_RELATED_INCLUDE: DisplayRelatedId[] = [
  "command",
  "strategy",
  "scouting",
  "match-checklist",
];

/** Cross-links for Display Soft-UI (never DEMO match/rank fillers). */
export function displayRelatedLinks(
  orgId?: string | null,
  options?: { active?: DisplayRelatedId; include?: DisplayRelatedId[] },
): DisplayRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DISPLAY_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type DisplayNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for pit Display setup / empty boards.
 * Points at real Event Day, Strategy, and board pairing — never DEMO schedules or ranks.
 */
export function displaySetupNextActions(input: {
  orgId?: string | null;
  boardCount?: number;
  activeTokenCount?: number;
  hasActiveEvent?: boolean | null;
}): DisplayNextAction[] {
  const orgId = input.orgId ?? null;
  const boardCount = input.boardCount ?? 0;
  const activeTokenCount = input.activeTokenCount ?? 0;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Pit TV boards are saved per team — choose a team before creating a layout.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: DisplayNextAction[] = [];
  const setupHref = withOrgHref("/display", orgId);

  if (boardCount === 0) {
    actions.push({
      id: "create-board",
      label: "Create your first board",
      detail: "Pick a preset below and save. Countdowns, ranks, and odds stay blank until official matches and Strategy sync real data.",
      href: setupHref,
      primary: true,
    });
  } else if (activeTokenCount === 0) {
    actions.push({
      id: "mint-token",
      label: "Pair a pit TV",
      detail: "Mint a read-only token, then open /display/pit on the TV or a Raspberry Pi Chromium kiosk.",
      href: setupHref,
      primary: true,
    });
  } else {
    actions.push({
      id: "open-kiosk",
      label: "Open a paired board",
      detail: "Fullscreen uses live snapshots only — empty widgets stay empty until the active event has real rows.",
      href: setupHref,
      primary: true,
    });
  }

  if (input.hasActiveEvent === false) {
    actions.push({
      id: "event",
      label: "Set active event",
      detail: "Event Day picks the official schedule and context pit boards read for next match and coverage.",
      href: hubHref("/competition", "command", orgId),
      primary: boardCount > 0 && activeTokenCount > 0,
    });
  }

  actions.push(
    {
      id: "command",
      label: "Open Event Day",
      detail: "Confirm the active event and synced schedule before expecting match countdowns on TV.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Score a stored prediction so Win Prediction boards can show model odds from real metrics.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "team-data",
      label: "Sync team data",
      detail: "Pull rankings when ranks or matches are missing from the display.",
      href: withOrgHref("/team/data", orgId),
    },
  );

  return actions;
}

/** Setup wizard step from real board/token counts — never invents DEMO progress. */
export function displaySetupStep(boardCount: number, activeTokenCount: number): 1 | 2 | 3 {
  if (boardCount <= 0) return 1;
  if (activeTokenCount <= 0) return 2;
  return 3;
}
