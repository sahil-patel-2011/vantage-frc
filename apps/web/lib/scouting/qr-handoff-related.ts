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
      label: "Choose your team",
      detail: "Choose your team to open QR handoff.",
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
        description: "Counting the entries saved on this phone.",
      };
    case "queued":
      return {
        tone,
        badge: `${formatQrHandoffMetric(pending, true)} pending`,
        title: "Matches saved on this phone, not sent yet",
        description: `No signal? Show this code to a teammate whose phone has signal. Their phone sends your ${formatQrHandoffMetric(pending, true)} ${pending === 1 ? "entry" : "entries"} for you.`,
      };
    case "synced":
      return {
        tone,
        badge: "Synced",
        title: "Everything is sent",
        description: `${formatQrHandoffMetric(synced, true)} ${synced === 1 ? "entry" : "entries"} reached the team. Nothing is left on this phone to hand off.`,
      };
    default:
      return {
        tone: "clear",
        badge: "All sent",
        title: "Nothing to hand off",
        description:
          "Every match you scouted on this phone has reached the team. Matches you save without signal show up here to hand off.",
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
        description: "Checking which team you are on and what is saved on this phone.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load QR handoff",
        description:
          "This phone could not read what it has saved. Try again; your entries are still on the phone.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Publish a scouting form first",
        description:
          "Handing off needs your team's published scouting form. Ask your scouting lead to publish it.",
      };
    case "empty":
      return {
        kind,
        badge: "All sent",
        title: "Nothing to hand off",
        description:
          "Every match you scouted on this phone has reached the team. Matches you save without signal show up here to hand off.",
      };
    default:
      return {
        kind: "ready",
        title: "Hand off scouting by QR",
        description:
          "No signal? Show this code to a teammate whose phone has signal, and their phone sends your matches.",
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
          label: "Choose your team",
          detail: "Choose your team before handing off matches.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Handing off works once your team publishes a scouting form.",
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
        detail: "Read what is saved on this phone again.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Match and pit forms keep working meanwhile.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "offline",
        label: "Open Offline",
        detail: "Offline scouting keeps working meanwhile.",
        href: withOrgHref("/offline", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "scouting",
        label: "Save a scout entry offline",
        detail: "Nothing to hand off yet: every match on this phone has been sent. Keep scouting.",
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
        detail: "Everything is sent. Keep scouting; new matches save here until they send.",
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
      detail: "Make a QR code or short code from the matches saved on this phone.",
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
