import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for main Scouting Hub (never DEMO entries). */
export const SCOUTING_RELATED_LINKS = [
  { id: "forms", label: "Form builder", kind: "hub" as const, tab: "forms" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "offline", label: "Offline", kind: "path" as const, path: "/offline" },
  { id: "offline-shell", label: "Offline Shell", kind: "path" as const, path: "/offline-shell" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
  { id: "handoff", label: "QR handoff", kind: "hub" as const, tab: "scouting" },
] as const;

export type ScoutingRelatedId = (typeof SCOUTING_RELATED_LINKS)[number]["id"];

export type ScoutingRelatedLink = {
  id: ScoutingRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Forms · Coverage · Strategy · Offline. */
export const SCOUTING_RELATED_INCLUDE: ScoutingRelatedId[] = [
  "forms",
  "coverage",
  "strategy",
  "offline",
];

/**
 * Soft-UI cross-links from Scouting → Forms / Coverage / Strategy / Offline.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function scoutingRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutingRelatedId; include?: ScoutingRelatedId[] },
): ScoutingRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUTING_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      const href = hubHref("/competition", link.tab, orgId);
      if (link.id === "handoff") {
        return { id: link.id, label: link.label, href: `${href}&scoutTab=handoff` };
      }
      return { id: link.id, label: link.label, href };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type ScoutingShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutingNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutingEmptyCopy = {
  kind: ScoutingShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO entries. */
export type ScoutingSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutingSetupSteps(orgId?: string | null): ScoutingSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Scouting is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Event Day Command picks the TBA event match and pit forms use.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "forms",
      label: "Open Form builder",
      detail: "Publish a real match or pit schema — never DEMO fields.",
      href: hubHref("/competition", "forms", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Lineup gaps stay blank until real scout rows exist — never DEMO %.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "offline",
      label: "Open Offline",
      detail: "Confirm this device can cold-boot forms when venue Wi-Fi drops.",
      href: withOrgHref("/offline", orgId),
    },
  ];
}

/** Real entry / queue counts only — never invent DEMO totals. */
export function formatScoutingMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed recent-entry lists until real Neon rows exist — avoids DEMO entries. */
export function shouldShowScoutingRecentEntries(entryCount: number): boolean {
  return entryCount > 0;
}

/** True when the hub has an event but no published form for the active tab. */
export function isScoutingFormEmpty(input: { hasSchema: boolean }): boolean {
  return !input.hasSchema;
}

/**
 * Soft-UI OfflineBanner detail from real outbox counts only — never DEMO sync counts.
 * Returns undefined so OfflineBanner can use its default Soft-UI copy when idle online.
 */
export function scoutingOfflineBannerDetail(input: {
  online: boolean;
  syncState: "idle" | "syncing" | "degraded";
  pendingEntries: number;
  pendingMedia: number;
}): string | undefined {
  const pending = Math.max(0, input.pendingEntries) + Math.max(0, input.pendingMedia);
  if (!input.online) {
    return `Forms keep working on this device. ${pending} item${pending === 1 ? "" : "s"} waiting to sync. Use QR handoff if another device has signal.`;
  }
  if (input.syncState === "degraded") {
    return `Outbox retrying with backoff · ${Math.max(0, input.pendingEntries)} entries · ${Math.max(0, input.pendingMedia)} media queued. QR handoff works without the server.`;
  }
  if (input.syncState === "syncing") {
    return `Uploading ${pending} queued item${pending === 1 ? "" : "s"}…`;
  }
  return undefined;
}

/** Classify main Scouting Soft-UI shell — never invents DEMO entries. */
export function classifyScoutingShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  eventKey?: string | null;
  hasSchema?: boolean;
}): ScoutingShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed && !input.eventKey) return "error";
  if (!input.orgId || !input.eventKey) return "setup";
  if (isScoutingFormEmpty({ hasSchema: Boolean(input.hasSchema) })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO entries. */
export function scoutingShellCopy(kind: ScoutingShellKind): ScoutingEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading scouting…",
        description:
          "Checking workspace, active event, and published forms — never DEMO entries.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load scouting",
        description:
          "A network or server issue blocked bootstrap. Retry, or open Forms / Coverage / Strategy / Offline while it reloads — never invent DEMO entries.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace and event",
        description:
          "Scouting is org- and event-scoped. Pick a workspace and active TBA event before match and pit forms load — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "Forms required",
        title: "No scouting form yet",
        description:
          "Publish a match or pit schema before scouts enter rows. Coverage and Strategy stay blank until real entries sync — never DEMO entries.",
      };
    default:
      return {
        kind: "ready",
        title: "Scouting Hub",
        description:
          "Match and pit forms cache on this device. Coverage stays empty until real scout rows exist — never DEMO entries.",
      };
  }
}

