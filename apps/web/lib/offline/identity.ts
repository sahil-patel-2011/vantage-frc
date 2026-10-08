import { fetchProductSession, invalidateProductSession, productSessionUnreachable } from "../nav/product-session";

const TAB_USER = "vantage-offline-user";
const SHARED_USER = "vantage-session-user";
const TEAM_REVOKED = "vantage-team-revoked:";
const TAB_TEAM = "vantage-offline-team:";
const revokedTeams = new Set<string>();
let teamAccessRevision = 0;
let signedOut = false;
let listening = false;

export function watchSessionBoundary(): void {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  window.addEventListener("storage", event => {
    if (event.key?.startsWith(TEAM_REVOKED)) {
      teamAccessRevision += 1;
      invalidateProductSession();
      try {
        const user = window.sessionStorage.getItem(TAB_USER);
        const prefix = `${TEAM_REVOKED}${user}:`;
        if (!event.newValue || !user || !event.key.startsWith(prefix)) return;
        const team = event.key.slice(prefix.length);
        const verifiedHere = window.sessionStorage.getItem(TAB_TEAM + team) === user;
        revokedTeams.add(`${user}:${team}`);
        window.sessionStorage.removeItem(TAB_TEAM + team);
        const org = new URLSearchParams(window.location.search).get("orgId");
        // Older links can omit orgId while rendering this tab's selected team.
        if (org === team || (!org && verifiedHere)) window.location.replace("/account/teams");
      } catch { /* Session reads remain invalidated when browser storage is restricted. */ }
      return;
    }
    if (event.key !== SHARED_USER) return;
    const previous = window.sessionStorage.getItem(TAB_USER);
    if (previous && previous !== event.newValue) {
      signedOut = true;
      window.sessionStorage.removeItem(TAB_USER);
      invalidateProductSession();
      window.location.replace("/signin");
    }
  });
}

export async function offlineSnapshotUser(orgId: string): Promise<string | null> {
  if (typeof window === "undefined" || signedOut) return null;
  watchSessionBoundary();
  // Personal caches use "_" as a storage key, not as a team identifier.
  const teamId = orgId.trim() === "_" ? "" : orgId.trim();
  const accessRevision = teamAccessRevision;
  const session = await fetchProductSession(teamId || null);
  if (signedOut) return null;
  if (teamId && accessRevision !== teamAccessRevision) return null;
  if (session?.userId) {
    try {
      window.sessionStorage.setItem(TAB_USER, session.userId);
      if (window.localStorage.getItem(SHARED_USER) !== session.userId) window.localStorage.setItem(SHARED_USER, session.userId);
    } catch { /* Live identity still scopes storage when browser storage is restricted. */ }
    if (teamId) {
      const accessKey = `${session.userId}:${teamId}`;
      const member = session.orgId === teamId || session.memberships?.some(entry => entry.orgId === teamId);
      if (!member) {
        forgetOfflineTeam(teamId, session.userId);
        return null;
      }
      // Only a fresh positive membership answer can restore access after leaving.
      revokedTeams.delete(accessKey);
      try {
        window.localStorage.removeItem(TEAM_REVOKED + accessKey);
        window.sessionStorage.setItem(TAB_TEAM + teamId, session.userId);
      } catch { /* Live membership remains authoritative. */ }
    }
    return session.userId;
  }
  // Only an unreachable server permits this tab's previously verified offline identity.
  // A definite authentication/permission rejection cannot reuse it.
  try {
    if (productSessionUnreachable()) {
      const previous = window.sessionStorage.getItem(TAB_USER);
      if (!previous || window.localStorage.getItem(SHARED_USER) !== previous) return null;
      if (teamId && (window.sessionStorage.getItem(TAB_TEAM + teamId) !== previous
        || revokedTeams.has(`${previous}:${teamId}`)
        || window.localStorage.getItem(`${TEAM_REVOKED}${previous}:${teamId}`))) return null;
      return previous;
    }
    window.sessionStorage.removeItem(TAB_USER);
  } catch { /* No storage means no offline identity. */ }
  return null;
}

/** Revoke this team's downloaded views; preserve unsent personal reports. */
export function forgetOfflineTeam(orgId: string, userId: string): void {
  teamAccessRevision += 1;
  revokedTeams.add(`${userId}:${orgId}`);
  invalidateProductSession();
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TAB_TEAM + orgId);
    window.localStorage.setItem(`${TEAM_REVOKED}${userId}:${orgId}`, "1");
  } catch { /* The current tab still denies this team in memory. */ }
}

export function forgetOfflineIdentity(): void {
  signedOut = true;
  invalidateProductSession();
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TAB_USER);
    window.localStorage.removeItem(SHARED_USER);
  } catch { /* Signed-out reads are blocked even if storage is unavailable. */ }
}
