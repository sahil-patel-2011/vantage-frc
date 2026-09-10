import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";
import { githubConnectionHref } from "../github/github-related";

/** Soft-UI related surfaces for Pair VS Code (never DEMO pairing metrics). */
export const PAIR_RELATED_LINKS = [
  { id: "code", label: "Code Coach", kind: "build" as const, tab: "code" },
  {
    id: "github",
    label: "GitHub context",
    kind: "path" as const,
    path: "/team/admin",
    hash: "#github-connection",
  },
  { id: "chat", label: "AI chat", kind: "ai" as const, tab: "chat" },
  { id: "pair", label: "Pair VS Code", kind: "path" as const, path: "/editor/pair" },
] as const;

export type PairRelatedId = (typeof PAIR_RELATED_LINKS)[number]["id"];

export type PairRelatedLink = {
  id: PairRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Code Coach / GitHub / AI first. */
export const PAIR_RELATED_INCLUDE: PairRelatedId[] = ["code", "github", "chat"];

/**
 * Soft-UI cross-links from Pair VS Code → Code Coach / GitHub / AI.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function pairRelatedLinks(
  orgId?: string | null,
  options?: { active?: PairRelatedId; include?: PairRelatedId[] },
): PairRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PAIR_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    if (link.kind === "ai") {
      return { id: link.id, label: link.label, href: hubHref("/ai", link.tab, orgId) };
    }
    const hash = "hash" in link ? link.hash : "";
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) + hash };
  });
}

export type PairShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PairNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type PairEmptyCopy = {
  kind: PairShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO pairing metrics. */
export type PairSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function pairSetupSteps(orgId?: string | null): PairSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open pairing.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "code",
      label: "Open Code Coach",
      detail: "Local pattern review stays blank until you paste real robot source.",
      href: hubHref("/build", "code", orgId),
    },
    {
      id: "github",
      label: "Connect GitHub",
      detail: "Optional repo context stays disconnected until you link it.",
      href: githubConnectionHref(orgId),
    },
    {
      id: "chat",
      label: "Open AI chat",
      detail: "Team assistant uses plan credits separately from editor pairing.",
      href: hubHref("/ai", "chat", orgId),
    },
  ];
}

/** Real paired-device counts only — never invent DEMO totals. */
export function formatPairMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed gate tiles when no editors are paired. */
export function shouldShowPairSummaryTiles(input: { deviceCount: number }): boolean {
  return input.deviceCount > 0;
}

/** True when the member has no paired editors — Soft-UI empty. */
export function isPairBoardEmpty(input: { deviceCount: number }): boolean {
  return input.deviceCount === 0;
}

/** Classify Pair VS Code Soft-UI shell — never invents DEMO pairing metrics. */
export function classifyPairShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  hasOrgs?: boolean;
  orgId?: string | null;
  deviceCount?: number;
}): PairShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.hasOrgs || !input.orgId) return "setup";
  if (isPairBoardEmpty({ deviceCount: input.deviceCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO pairing metrics. */
export function pairShellCopy(kind: PairShellKind): PairEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Pair VS Code…",
        description:
          "Checking which team you are on and real paired editors.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Pair VS Code",
        description:
          "A network or server issue blocked pairing. Retry, or open Code Coach / GitHub / AI while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Join or pick a team before approving a VS Code code.",
      };
    case "empty":
      return {
        kind,
        badge: "No editors paired yet",
        title: "Approve your first editor",
        description:
          "Paired devices stay blank until you approve a real code from the Vantage VS Code extension. Cross-check Code Coach, GitHub, and AI.",
      };
    default:
      return {
        kind: "ready",
        title: "Paired editors",
        description:
          "Only editors you approved appear here — counts use real device rows.",
      };
  }
}

/**
 * Soft-UI next actions for Pair VS Code empty/setup shells.
 * Points at Code Coach / GitHub / AI — never invents DEMO pairing metrics.
 */
export function pairNextActions(input: {
  orgId?: string | null;
  shell: PairShellKind;
  deviceCount?: number;
  hasCode?: boolean;
}): PairNextAction[] {
  const orgId = input.orgId ?? null;
  const deviceCount = input.deviceCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of pairSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(pairSetupSteps(orgId));
  }

  if (input.shell === "empty" || deviceCount === 0) {
    return [
      {
        id: "approve",
        label: input.hasCode ? "Approve this code" : "Enter a pairing code",
        detail: input.hasCode
          ? "Confirm the code shown in your editor — only approve a machine you control."
          : "Start Pair in the Vantage VS Code extension, then enter the short code here.",
        href: "#pair-approve",
        primary: true,
      },
      {
        id: "code",
        label: "Open Code Coach",
        detail: "Review robot source locally after pairing.",
        href: hubHref("/build", "code", orgId),
      },
      {
        id: "github",
        label: "Connect GitHub",
        detail: "Optional: hydrate file content from your default repo after you link it.",
        href: githubConnectionHref(orgId),
      },
      {
        id: "chat",
        label: "Open AI chat",
        detail: "Share opt-in editor context into Team Assistant when you need generative help.",
        href: hubHref("/ai", "chat", orgId),
      },
    ];
  }

  return [
    {
      id: "code",
      label: "Open Code Coach",
      detail: `${deviceCount} paired editor${deviceCount === 1 ? "" : "s"} — review pasted source with local rules only.`,
      href: hubHref("/build", "code", orgId),
      primary: true,
    },
    {
      id: "github",
      label: "Connect GitHub",
      detail: "Optional repo context for Code Coach.",
      href: githubConnectionHref(orgId),
    },
    {
      id: "chat",
      label: "Open AI chat",
      detail: "Opt-in editor shares land in Team Assistant — metered separately from pairing.",
      href: hubHref("/ai", "chat", orgId),
    },
    {
      id: "approve-another",
      label: "Pair another editor",
      detail: "Approve a new short code from VS Code or Cursor on another machine.",
      href: "#pair-approve",
    },
  ];
}
