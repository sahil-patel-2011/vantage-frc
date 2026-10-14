/** Refresh mounted views only after a team write has been acknowledged. */
export const TEAM_DATA_CHANGED = "vantage:team-data-changed";
export type TeamDataChange = { orgId: string; kind: "event" | "scouting" | "forms" };

export function notifyTeamDataChanged(change: TeamDataChange): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEAM_DATA_CHANGED, { detail: change }));
  // Only an invalidation signal crosses tabs; reports, keys and answers never do.
  try { window.localStorage.setItem(TEAM_DATA_CHANGED, JSON.stringify({ ...change, revision: crypto.randomUUID() })); }
  catch { /* Private browsing can block storage; this tab still refreshes. */ }
}

export function onTeamDataChanged(orgId: string, refresh: () => void): () => void {
  const listener = (event: Event) => {
    if ((event as CustomEvent<TeamDataChange>).detail?.orgId === orgId) refresh();
  };
  window.addEventListener(TEAM_DATA_CHANGED, listener);
  const fromTab = (event: StorageEvent) => {
    if (event.key !== TEAM_DATA_CHANGED || !event.newValue) return;
    try {
      const change = JSON.parse(event.newValue) as TeamDataChange;
      if (change.orgId === orgId && ["event", "scouting", "forms"].includes(change.kind)) refresh();
    } catch { /* Ignore malformed or older signals. */ }
  };
  window.addEventListener("storage", fromTab);
  return () => { window.removeEventListener(TEAM_DATA_CHANGED, listener); window.removeEventListener("storage", fromTab); };
}
