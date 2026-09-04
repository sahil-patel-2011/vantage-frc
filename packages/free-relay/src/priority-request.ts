/** Same number as PRIORITY_FREEBUFF_TEAM_NUMBER in @vantage/agent. */
export const PRIORITY_RELAY_TEAM_NUMBER = 6925;

export function isPriorityRelayRequest(input: {
  priorityHeader?: string | null;
  teamNumberHeader?: string | null;
}): boolean {
  if (String(input.priorityHeader ?? "").trim() === "1") return true;
  return Number(input.teamNumberHeader) === PRIORITY_RELAY_TEAM_NUMBER;
}
