/**
 * presenceDashboardNumber — comingTonight as a widget payload.
 *
 * Presence already computes the one "who is coming tonight" number. Home cannot
 * show it: there is no presence catalog type, and dashboard-client / snapshot
 * are out of this file's ownership. Widgets import this later and stamp the
 * payload onto a card.
 *
 * Honesty every export encodes:
 *   - Identity is `userId` only. The number is the size of that set.
 *   - An empty user id is skipped. Free-text names are not people we invented.
 *   - The roster is not an input. Silence never becomes a body in the shop.
 *   - Status is `empty` when the union is 0, never a fabricated headcount.
 *
 * Pure. No clock reads. No I/O.
 */

import type { ReconcileInput } from "./reconcile";
import {
  comingTonightLabel,
  unifyPresence,
  type PresenceUnification,
  type PresenceUnificationParts,
  type UnifiedPresenceMember,
} from "./unify";

/** Catalog key widgets will register later. Not a live DashboardWidgetType yet. */
export const PRESENCE_DASHBOARD_WIDGET_TYPE = "presence" as const;

export type PresenceDashboardNumberStatus = "live" | "empty" | "setup_required";

export type PresenceDashboardNumberData = {
  /** THE number: distinct confirmed members with a coming / here signal. */
  comingTonight: number;
  /** Distinct confirmed identities that left any signal (including no / maybe / absent). */
  identityCount: number;
  /** Per-source counts AFTER identity collapse. Their sum may exceed `comingTonight`. */
  parts: PresenceUnificationParts;
  label: string;
  href: "/presence" | "/workspace";
  ctaLabel: string;
  /** Confirmed userIds that count as coming. Never padded from a roster. */
  userIds: string[];
};

export type PresenceDashboardNumberPayload = {
  type: typeof PRESENCE_DASHBOARD_WIDGET_TYPE;
  status: PresenceDashboardNumberStatus;
  message: string;
  data: PresenceDashboardNumberData;
};

export type PresenceDashboardNumberInput =
  | ReconcileInput
  | PresenceUnification
  | { unification: PresenceUnification }
  | { status: "setup_required"; message?: string };

function isSetupRequired(
  input: PresenceDashboardNumberInput,
): input is { status: "setup_required"; message?: string } {
  return "status" in input && input.status === "setup_required" && !("unification" in input) && !("members" in input);
}

function isUnification(input: object): input is PresenceUnification {
  return (
    "comingTonight" in input &&
    "identityCount" in input &&
    "parts" in input &&
    "members" in input &&
    Array.isArray((input as PresenceUnification).members)
  );
}

function isReconcileInput(input: object): input is ReconcileInput {
  return "rsvps" in input && "rollCall" in input && "hourLogs" in input && "occurrenceDate" in input;
}

function comingUserIds(members: UnifiedPresenceMember[]): string[] {
  const ids = new Set<string>();
  for (const member of members) {
    if (!member.coming) continue;
    if (!member.userId) continue;
    ids.add(member.userId);
  }
  return [...ids];
}

function identityUserIds(members: UnifiedPresenceMember[]): string[] {
  const ids = new Set<string>();
  for (const member of members) {
    if (!member.userId) continue;
    ids.add(member.userId);
  }
  return [...ids];
}

function resolveUnification(input: PresenceDashboardNumberInput): PresenceUnification {
  if ("unification" in input && input.unification) return input.unification;
  if (isUnification(input)) return input;
  if (isReconcileInput(input)) return unifyPresence(input);
  return unifyPresence({
    rsvps: [],
    rollCall: [],
    hourLogs: [],
    occurrenceDate: "",
  });
}

function payloadOf(
  status: PresenceDashboardNumberStatus,
  unification: PresenceUnification,
  setupMessage?: string,
): PresenceDashboardNumberPayload {
  const userIds = comingUserIds(unification.members);
  const identities = identityUserIds(unification.members);
  const comingTonight = userIds.length;
  const parts = unification.parts;
  const label = comingTonightLabel({ comingTonight, parts });
  const resolved: PresenceDashboardNumberStatus =
    status === "setup_required" ? "setup_required" : comingTonight > 0 ? "live" : "empty";
  const href = resolved === "setup_required" ? "/workspace" : "/presence";
  const message =
    resolved === "setup_required"
      ? (setupMessage ?? "Choose your team to see who is coming tonight.")
      : label;

  return {
    type: PRESENCE_DASHBOARD_WIDGET_TYPE,
    status: resolved,
    message,
    data: {
      comingTonight,
      identityCount: identities.length,
      parts,
      label,
      href,
      ctaLabel: resolved === "setup_required" ? "Choose your team" : "Open Presence",
      userIds,
    },
  };
}

/**
 * Package the coming-tonight union as a widget payload.
 *
 * The number is always distinct coming `userId`s — never a sum of RSVP +
 * roll call + hours, and never a roster length.
 */
export function presenceDashboardNumber(input: PresenceDashboardNumberInput): PresenceDashboardNumberPayload {
  if (isSetupRequired(input)) {
    return payloadOf(
      "setup_required",
      unifyPresence({
        rsvps: [],
        rollCall: [],
        hourLogs: [],
        occurrenceDate: "",
      }),
      input.message,
    );
  }
  return payloadOf("live", resolveUnification(input));
}

/** THE number a widget should display. Distinct coming userIds. Never a store sum. */
export function presenceDashboardComingTonight(input: PresenceDashboardNumberInput): number {
  return presenceDashboardNumber(input).data.comingTonight;
}
