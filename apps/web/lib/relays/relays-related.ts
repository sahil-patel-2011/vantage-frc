import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Related surfaces for AI relays (never a Freebuff wrapper). */
export const RELAYS_RELATED_LINKS = [
  { id: "connectors", label: "Connectors", kind: "path" as const, path: "/connectors" },
  { id: "video", label: "Video", kind: "path" as const, path: "/video-analysis" },
  { id: "storage", label: "Storage", kind: "path" as const, path: "/team/storage" },
] as const;

export type RelaysRelatedId = (typeof RELAYS_RELATED_LINKS)[number]["id"];

export type RelaysRelatedLink = {
  id: RelaysRelatedId;
  label: string;
  href: string;
};

/** Focused header strip — Connectors · Video · Storage. */
export const RELAYS_RELATED_INCLUDE: RelaysRelatedId[] = ["connectors", "video", "storage"];

export function relaysRelatedLinks(
  orgId?: string | null,
  options?: { active?: RelaysRelatedId; include?: RelaysRelatedId[] },
): RelaysRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return RELAYS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: withOrgHref(link.path, orgId),
  }));
}

export type RelaysShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type RelaysNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type RelaysEmptyCopy = {
  kind: RelaysShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type RelaysSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type RelayNode = {
  id: string;
  name: string;
  nodeVersion: string | null;
  queueDepth: number | null;
  tokensPerSecond: string | null;
  lastHeartbeatAt: string | null;
  roles: string[];
  instances: number | null;
  online: boolean;
};

export type RelaysSnapshot = { nodes: RelayNode[] };

export const RELAYS_PAGE_DESCRIPTION =
  "Paste the token the team's Raspberry Pi prints. Ask AI, Bugbot, assembly manuals, and video analysis run on that Pi — never a Freebuff website cookie, a browser extension, or a bookmarklet.";

function relaysRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    relaysRelatedLinks(orgId, { include: [...RELAYS_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = relaysRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function relaysSetupSteps(orgId?: string | null): RelaysSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team so the pasted token belongs to this shop.",
        href: "/workspace",
      },
    ];
  }
  return [];
}

export function isRelaysQueueEmpty(input: { nodeCount: number }): boolean {
  return input.nodeCount === 0;
}

export function classifyRelaysShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  nodeCount?: number;
  errorStatus?: number | null;
}): RelaysShellKind {
  if (input.loading) return "loading";
  if (!input.orgId) return "setup";
  if (input.fetchFailed && (input.nodeCount ?? 0) === 0) {
    if (input.errorStatus === 401 || input.errorStatus === 403) return "setup";
    return "error";
  }
  if (isRelaysQueueEmpty({ nodeCount: input.nodeCount ?? 0 })) return "empty";
  return "ready";
}

export function relaysShellCopy(kind: RelaysShellKind): RelaysEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading AI relays…",
        description: "Checking which team you are on and which Pis already checked in.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load AI relays",
        description: "A network or server issue blocked AI relays. Retry, or open Connectors while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before pasting the token the Raspberry Pi prints.",
      };
    case "empty":
      return {
        kind,
        badge: "No Pi yet",
        title: "Paste the token from the Pi",
        description:
          "Paste the token the installer prints. Never a Freebuff website cookie, a browser extension, or a bookmarklet.",
      };
    case "ready":
      return {
        kind,
        title: "AI relays",
        description: RELAYS_PAGE_DESCRIPTION,
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * Next actions for AI relays. Empty/setup keep one EmptyState primary;
 * the panel paints only on ready and never repeats the header strip.
 */
export function relaysNextActions(input: {
  orgId?: string | null;
  shell: RelaysShellKind;
  nodeCount?: number;
}): RelaysNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(relaysSetupSteps(orgId));
  }

  switch (input.shell) {
    case "loading":
    case "empty":
    case "error":
      return [];
    case "ready":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "paste",
          label: "Paste another token",
          detail: "Each Pi has its own token. Chat, agent, and video roles stay on the hardware you own.",
          href: "#relay-paste",
          primary: true,
        },
        {
          id: "chat",
          label: "Open Ask AI",
          detail: "Chat uses the shop Pi first, then the team's keys, then hosted keys.",
          href: hubHref("/ai", "chat", orgId),
        },
      ]);
    default: {
      const _exhaustive: never = input.shell;
      return _exhaustive;
    }
  }
}

export function labelRelayRole(role: string): string {
  switch (role) {
    case "chat":
      return "Ask AI";
    case "agent":
      return "Bugbot";
    case "video":
      return "Video";
    default:
      return role;
  }
}
