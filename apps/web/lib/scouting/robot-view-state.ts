export type RobotViewState = {
  sort: "fit" | "pick" | "average" | "number";
  selected: string | null;
  query: string;
  compare: string[];
  splitView: boolean;
};

export function robotViewStorageKey(userId: string, orgId: string, eventKey: string | null): string {
  return `vantage-scout-robots:${encodeURIComponent(userId)}:${orgId}:${eventKey ?? "_"}`;
}

export function readRobotViewState(key: string): RobotViewState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const state = JSON.parse(raw) as RobotViewState;
    if (!["fit", "pick", "average", "number"].includes(state.sort) || typeof state.query !== "string" || state.query.length > 100 || typeof state.splitView !== "boolean") return null;
    if (state.selected !== null && (typeof state.selected !== "string" || !/^frc\d+$/.test(state.selected))) return null;
    if (!Array.isArray(state.compare) || state.compare.length > 3 || state.compare.some(key => typeof key !== "string" || !/^frc\d+$/.test(key)) || new Set(state.compare).size !== state.compare.length) return null;
    return state;
  } catch { return null; }
}

export function writeRobotViewState(key: string, state: RobotViewState): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(state)); } catch { /* The current view remains usable. */ }
}
