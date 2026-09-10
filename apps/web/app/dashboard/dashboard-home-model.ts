import {
  WIDGET_CATALOG,
  canAccessWidget,
  type DashboardWidgetLayout,
} from "../../lib/dashboard/catalog";
import { widgetLockReason } from "./dashboard-canvas";
import type { BoardMeta, BoardState, PaletteRow } from "./dashboard-board-types";

/** Every catalog entry with a reason it cannot be added, so nothing fails silently. */
export function dashboardPaletteRows(
  layout: DashboardWidgetLayout[],
  role: string | null,
): PaletteRow[] {
  return WIDGET_CATALOG.map((entry) => {
    if (layout.some((item) => item.type === entry.type)) {
      return { entry, status: "placed" as const, reason: null };
    }
    if (!canAccessWidget(entry.type, role)) {
      return { entry, status: "locked" as const, reason: widgetLockReason(entry) };
    }
    return { entry, status: "add" as const, reason: null };
  });
}

export function dashboardBoardLists(boards: BoardMeta[], board: BoardState | null) {
  const personalBoards = boards.filter((item) => item.scope === "personal");
  const orgBoards = boards.filter((item) => item.scope === "org");
  const ordered = [...personalBoards, ...orgBoards];
  const switcherBoards =
    board?.id && !ordered.some((item) => item.id === board.id) && !board.isDefault
      ? [
          { id: board.id, name: board.name, scope: board.scope, isActive: true } satisfies BoardMeta,
          ...ordered,
        ]
      : ordered;
  return { personalBoards, orgBoards, switcherBoards };
}

export function homeHeaderDetail(input: {
  meLoaded: boolean;
  orgId: string;
  tbaConfigured: boolean | undefined;
  setupRequired: boolean;
  eventName: unknown;
}): string {
  if (!input.meLoaded) return "Loading your team…";
  if (!input.orgId) return "Choose your team to load live data.";
  if (input.tbaConfigured === false) {
    return "Your week — what is next, what is due, and what to learn. Match data arrives once The Blue Alliance is connected below.";
  }
  if (input.setupRequired) return "Set your active event to load competition data.";
  if (input.eventName) return String(input.eventName);
  return "Home — widgets appear when live data exists.";
}
