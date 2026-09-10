import { withOrgHref } from "../nav/product-nav";
import type { OfflineShellTier } from "../offline-shell/types";

/** Soft-UI shell kinds for `/offline` + `/offline-shell` — never DEMO sync counts. */
export type OfflineShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "setup"
  | "partial"
  | "error"
  | "offline_cold";

export type OfflineRelatedId =
  | "scouting"
  | "offline-shell"
  | "offline"
  | "schedule"
  | "calendar"
  | "todos"
  | "logistics"
  | "competition";

export type OfflineRelatedLink = {
  id: OfflineRelatedId;
  label: string;
  href: string;
};

/**
 * Soft-UI cross-links — Scouting first.
 * Build with withOrgHref so orgId survives venue Wi-Fi drops.
 */
export function offlineRelatedLinks(
  orgId?: string | null,
  options?: { active?: OfflineRelatedId; include?: OfflineRelatedId[] },
): OfflineRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  const all: OfflineRelatedLink[] = [
    { id: "scouting", label: "Scouting", href: withOrgHref("/scouting", orgId) },
    { id: "offline-shell", label: "This phone", href: withOrgHref("/offline-shell", orgId) },
    { id: "schedule", label: "Schedule", href: withOrgHref("/schedule", orgId) },
    { id: "offline", label: "Cold offline boot", href: withOrgHref("/offline", orgId) },
    { id: "calendar", label: "Team calendar", href: withOrgHref("/team/calendar", orgId) },
    { id: "todos", label: "Todos", href: withOrgHref("/todos", orgId) },
    { id: "logistics", label: "Logistics", href: withOrgHref("/logistics", orgId) },
    { id: "competition", label: "Competition hub", href: withOrgHref("/competition", orgId) },
  ];
  return all.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  });
}

/** Primary Soft-UI strip for Offline Shell readiness. */
export const OFFLINE_SHELL_RELATED_INCLUDE: OfflineRelatedId[] = [
  "scouting",
  "schedule",
  "offline",
  "calendar",
  "competition",
];

/** Soft-UI strip on the cold `/offline` boot page. */
export const OFFLINE_BOOT_RELATED_INCLUDE: OfflineRelatedId[] = [
  "scouting",
  "offline-shell",
  "schedule",
  "todos",
  "logistics",
];

export type OfflineNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type OfflineShellCopy = {
  kind: OfflineShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real outbox / sync counts only — blank until loaded; never invent DEMO totals. */
export function formatOfflineCount(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Status line for cold offline boot — only real IndexedDB outbox counts. */
export function offlineBootStatusLine(input: {
  online: boolean;
  loaded: boolean;
  entries: number;
  media: number;
  orgRemembered: boolean;
}): string {
  const net = input.online ? "Online" : "Offline";
  if (!input.loaded) return `${net} · checking this device…`;
  const queued = input.entries + input.media;
  const outbox =
    queued > 0
      ? `${formatOfflineCount(input.entries, true)} scout entries · ${formatOfflineCount(input.media, true)} media queued`
      : "scout outbox empty";
  const team = input.orgRemembered ? " · team remembered" : "";
  return `${net} · ${outbox}${team}`;
}

/** Classify Offline Shell Soft-UI from API + readiness tier. */
export function classifyOfflineShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  tier?: OfflineShellTier | null;
  totalEvents?: number;
}): OfflineShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required") return "setup";
  if (input.status !== "live") return "error";
  if ((input.totalEvents ?? 0) === 0) return "empty";
  if (input.tier === "ready") return "ready";
  // partial + not_ready both need more real sync evidence — never invent progress.
  return "partial";
}

/** Soft-UI empty / setup / readiness copy — never DEMO sync counts. */
export function offlineShellCopy(kind: OfflineShellKind): OfflineShellCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Checking this phone…",
        description: "Checking whether Scouting and the schedule are saved on this device.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup",
        title: "Choose your team",
        description:
          "Readiness is per team. Choose your team first. Device counts stay at zero until then.",
      };
    case "empty":
      return {
        kind,
        badge: "Not ready",
        title: "Nothing saved on this phone yet",
        description:
          "Open Scouting once while you have signal. Empty stays empty until then.",
      };
    case "partial":
      return {
        kind,
        badge: "Partial",
        title: "Shell partially ready",
        description:
          "Some devices or routes are covered. Finish missing routes and offline verification from real logs only.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not check this phone",
        description: "A network or server issue blocked status. Retry, or open Scouting if this device already cached forms.",
      };
    case "offline_cold":
      return {
        kind,
        badge: "Offline",
        title: "You're offline",
        description:
          "Venue Wi-Fi dropped. Pages you've already visited load from the app shell. Scouting keeps saving to this device until sync returns.",
      };
    default:
      return {
        kind: "ready",
        badge: "Ready",
        title: "This phone is ready",
        description:
          "Pages you opened while online stay available. Open Scouting after each deploy so a cold no-signal load still works.",
      };
  }
}

