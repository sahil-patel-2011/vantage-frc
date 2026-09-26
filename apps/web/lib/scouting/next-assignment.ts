// After a save, where does the scout go next?
//
// The form used to step only the match number: finish Q12 on 1678 and it
// offered Q13 on 1678 — a robot that is not in Q13, when this scout's next job
// is 254 in Q15. If they have an assignment in a later match, that match and
// that robot are the next thing to pre-select. With no later assignment the
// caller keeps the old behaviour (step the match number, keep the team).

import { isBackupRole } from "./assignment-accountability";

export type SteppableAssignment = {
  matchKey: string;
  teamKey: string;
  /** Present on the bootstrap payload even where the client type omits it. */
  role?: string | null;
};

const LEVEL_RANK: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

/**
 * Schedule position from a TBA-shaped match key: `_qm12` → [0, 12, 0],
 * `_sf2m1` → [3, 2, 1]. Null for anything else, rather than guessing an order.
 */
export function matchOrderKey(matchKey: string): [number, number, number] | null {
  const parsed = /_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(matchKey.trim());
  if (!parsed) return null;
  const [, level = "", first = "", second] = parsed;
  const rank = LEVEL_RANK[level.toLowerCase()];
  if (rank == null) return null;
  return [rank, Number(first), second ? Number(second) : 0];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Same event prefix, so a stale assignment from another event never wins. */
function eventPrefix(matchKey: string): string {
  const index = matchKey.lastIndexOf("_");
  return index > 0 ? matchKey.slice(0, index) : "";
}

/**
 * The earliest primary assignment strictly after the match just saved.
 *
 * Backups are skipped: a backup scouts only when the primary does not, so
 * jumping a scout onto a backup duty would pull them off their own next robot.
 */
export function nextAssignedTarget(
  assignments: readonly SteppableAssignment[],
  savedMatchKey: string,
  /** Robots this scout already has a report for: skipped, so "Next" is never a finished one. */
  done: (matchKey: string, teamKey: string) => boolean = () => false,
): { matchKey: string; teamKey: string } | null {
  const saved = matchOrderKey(savedMatchKey);
  if (!saved) return null;
  const prefix = eventPrefix(savedMatchKey);
  let best: { matchKey: string; teamKey: string; order: [number, number, number] } | null = null;
  for (const assignment of assignments) {
    if (!assignment.matchKey || !assignment.teamKey) continue;
    if (isBackupRole(assignment.role)) continue;
    if (done(assignment.matchKey, assignment.teamKey)) continue;
    if (eventPrefix(assignment.matchKey) !== prefix) continue;
    const order = matchOrderKey(assignment.matchKey);
    if (!order || compare(order, saved) <= 0) continue;
    if (!best || compare(order, best.order) < 0) {
      best = { matchKey: assignment.matchKey, teamKey: assignment.teamKey, order };
    }
  }
  return best ? { matchKey: best.matchKey, teamKey: best.teamKey } : null;
}
