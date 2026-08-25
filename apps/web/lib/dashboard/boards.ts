import {
  DASHBOARD_COLUMNS,
  catalogEntry,
  findDashboardSlot,
  scaleLayoutToCols,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
} from "./catalog";

export type HomeBoardPick = {
  id: string;
  name: string;
  scope: "personal" | "org";
  isActive: boolean;
  ownerUserId: string | null;
};

export type GridDragItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DropWidgetResult =
  | { ok: true; layout: DashboardWidgetLayout[] }
  | { ok: false; error: string };

/** Per-member Home key so two people on the same team (or browser) never share a board id. */
export function boardStorageKey(orgId: string, userId: string) {
  return `vantage.dashboard.board.${orgId}.${userId}`;
}

export function readStoredBoardId(orgId: string, userId: string): string | null {
  if (typeof window === "undefined" || !orgId || !userId) return null;
  try {
    return window.localStorage.getItem(boardStorageKey(orgId, userId));
  } catch {
    return null;
  }
}

export function writeStoredBoardId(orgId: string, userId: string, boardId: string | null) {
  if (typeof window === "undefined" || !orgId || !userId) return;
  try {
    const key = boardStorageKey(orgId, userId);
    if (!boardId) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, boardId);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * Home is this member's personal board. Org/team boards are opt-in only when
 * `preferredId` is a board this user can actually see.
 */
export function pickHomeBoard<T extends HomeBoardPick>(
  boards: T[],
  input: { userId: string; preferredId?: string | null },
): T | null {
  const mine = boards.filter((board) => board.scope === "personal" && board.ownerUserId === input.userId);

  if (input.preferredId) {
    const preferred = boards.find((board) => board.id === input.preferredId);
    if (preferred) {
      if (preferred.scope === "personal" && preferred.ownerUserId !== input.userId) {
        return mine.find((board) => board.isActive) ?? mine[0] ?? null;
      }
      return preferred;
    }
  }

  return mine.find((board) => board.isActive) ?? mine[0] ?? null;
}

export const BOARD_NAME_MAX = 80;

/**
 * "Match strategy" → "Match strategy copy" → "Match strategy copy 2" …
 *
 * Duplicating twice used to leave two identically named boards in the switcher,
 * which is exactly the moment a member edits the wrong one.
 */
export function duplicateBoardName(sourceName: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  const base = sourceName.trim().slice(0, BOARD_NAME_MAX - 8) || "Board";
  const candidate = `${base} copy`;
  if (!taken.has(candidate.toLowerCase())) return candidate.slice(0, BOARD_NAME_MAX);
  for (let n = 2; n < 100; n += 1) {
    const next = `${base} copy ${n}`;
    if (!taken.has(next.toLowerCase())) return next.slice(0, BOARD_NAME_MAX);
  }
  return candidate.slice(0, BOARD_NAME_MAX);
}

/**
 * Maps a drag/resize expressed in the *displayed* grid (phone 1-col, tablet
 * 8-col, laptop/TV 12-col) back onto the saved 12-column board. The pointer and
 * keyboard editors in lib/dashboard/grid-drag both settle in display space and
 * then come through here.
 */
export function applyGridDrag(
  current: DashboardWidgetLayout[],
  nextLayout: readonly GridDragItem[],
  displayCols: number,
): DashboardWidgetLayout[] {
  return scaleLayoutToCols(
    current.map((item) => {
      const match = nextLayout.find((row) => row.i === item.i);
      if (!match) return item;
      return { ...item, x: match.x, y: match.y, w: match.w, h: match.h };
    }),
    displayCols,
    DASHBOARD_COLUMNS,
  );
}

/** Places a palette widget onto the board without overlapping when no drop cell is given. */
export function dropWidgetOntoLayout(
  layout: DashboardWidgetLayout[],
  type: DashboardWidgetType,
  options?: {
    drop?: { x: number; y: number };
    displayCols?: number;
    now?: number;
  },
): DropWidgetResult {
  if (layout.some((item) => item.type === type)) {
    return { ok: false, error: "That widget is already on the board." };
  }
  const entry = catalogEntry(type);
  if (!entry) return { ok: false, error: "Unknown widget" };

  const displayCols = options?.displayCols ?? DASHBOARD_COLUMNS;
  const dropCanonical = options?.drop
    ? scaleLayoutToCols(
        [
          {
            i: "drop",
            type,
            x: options.drop.x,
            y: options.drop.y,
            w: entry.defaultW,
            h: entry.defaultH,
          },
        ],
        displayCols,
        DASHBOARD_COLUMNS,
      )[0]
    : null;
  const position = dropCanonical
    ? { x: dropCanonical.x, y: dropCanonical.y }
    : findDashboardSlot(layout, entry.defaultW, entry.defaultH);

  return {
    ok: true,
    layout: [
      ...layout,
      {
        i: `w-${type}-${options?.now ?? 0}`,
        type,
        x: Math.max(0, Math.min(DASHBOARD_COLUMNS - entry.defaultW, position.x)),
        y: Math.max(0, position.y),
        w: entry.defaultW,
        h: entry.defaultH,
        minW: entry.minW,
        minH: entry.minH,
      },
    ],
  };
}
