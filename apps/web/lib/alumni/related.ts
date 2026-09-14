import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Alumni (never DEMO classmates). */
export const ALUMNI_RELATED_LINKS = [
  { id: "alumni-network", label: "Alumni network", path: "/alumni-network" },
  { id: "team-alumni", label: "Team alumni", path: "/team/alumni" },
  { id: "team-knowledge", label: "Team knowledge", path: "/team/knowledge" },
  { id: "workspace", label: "Your team", path: "/workspace" },
] as const;

export type AlumniRelatedId = (typeof ALUMNI_RELATED_LINKS)[number]["id"];

export type AlumniRelatedLink = {
  id: AlumniRelatedId;
  label: string;
  href: string;
};

export const ALUMNI_RELATED_INCLUDE: AlumniRelatedId[] = [
  "alumni-network",
  "team-knowledge",
  "workspace",
];

export function alumniRelatedLinks(
  orgId?: string | null,
  options?: { active?: AlumniRelatedId; include?: AlumniRelatedId[] },
): AlumniRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ALUMNI_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: withOrgHref(link.path, orgId),
  }));
}

export type AlumniShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type AlumniEmptyCopy = {
  kind: AlumniShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type AlumniNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/** Real alumni counts only — never invent DEMO classmates. */
export function formatAlumniMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Classify Alumni Soft-UI shell — empty when zero persisted rows, never DEMO. */
export function classifyAlumniShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  alumniCount?: number;
}): AlumniShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId) return "setup";
  if ((input.alumniCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO classmates. */
export function alumniShellCopy(kind: AlumniShellKind): AlumniEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Alumni",
        description: "Checking which team you are on and persisted alumni rows.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load alumni",
        description:
          "A network or server issue blocked the directory. Retry — the list stays empty rather than inventing classmates.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before adding graduates.",
      };
    case "empty":
      return {
        kind,
        badge: "No alumni yet",
        title: "Add your first alumni profile",
        description:
          "The directory stays blank until someone records a real graduate.",
      };
    default:
      return {
        kind: "ready",
        title: "Alumni directory",
        description: "These are graduates your team recorded — counts come only from persisted rows.",
      };
  }
}

export function alumniNextActions(input: {
  orgId?: string | null;
  shell: AlumniShellKind;
  alumniCount?: number;
}): AlumniNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before recording graduates.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "alumni-network",
        label: "Open Alumni network",
        detail: "Mentor slots stay blank until real alumni exist.",
        href: withOrgHref("/alumni-network", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry alumni",
        detail: "Reload persisted rows.",
        href: withOrgHref("/team/alumni", orgId),
        primary: true,
      },
      {
        id: "alumni-network",
        label: "Open Alumni network",
        detail: "The richer directory uses the same real rows.",
        href: withOrgHref("/alumni-network", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (input.alumniCount ?? 0) === 0) {
    return [
      {
        id: "add",
        label: "Add the first alum",
        detail: "Record a real graduate — the network stays empty until you do.",
        href: "#alumni-add",
        primary: true,
      },
      {
        id: "alumni-network",
        label: "Open Alumni network",
        detail: "Mentor availability windows attach to persisted profiles only.",
        href: withOrgHref("/alumni-network", orgId),
      },
    ];
  }

  return [
    {
      id: "directory",
      label: "Review alumni",
      detail: `${input.alumniCount} recorded graduate${input.alumniCount === 1 ? "" : "s"}`,
      href: withOrgHref("/team/alumni", orgId),
      primary: true,
    },
    {
      id: "alumni-network",
      label: "Open Alumni network",
      detail: "Log mentor office hours against these real profiles.",
      href: withOrgHref("/alumni-network", orgId),
    },
    {
      id: "team-knowledge",
      label: "Open Team knowledge",
      detail: "Handoff notes stay in the wiki — they are not invented alumni.",
      href: withOrgHref("/team/knowledge", orgId),
    },
  ];
}
