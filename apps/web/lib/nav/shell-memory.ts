/**
 * What the app shell last showed on this device for the signed-in person, so the next page shows
 * it at once instead of a placeholder while /api/me loads.
 */

export const ROLE_CUES_KEY = "vantage.team-role-cues";
export const ACCOUNT_INITIAL_KEY = "vantage.account-initial";

/**
 * The role line under the team ("Owner") and the avatar letter, as this device last showed them.
 * While /api/me loads, the sidebar read "Your team" and the avatar a generic person, then both
 * changed a moment later on every page (UX audit). Cleared on sign-out.
 */
export function readRememberedRoleCue(storage: Pick<Storage, "getItem"> | null, orgId: string): string | null {
  if (!storage || !orgId) return null;
  try {
    const map = JSON.parse(storage.getItem(ROLE_CUES_KEY) ?? "{}") as Record<string, unknown>;
    const cue = map[orgId];
    return typeof cue === "string" && cue.trim() ? cue : null;
  } catch {
    return null;
  }
}

export function rememberRoleCue(storage: Pick<Storage, "getItem" | "setItem"> | null, orgId: string, cue: string): void {
  if (!storage || !orgId || !cue.trim()) return;
  try {
    const map = JSON.parse(storage.getItem(ROLE_CUES_KEY) ?? "{}") as Record<string, string>;
    if (map[orgId] === cue) return;
    delete map[orgId];
    map[orgId] = cue;
    storage.setItem(ROLE_CUES_KEY, JSON.stringify(Object.fromEntries(Object.entries(map).slice(-8))));
  } catch {
    // Storage full or blocked: the placeholder shows instead.
  }
}

export function readRememberedInitial(storage: Pick<Storage, "getItem"> | null): string | null {
  try {
    const value = storage?.getItem(ACCOUNT_INITIAL_KEY) ?? null;
    return value && /^[A-Z0-9]$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberInitial(storage: Pick<Storage, "setItem"> | null, initial: string): void {
  if (!storage || !/^[A-Z0-9]$/.test(initial)) return;
  try {
    storage.setItem(ACCOUNT_INITIAL_KEY, initial);
  } catch {
    // Blocked storage: the generic avatar shows while loading.
  }
}

/** On sign-out: the next person on this device must not see this one's letter or role. */
export function forgetAccountMemory(storage: Pick<Storage, "removeItem"> | null): void {
  try {
    storage?.removeItem(ACCOUNT_INITIAL_KEY);
    storage?.removeItem(ROLE_CUES_KEY);
  } catch {
    // Nothing to clear.
  }
}
