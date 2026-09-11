import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Knowledge-gap detective (never DEMO wiki gaps). */
export const KNOWLEDGE_GAP_RELATED_LINKS = [
  { id: "knowledge", label: "Knowledge", tab: "knowledge" },
  { id: "todos", label: "Work", tab: "todos" },
  { id: "meeting-autopilot", label: "Meeting Autopilot", tab: "meeting-autopilot" },
] as const;

export type KnowledgeGapRelatedId = (typeof KNOWLEDGE_GAP_RELATED_LINKS)[number]["id"];

export type KnowledgeGapRelatedLink = {
  id: KnowledgeGapRelatedId;
  label: string;
  href: string;
};

export const KNOWLEDGE_GAP_RELATED_INCLUDE: KnowledgeGapRelatedId[] = [
  "knowledge",
  "todos",
  "meeting-autopilot",
];

export function knowledgeGapRelatedLinks(
  orgId?: string | null,
  options?: { active?: KnowledgeGapRelatedId; include?: KnowledgeGapRelatedId[] },
): KnowledgeGapRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return KNOWLEDGE_GAP_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type KnowledgeGapShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type KnowledgeGapNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type KnowledgeGapEmptyCopy = {
  kind: KnowledgeGapShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type KnowledgeGapSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function knowledgeGapSetupSteps(orgId?: string | null): KnowledgeGapSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open gap scans.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "knowledge",
      label: "Open Knowledge wiki",
      detail: "Pages you write here are the coverage source.",
      href: hubHref("/team", "knowledge", orgId),
    },
    {
      id: "todos",
      label: "Open Work",
      detail: "To-dos, build tasks, and milestones are the only subjects the detective can scan.",
      href: hubHref("/team", "todos", orgId),
    },
  ];
}

export function formatKnowledgeGapMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowKnowledgeGapSummaryTiles(itemCount: number, hasScan: boolean): boolean {
  return hasScan || itemCount > 0;
}

export function classifyKnowledgeGapShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  hasScan?: boolean;
  itemCount?: number;
}): KnowledgeGapShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (!input.hasScan) return "empty";
  return "ready";
}

export function knowledgeGapShellCopy(kind: KnowledgeGapShellKind): KnowledgeGapEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Knowledge-gap detective…",
        description: "Checking which team you are on and wiki coverage.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Knowledge-gap detective",
        description:
          "A network or server issue blocked the scan. Retry, or open the wiki while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before scanning.",
      };
    case "empty":
      return {
        kind,
        badge: "No scan yet",
        title: "Run your first coverage scan",
        description:
          "Diffs real work items against real wiki pages.",
      };
    default:
      return {
        kind: "ready",
        title: "Documentation coverage",
        description: "Gaps from real wiki diffs only.",
      };
  }
}

export function knowledgeGapNextActions(input: {
  orgId?: string | null;
  shell: KnowledgeGapShellKind;
  itemCount?: number;
  hasScan?: boolean;
}): KnowledgeGapNextAction[] {
  const orgId = input.orgId ?? null;
  const itemCount = input.itemCount ?? 0;
  const hasScan = input.hasScan ?? false;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before running a scan.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "knowledge",
          label: "Open Knowledge",
          detail: "Wiki coverage stays blank until pages exist.",
          href: hubHref("/team", "knowledge", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Knowledge-gap can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Write wiki pages the detective will treat as coverage.",
        href: hubHref("/team", "knowledge", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Knowledge-gap",
        detail: "Reload real wiki diffs.",
        href: withOrgHref("/knowledge-gap", orgId),
        primary: true,
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "The wiki stays available while the scan reloads.",
        href: hubHref("/team", "knowledge", orgId),
      },
    ];
  }

  if (input.shell === "empty" || !hasScan) {
    return [
      {
        id: "run-scan",
        label: "Run coverage scan",
        detail: "Gaps stay blank until you scan real work items and wiki pages.",
        href: "#knowledge-gap-scan",
        primary: true,
      },
      {
        id: "knowledge",
        label: "Open Knowledge",
        detail: "Add wiki pages before or after the scan.",
        href: hubHref("/team", "knowledge", orgId),
      },
      {
        id: "todos",
        label: "Open Work",
        detail: "Add to-dos, build tasks, or milestones before gaps can appear.",
        href: hubHref("/team", "todos", orgId),
      },
    ];
  }

  return [
    {
      id: itemCount > 0 ? "draft-stubs" : "rescan",
      label: itemCount > 0 ? "Draft stub pages" : "Re-scan coverage",
      detail:
        itemCount > 0
          ? `${itemCount} undocumented work item${itemCount === 1 ? "" : "s"} from real wiki diffs.`
          : "Coverage is complete for this scan — re-run after new work lands.",
      href: itemCount > 0 ? "#knowledge-gap-items" : "#knowledge-gap-scan",
      primary: true,
    },
    {
      id: "knowledge",
      label: "Open Knowledge",
      detail: "Edit wiki pages that close open gaps.",
      href: hubHref("/team", "knowledge", orgId),
    },
    {
      id: "meeting",
      label: "Open Meeting Autopilot",
      detail: "Turn undocumented work into agenda items.",
      href: hubHref("/team", "meeting-autopilot", orgId),
    },
  ];
}
