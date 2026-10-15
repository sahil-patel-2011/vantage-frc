/**
 * Owners and admins manage the team's shared AI connection (Team → AI keys). Kept free of server
 * imports so client components can ask too (chat-send-gate.ts pulls in billing and the pool).
 */
export function canConnectForTeam(role: string | null | undefined): boolean {
  const normalized = (role ?? "").toLowerCase();
  return normalized === "owner" || normalized === "admin";
}
