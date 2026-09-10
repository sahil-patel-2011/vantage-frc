import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for QR scout handoff (never DEMO outbox rows). */
export const QR_HANDOFF_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "offline", label: "Offline", kind: "path" as const, path: "/offline" },
  { id: "offline-shell", label: "This phone", kind: "path" as const, path: "/offline-shell" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "disagreements", label: "Disagreements", kind: "path" as const, path: "/scout-disagreements" },
] as const;

export type QrHandoffRelatedId = (typeof QR_HANDOFF_RELATED_LINKS)[number]["id"];

export type QrHandoffRelatedLink = {
  id: QrHandoffRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Offline. */
export const QR_HANDOFF_RELATED_INCLUDE: QrHandoffRelatedId[] = ["scouting", "offline"];

/**
 * Soft-UI cross-links from QR handoff → Scouting / Offline.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function qrHandoffRelatedLinks(
  orgId?: string | null,
  options?: { active?: QrHandoffRelatedId; include?: QrHandoffRelatedId[] },
): QrHandoffRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return QR_HANDOFF_RELATED_LINKS.filter((link) => {
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

export type QrHandoffShellKind = "loading" | "error" | "setup" | "empty" | "ready";

/** Distinguishes an empty outbox from a queue cleared by a successful sync. */
export type QrHandoffQueueTone = "loading" | "queued" | "clear" | "synced";

export type QrHandoffNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type QrHandoffEmptyCopy = {
  kind: QrHandoffShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type QrHandoffQueueCopy = {
  tone: QrHandoffQueueTone;
  badge: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO outbox rows. */
export type QrHandoffSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function qrHandoffSetupSteps(orgId?: string | null): QrHandoffSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open QR handoff.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Publish a match or pit form, then save offline entries before sharing a QR.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "offline",
      label: "Open Offline",
      detail: "Confirm this device can cold-boot forms when venue Wi-Fi drops.",
      href: withOrgHref("/offline", orgId),
    },
    {
      id: "offline-shell",
      label: "Open this phone",
      detail: "Open Scouting once while you have signal so a no-signal load still works.",
      href: withOrgHref("/offline-shell", orgId),
    },
  ];
}

/** Real pending counts only — never invent DEMO totals. */
export function formatQrHandoffMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** True when the device outbox has nothing pending — Soft-UI empty until rows exist or sync lands. */
export function isQrHandoffQueueEmpty(input: { pendingCount: number }): boolean {
  return input.pendingCount === 0;
}

/**
 * Classify clear-queue vs synced vs queued.
 * Synced = outbox empty because a real sync acknowledged rows (not the same as never queued).
 */
export function classifyQrHandoffQueue(input: {
  loaded?: boolean;
  pendingCount?: number;
  lastSyncedCount?: number;
}): QrHandoffQueueTone {
  if (!input.loaded) return "loading";
  const pending = input.pendingCount ?? 0;
  const synced = input.lastSyncedCount ?? 0;
  if (pending > 0) return "queued";
  if (synced > 0) return "synced";
  return "clear";
}

/** Soft-UI badge / title / description for queue tone — never DEMO outbox rows. */
export function qrHandoffQueueCopy(input: {
  loaded?: boolean;
  pendingCount?: number;
  lastSyncedCount?: number;
}): QrHandoffQueueCopy {
  const tone = classifyQrHandoffQueue(input);
  const pending = input.pendingCount ?? 0;
  const synced = input.lastSyncedCount ?? 0;
  switch (tone) {
    case "loading":
      return {
        tone,
        badge: "…",
        title: "Checking this device…",
        description: "Reading the IndexedDB outbox — counts stay blank until this device answers.",
      };
    case "queued":
      return {
        tone,
        badge: `${formatQrHandoffMetric(pending, true)} pending`,
        title: "Entries waiting on this device",
        description: `Show a handoff QR so another tablet can merge these ${formatQrHandoffMetric(pending, true)} outbox row${pending === 1 ? "" : "s"} offline.`,
      };
    case "synced":
      return {
        tone,
        badge: "Synced",
        title: "Queue clear after sync",
        description: `${formatQrHandoffMetric(synced, true)} entr${synced === 1 ? "y" : "ies"} left this device after a real sync acknowledgement. The outbox is clear because they synced — not because nothing was scouted.`,
      };
    default:
      return {
        tone: "clear",
        badge: "Queue clear",
        title: "Nothing pending to hand off",
        description:
          "This device’s outbox is empty. Save match or pit scout entries offline first, then share a QR.",
      };
  }
}

