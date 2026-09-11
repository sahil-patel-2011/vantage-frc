import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Header strip for Parent updates — Calendar · People · Forms. */
export const PARENTS_RELATED_LINKS = [
  { id: "calendar", label: "Calendar", tab: "calendar" },
  { id: "attendance", label: "People", tab: "attendance" },
  { id: "team-forms", label: "Forms", tab: "team-forms" },
] as const;

export type ParentsRelatedId = (typeof PARENTS_RELATED_LINKS)[number]["id"];

export type ParentsRelatedLink = {
  id: ParentsRelatedId;
  label: string;
  href: string;
};

export const PARENTS_RELATED_INCLUDE: ParentsRelatedId[] = [
  "calendar",
  "attendance",
  "team-forms",
];

/**
 * Cross-links from Parent updates → Calendar / People / Forms.
 * Build with hubHref — never broken JSX href templates.
 */
export function parentsRelatedLinks(
  orgId?: string | null,
  options?: { active?: ParentsRelatedId; include?: ParentsRelatedId[] },
): ParentsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PARENTS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type ParentsShellKind = "loading" | "error" | "setup" | "restricted" | "empty" | "ready";

export type ParentsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ParentsEmptyCopy = {
  kind: ParentsShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ParentsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function parentsRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    parentsRelatedLinks(orgId, { include: [...PARENTS_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = parentsRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function parentsSetupSteps(orgId?: string | null): ParentsSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Parent updates.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
  ];
}

export function classifyParentsShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "restricted" | "ready" | null;
  orgId?: string | null;
  contactCount?: number;
}): ParentsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "restricted") return "restricted";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.contactCount ?? 0) === 0) return "empty";
  return "ready";
}

export function parentsShellCopy(kind: ParentsShellKind): ParentsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Parent updates…",
        description: "Checking which team you are on and parent contacts.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Parent updates",
        description:
          "A network or server issue blocked parent contacts. Retry, or open Calendar while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before adding parent contacts.",
      };
    case "restricted":
      return {
        kind,
        badge: "Ask a mentor",
        title: "Owners and admins send parent updates",
        description: "Ask a mentor if your family should get the weekly update.",
      };
    case "empty":
      return {
        kind,
        badge: "No contacts yet",
        title: "Add a parent contact",
        description: "Each family gets a private view link and the weekly digest.",
      };
    case "ready":
      return {
        kind,
        title: "Parent updates",
        description: "One-way weekly updates to parent contacts.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

/**
 * Next actions for Parent updates. Empty/setup keep one EmptyState primary;
 * Calendar / People / Forms stay in the header; the panel paints only on ready.
 */
export function parentsNextActions(input: {
  orgId?: string | null;
  shell: ParentsShellKind;
  contactCount?: number;
}): ParentsNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(parentsSetupSteps(orgId));
  }

  switch (input.shell) {
    case "loading":
    case "empty":
    case "error":
      return [];
    case "restricted":
      return [
        {
          id: "home",
          label: "Open Home",
          detail: "Parent contacts are for owners and admins.",
          href: withOrgHref("/dashboard", orgId),
          primary: true,
        },
      ];
    case "ready":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "digest",
          label: "Send this week's digest",
          detail: "The preview is the exact text every subscribed family receives.",
          href: withOrgHref("/parents", orgId) + "#parent-digest",
          primary: true,
        },
      ]);
    default: {
      const _never: never = input.shell;
      return _never;
    }
  }
}
