/**
 * "Are the two copies the same?" — the pure summary the Connectors card shows.
 *
 * Identical when every connected copy carries the same content hash. Otherwise each copy is
 * described on its own terms: catching up (resting after a throttle, or behind the other),
 * needs attention (sign-in gone), or never synced.
 */

import type { MirrorCopy } from "./mirror-hash";
import { mirrorCopyLabel } from "./mirror-hash";

export type CopyHealth = "in_sync" | "behind" | "resting" | "attention" | "never_synced" | "not_connected";

export type MirrorSummary = {
  /** Both copies connected and carrying the same hash. */
  identical: boolean;
  /** How many copies are connected (0, 1 or 2). */
  connected: number;
  headline: string;
  copies: Array<{ copy: MirrorCopy; health: CopyHealth; detail: string }>;
};

type State = {
  copy: MirrorCopy;
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncHash: string | null;
  throttledUntil: string | null;
  lastError: string | null;
};

export function summarizeMirror(states: State[], now: Date): MirrorSummary {
  const connected = states.filter((state) => state.connected);
  const newest = connected
    .filter((state) => state.lastSyncHash && state.lastSyncAt)
    .sort((a, b) => Date.parse(b.lastSyncAt!) - Date.parse(a.lastSyncAt!))[0];
  const hashes = new Set(connected.map((state) => state.lastSyncHash ?? ""));
  // One offered copy (Excel not available here): it is "identical" once it holds a sync.
  const identical =
    states.length === 1
      ? connected.length === 1 && Boolean(connected[0]!.lastSyncHash)
      : connected.length === 2 && hashes.size === 1 && !hashes.has("");

  const copies = states.map((state) => {
    const label = mirrorCopyLabel(state.copy);
    if (!state.connected) return { copy: state.copy, health: "not_connected" as const, detail: `${label} is not connected.` };
    const until = state.throttledUntil ? Date.parse(state.throttledUntil) : Number.NaN;
    if (Number.isFinite(until) && until > now.getTime()) {
      return {
        copy: state.copy,
        health: "resting" as const,
        detail: `${label} asked Vantage to slow down; the other copy is carrying the load and ${label} catches up on the next sync.`,
      };
    }
    if (state.lastError && /sign-in expired|reconnect|decrypt|secret|disconnect|sign-in page|no longer exists|older version/i.test(state.lastError)) {
      return { copy: state.copy, health: "attention" as const, detail: state.lastError };
    }
    if (!state.lastSyncHash) {
      return { copy: state.copy, health: "never_synced" as const, detail: `${label} has not been fully synced yet.` };
    }
    if (newest && state.lastSyncHash !== newest.lastSyncHash) {
      return {
        copy: state.copy,
        health: "behind" as const,
        detail: `${label} holds an older copy than ${mirrorCopyLabel(newest.copy)}; the next sync brings it level.`,
      };
    }
    return { copy: state.copy, health: "in_sync" as const, detail: `${label} holds the latest copy.` };
  });

  const single = states.length === 1 ? states[0]! : null;
  const headline = single
    ? !single.connected
      ? `Connect ${mirrorCopyLabel(single.copy)} to keep a live copy of this team's data.`
      : single.lastSyncAt
        ? `${mirrorCopyLabel(single.copy)} is connected.`
        : "Connected. Press Sync now to fill it."
    : connected.length === 0
      ? "Connect Google Sheets and Microsoft Excel to keep two live copies of this team's data."
      : connected.length === 1
        ? `Only ${mirrorCopyLabel(connected[0]!.copy)} is connected. Connect the other for a second, independent copy.`
        : identical
          ? "Both copies are identical."
          : "The copies differ right now — the next sync brings them level.";

  return { identical, connected: connected.length, headline, copies };
}
