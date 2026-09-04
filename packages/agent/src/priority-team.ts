/**
 * Team 6925 is default-fast on the shared Freebuff pool: reserved short-chat
 * slots and skip-the-queue on each Pi. There is no product toggle — other
 * teams keep their in-flight jobs; 6925 interleaves without cancelling them.
 */
export const PRIORITY_FREEBUFF_TEAM_NUMBER = 6925;

export function isPriorityFreebuffTeam(teamNumber: number | null | undefined): boolean {
  return Number(teamNumber) === PRIORITY_FREEBUFF_TEAM_NUMBER;
}
