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

/** Maps a react-grid-layout drag/resize onto the saved 12-column layout. */
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