/**
 * Next actions for Offline Shell readiness UI.
 * Always surfaces Scouting — never invents DEMO sync counts.
 */
export function offlineShellNextActions(input: {
  orgId?: string | null;
  shell: OfflineShellKind;
  recommendations?: string[];
}): OfflineNextAction[] {
  const orgId = input.orgId ?? null;
  const scoutHref = withOrgHref("/scouting", orgId);
  const shellHref = withOrgHref("/offline-shell", orgId);
  const offlineHref = withOrgHref("/offline", orgId);
  const actions: OfflineNextAction[] = [];

  if (!orgId || input.shell === "setup") {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Readiness and sync logs are saved per team — choose your team first.",
        href: "/workspace",
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Match and pit forms keep working on this device once you open them while online.",
        href: "/scouting",
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry this phone",
        detail: "Reload the last recorded syncs.",
        href: shellHref,
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Forms may still work from this device's cache and outbox.",
        href: scoutHref,
      },
    ];
  }

  if (input.shell === "empty") {
    actions.push({
      id: "scouting",
      label: "Open Scouting once online",
      detail: "Warm the shell and event cache on this device before you need a cold no-signal load.",
      href: scoutHref,
      primary: true,
    });
    actions.push({
      id: "log-sync",
      label: "Mark this phone ready",
      detail: "After you open Scouting once, record this device below.",
      href: "#offline-shell-log",
    });
  } else if (input.shell === "partial") {
    actions.push({
      id: "scouting",
      label: "Finish opening Scouting",
      detail: input.recommendations?.[0] ?? "Open Scouting on this phone once while you have signal.",
      href: scoutHref,
      primary: true,
    });
    actions.push({
      id: "verify",
      label: "Verify cold offline boot",
      detail: "Toggle airplane mode and reopen /offline — then log network status as Offline.",
      href: offlineHref,
    });
  } else if (input.shell === "ready") {
    actions.push({
      id: "scouting",
      label: "Open Scouting",
      detail: "Shell looks ready from logged syncs — use Scouting at the venue; outbox holds entries without signal.",
      href: scoutHref,
      primary: true,
    });
  } else {
    actions.push({
      id: "scouting",
      label: "Open Scouting",
      detail: "Primary offline-capable surface — forms + outbox on this device.",
      href: scoutHref,
      primary: true,
    });
  }

  actions.push(
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Match board shell loads from cache after one online visit.",
      href: withOrgHref("/schedule", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "offline",
      label: "Cold offline boot",
      detail: "Precached fallback when navigation fails with no signal.",
      href: offlineHref,
    },
  );

  return actions.slice(0, 5);
}

/**
 * Next actions for the public `/offline` cold-boot Soft-UI.
 * Uses real outbox counts only — never DEMO sync totals.
 */
export function offlineBootNextActions(input: {
  orgId?: string | null;
  online: boolean;
  loaded: boolean;
  pendingEntries: number;
  pendingMedia: number;
}): OfflineNextAction[] {
  const orgId = input.orgId ?? null;
  const scoutHref = withOrgHref("/scouting", orgId);
  const shellHref = withOrgHref("/offline-shell", orgId);
  const queued = input.pendingEntries + input.pendingMedia;
  const actions: OfflineNextAction[] = [];

  actions.push({
    id: "scouting",
    label: input.online ? "Open Scouting" : "Continue Scouting offline",
    detail: orgId
      ? queued > 0 && input.loaded
        ? `${formatOfflineCount(queued, true)} item(s) waiting in this device's outbox — sync when Wi-Fi returns.`
        : "Match and pit forms stay on this device."
      : "Open once online from a team so the event cache is ready.",
    href: scoutHref,
    primary: true,
  });

  if (!input.online && queued > 0 && input.loaded) {
    actions.push({
      id: "stay",
      label: "Keep this page open when sync returns",
      detail: "Queued entries upload when Wi-Fi returns. Counts come from this device.",
      href: scoutHref,
    });
  }

  actions.push(
    {
      id: "offline-shell",
      label: "Check this phone",
      detail: "See which devices saved Scouting for a no-signal load.",
      href: shellHref,
    },
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Last match board cached after an online visit.",
      href: withOrgHref("/schedule", orgId),
    },
  );

  return actions.slice(0, 4);
}

/** Soft-UI badge tone for readiness tier — empty until real events exist. */
export function offlineReadinessTone(tier: OfflineShellTier | null | undefined): "good" | "setup" | "demo" | "" {
  if (!tier) return "";
  if (tier === "ready") return "good";
  if (tier === "partial") return "setup";
  return "demo";
}
