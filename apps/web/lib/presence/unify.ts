/**
 * unifyPresence — the ONE number for "who is coming tonight".
 *
 * RSVP, roll call, and clocked hours used to each answer the same question.
 * This module unions them by confirmed member identity (`userId`) so Ada who
 * said going, Ada on the roll call, and Ada on the kiosk are one person.
 *
 * Honesty that every export encodes:
 *   - Identity is `userId` only. A free-text roll-call name with no confirmed
 *     link is not a person we invented; it stays out of the count.
 *   - An empty user id is skipped. We never mint a placeholder identity.
 *   - The roster is not an input. Silence never becomes a body in the shop.
 *   - "maybe" and "no" are not "coming". Showing up (roll call or hours) is.
 *   - Saying "going" and then being marked absent is not coming.
 *
 * Pure. No clock reads. No I/O.
 */

import { reconcilePresence, type ReconcileInput } from "./reconcile";
import type { PresenceMemberRow } from "./types";

export const PRESENCE_IDENTITY_SOURCES = ["rsvp", "roll_call", "hours"] as const;
export type PresenceIdentitySource = (typeof PRESENCE_IDENTITY_SOURCES)[number];

export type UnifiedPresenceMember = {
  userId: string;
  name: string | null;
  sources: PresenceIdentitySource[];
  coming: boolean;
  rsvpGoing: boolean;
  present: boolean;
  clocked: boolean;
};

export type PresenceUnificationParts = {
  rsvpGoing: number;
  present: number;
  clocked: number;
};

export type PresenceUnification = {
  /** THE number: distinct members with a positive coming / here signal. */
  comingTonight: number;
  /** Distinct confirmed identities that left any signal (including no / maybe / absent). */
  identityCount: number;
  /** Per-source counts AFTER identity collapse. Their sum may exceed `comingTonight`. */
  parts: PresenceUnificationParts;
  members: UnifiedPresenceMember[];
};

/** Positive evidence this confirmed member is coming or already here. */
export function isComingTonight(row: Pick<PresenceMemberRow, "userId" | "rsvp" | "attended" | "minutes">): boolean {
  if (!row.userId) return false;
  if (row.attended === true) return true;
  if (row.minutes != null && row.minutes > 0) return true;
  return row.rsvp === "going" && row.attended !== false;
}

function sourcesOf(row: PresenceMemberRow): PresenceIdentitySource[] {
  const sources: PresenceIdentitySource[] = [];
  if (row.rsvp != null) sources.push("rsvp");
  if (row.attended != null) sources.push("roll_call");
  if (row.minutes != null) sources.push("hours");
  return sources;
}

function mergeMember(existing: UnifiedPresenceMember, incoming: UnifiedPresenceMember): void {
  const merged = new Set<PresenceIdentitySource>([...existing.sources, ...incoming.sources]);
  existing.sources = PRESENCE_IDENTITY_SOURCES.filter((source) => merged.has(source));
  existing.coming = existing.coming || incoming.coming;
  existing.rsvpGoing = existing.rsvpGoing || incoming.rsvpGoing;
  existing.present = existing.present || incoming.present;
  existing.clocked = existing.clocked || incoming.clocked;
  if (!existing.name && incoming.name) existing.name = incoming.name;
}

/**
 * Fold RSVP + roll call + hours into one identity set and the coming-tonight count.
 * A member who appears in every store still contributes 1.
 */
export function unifyPresence(input: ReconcileInput): PresenceUnification {
  const rows = reconcilePresence(input);
  const byId = new Map<string, UnifiedPresenceMember>();

  for (const row of rows) {
    if (!row.userId) continue;
    const incoming: UnifiedPresenceMember = {
      userId: row.userId,
      name: row.name,
      sources: sourcesOf(row),
      coming: isComingTonight(row),
      rsvpGoing: row.rsvp === "going",
      present: row.attended === true,
      clocked: row.minutes != null && row.minutes > 0,
    };
    const existing = byId.get(row.userId);
    if (!existing) {
      byId.set(row.userId, incoming);
      continue;
    }
    mergeMember(existing, incoming);
  }

  const members = [...byId.values()].sort((a, b) =>
    (a.name ?? a.userId).localeCompare(b.name ?? b.userId),
  );

  const parts: PresenceUnificationParts = { rsvpGoing: 0, present: 0, clocked: 0 };
  for (const member of members) {
    if (member.rsvpGoing) parts.rsvpGoing += 1;
    if (member.present) parts.present += 1;
    if (member.clocked) parts.clocked += 1;
  }

  return {
    comingTonight: members.filter((member) => member.coming).length,
    identityCount: members.length,
    parts,
    members,
  };
}

/** Distinct coming-tonight identities from already-reconciled rows. Never pads the roster. */
export function comingTonightCount(rows: PresenceMemberRow[]): number {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isComingTonight(row)) ids.add(row.userId);
  }
  return ids.size;
}

/** Human sentence under the one number — names the sources, never inflates the count. */
export function comingTonightLabel(unification: Pick<PresenceUnification, "comingTonight" | "parts">): string {
  if (unification.comingTonight === 0) {
    return "Nobody has said they are going, been marked present, or clocked time for this meeting.";
  }
  const bits: string[] = [];
  if (unification.parts.rsvpGoing > 0) bits.push(`${unification.parts.rsvpGoing} said going`);
  if (unification.parts.present > 0) bits.push(`${unification.parts.present} on the roll call`);
  if (unification.parts.clocked > 0) bits.push(`${unification.parts.clocked} clocked hours`);
  if (bits.length === 0) return "Distinct members with a coming or here signal.";
  return `${bits.join(" · ")} — counted once per person.`;
}