/**
 * Soft-UI next actions for Scouting empty/setup shells.
 * Points at Forms / Coverage / Strategy / Offline — never invents DEMO entries.
 */
export function scoutingNextActions(input: {
  orgId?: string | null;
  shell: ScoutingShellKind;
  eventKey?: string | null;
  canManageSchemas?: boolean;
  entryType?: "match" | "pit";
}): ScoutingNextAction[] {
  const orgId = input.orgId ?? null;
  const eventKey = input.eventKey ?? null;
  const typeLabel = input.entryType === "pit" ? "pit" : "match";

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Scouting is org-scoped — choose a team before caching forms offline.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "forms",
          label: "Open Form builder",
          detail: "Schemas stay blank until you publish a real form — never DEMO fields.",
          href: hubHref("/competition", "forms", null),
        },
        {
          id: "coverage",
          label: "Open Coverage",
          detail: "Lineup gaps stay blank until real scout rows exist — never DEMO %.",
          href: withOrgHref("/scouting/lineup", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist — never DEMO rankings.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "offline",
          label: "Open Offline",
          detail: "Confirm cold-boot readiness when venue Wi-Fi drops.",
          href: withOrgHref("/offline", null),
        },
      ];
    }
    if (!eventKey) {
      return [
        {
          id: "command",
          label: "Set active event",
          detail: "Event Day Command picks the TBA event match and pit forms use.",
          href: hubHref("/competition", "command", orgId),
          primary: true,
        },
        {
          id: "forms",
          label: "Open Form builder",
          detail: "Publish a schema so scouts can fill real rows once the event is set.",
          href: hubHref("/competition", "forms", orgId),
        },
        {
          id: "coverage",
          label: "Open Coverage",
          detail: "Coverage stays honest when the event is unset — never DEMO %.",
          href: withOrgHref("/scouting/lineup", orgId),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Strategy waits on the same real event context — never DEMO win rates.",
          href: hubHref("/competition", "strategy", orgId),
        },
        {
          id: "offline",
          label: "Open Offline",
          detail: "Cache the offline shell before heading into a dead zone.",
          href: withOrgHref("/offline", orgId),
        },
      ];
    }
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry scouting",
        detail: "Reload real event context and schemas — nothing is pre-seeded while this fails.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Form schemas stay available while bootstrap reloads.",
        href: hubHref("/competition", "forms", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Coverage stays available while scouting reloads.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while scouting reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "offline",
        label: "Open Offline",
        detail: "Use offline forms if venue Wi-Fi is the blocker.",
        href: withOrgHref("/offline", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "forms",
        label: input.canManageSchemas ? "Open Form builder" : "Ask for Form builder",
        detail: input.canManageSchemas
          ? `Publish a ${typeLabel} schema, or create starter forms — never DEMO fields.`
          : `Ask an owner or admin to publish a ${typeLabel} form — never DEMO fields.`,
        href: hubHref("/competition", "forms", orgId),
        primary: true,
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Gaps stay blank until scouts enter real rows — never DEMO %.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Pick desk waits on synced scout notes — never DEMO entries.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "offline",
        label: "Open Offline",
        detail: "Confirm this device can still cache forms without signal.",
        href: withOrgHref("/offline", orgId),
      },
    ];
  }

  return [
    {
      id: "forms",
      label: "Open Form builder",
      detail: "Adjust the published schema if scouts need different fields.",
      href: hubHref("/competition", "forms", orgId),
      primary: true,
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "See which matches and teams still need scouts — never DEMO %.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Cross-check pick desk and win/loss against synced scout notes.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "offline",
      label: "Open Offline",
      detail: "Cold-boot readiness when venue Wi-Fi drops — never DEMO sync counts.",
      href: withOrgHref("/offline", orgId),
    },
  ];
}