/** Classify QR handoff Soft-UI shell — never invents DEMO outbox rows. */
export function classifyQrHandoffShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  schemaId?: string | null;
  pendingCount?: number;
  lastSyncedCount?: number;
}): QrHandoffShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || !input.schemaId) return "setup";
  const queue = classifyQrHandoffQueue({
    loaded: true,
    pendingCount: input.pendingCount ?? 0,
    lastSyncedCount: input.lastSyncedCount ?? 0,
  });
  if (queue === "clear") return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO outbox rows. */
export function qrHandoffShellCopy(kind: QrHandoffShellKind): QrHandoffEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading QR handoff…",
        description: "Checking workspace membership and this device’s outbox.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load QR handoff",
        description:
          "A network or device issue blocked the outbox. Retry, or open Scouting / Offline while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Publish a scouting form first",
        description:
          "QR handoff merges into a published match or pit schema. Select a workspace and publish a form before scanning.",
      };
    case "empty":
      return {
        kind,
        badge: "Queue clear",
        title: "Waiting on offline scout entries",
        description:
          "The outbox stays blank until you save match or pit rows on this device. Cross-check Scouting and Offline.",
      };
    default:
      return {
        kind: "ready",
        title: "QR scout handoff",
        description:
          "Transfer pending IndexedDB outbox rows between devices, then sync when venue Wi-Fi returns.",
      };
  }
}

/**
 * Soft-UI next actions for QR handoff empty/setup shells.
 * Points at Scouting / Offline — never invents DEMO outbox rows.
 */
export function qrHandoffNextActions(input: {
  orgId?: string | null;
  shell: QrHandoffShellKind;
  pendingCount?: number;
  lastSyncedCount?: number;
}): QrHandoffNextAction[] {
  const orgId = input.orgId ?? null;
  const pending = input.pendingCount ?? 0;
  const synced = input.lastSyncedCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Pick a team before sharing outbox rows.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Forms and the outbox stay blank until your team configures them.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "offline",
          label: "Open Offline",
          detail: "Cold-boot readiness stays honest until this device caches Scouting.",
          href: withOrgHref("/offline", null),
        },
      ];
    }
    return [
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Publish a match or pit form so QR merges have a schema.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "offline",
        label: "Open Offline",
        detail: "Confirm this tablet can open Scouting when venue Wi-Fi drops.",
        href: withOrgHref("/offline", orgId),
      },
      {
        id: "offline-shell",
        label: "Open this phone",
        detail: "Record that this device saved Scouting.",
        href: withOrgHref("/offline-shell", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry QR handoff",
        detail: "Reload this device’s outbox.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Match and pit forms stay available while the outbox reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "offline",
        label: "Open Offline",
        detail: "Cold-boot status stays available while the outbox reloads.",
        href: withOrgHref("/offline", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "scouting",
        label: "Save a scout entry offline",
        detail: "Queue clear means nothing is pending yet — save a match or pit row first.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "offline",
        label: "Open Offline",
        detail: "Warm this device’s cache before you need a no-signal handoff.",
        href: withOrgHref("/offline", orgId),
      },
      {
        id: "offline-shell",
        label: "Open this phone",
        detail: "Record this device after Scouting loads once online.",
        href: withOrgHref("/offline-shell", orgId),
      },
    ];
  }

  const queue = classifyQrHandoffQueue({
    loaded: true,
    pendingCount: pending,
    lastSyncedCount: synced,
  });

  if (queue === "synced") {
    return [
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Queue clear after sync — keep scouting; new rows land in the outbox again.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "offline",
        label: "Open Offline",
        detail: "Confirm cold-boot readiness after a successful uplink.",
        href: withOrgHref("/offline", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Synced rows feed lineup coverage.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  return [
    {
      id: "share",
      label:
        pending > 0
          ? `Share ${pending} pending entr${pending === 1 ? "y" : "ies"}`
          : "Show handoff QR",
      detail: "Generate an embedded QR or short code from real outbox rows.",
      href: "#scout-qr-share",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Keep logging match or pit rows while peers scan.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "offline",
      label: "Open Offline",
      detail: "Handoff works when venue Wi-Fi is unstable — confirm this device’s shell.",
      href: withOrgHref("/offline", orgId),
    },
  ];
}
