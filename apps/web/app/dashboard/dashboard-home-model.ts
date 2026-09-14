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
  if (!input.orgId) return "Choose your team to see your day.";
  if (input.tbaConfigured === false) {
    return "Your week — next match, hours, and what to do now. Match times fill in after a mentor connects the event.";
  }
  if (input.setupRequired) return "Set the event you’re at so match times can show.";
  if (input.eventName) return String(input.eventName);
  return "Your week. Cards fill in as the team adds matches, hours, and duties.";
}

export type HomeNowAction = {
  title: string;
  detail: string;
  href: string;
  cta: string;
};

function firstString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function firstListTitle(data: Record<string, unknown> | undefined, key: string): string | null {
  const raw = data?.[key];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (!first || typeof first !== "object") return null;
  return firstString((first as { title?: unknown }).title);
}

/** One next step a student can take — never a wall of launchpads, never invented counts. */
export function homeNowAction(input: {
  orgId: string;
  nextMatchLabel?: string | null;
  dutyTitle?: string | null;
  clockedIn?: boolean;
  openTodos?: number;
}): HomeNowAction {
  if (!input.orgId) {
    return {
      title: "Choose your team",
      detail: "Home fills in with your next match, hours, and what to do today.",
      href: "/workspace",
      cta: "Choose your team",
    };
  }
  const match = firstString(input.nextMatchLabel);
  if (match) {
    return {
      title: "You’re up next",
      detail: match,
      href: "/my-day",
      cta: "Open My Day",
    };
  }
  const duty = firstString(input.dutyTitle);
  if (duty) {
    return {
      title: "You’re on duty",
      detail: duty,
      href: "/my-day",
      cta: "See duties",
    };
  }
  if (input.clockedIn) {
    return {
      title: "You’re in the shop",
      detail: "Your hours are still running.",
      href: "/hours-self-view",
      cta: "Open My hours",
    };
  }
  const todos = input.openTodos ?? 0;
  if (Number.isInteger(todos) && todos > 0) {
    return {
      title: todos === 1 ? "One thing on your list" : `${todos} things on your list`,
      detail: "Open Todos and knock one out.",
      href: "/todos",
      cta: "Open todos",
    };
  }
  return {
    title: "Nothing you have to do right now",
    detail: "When a match, duty, or task is assigned, it shows up here.",
    href: "/my-day",
    cta: "Open My Day",
  };
}

export function homeNowFromWidgets(input: {
  orgId: string;
  nextMatchData?: Record<string, unknown>;
  widgets: Record<string, { type: string; data?: Record<string, unknown> }>;
}): HomeNowAction {
  const byType = (type: string) => Object.values(input.widgets).find((row) => row.type === type)?.data;
  const next = input.nextMatchData ?? byType("next_match");
  const matchBits = [firstString(next?.compLevel), firstString(String(next?.matchNumber ?? ""))].filter(Boolean);
  const matchLabel =
    firstString(next?.matchLabel) ??
    (matchBits.length ? matchBits.join(" ") : null);
  const myDay = byType("my_day");
  const dutyTitle = firstListTitle(myDay, "duties") ?? firstListTitle(byType("duties"), "items");
  const todoData = byType("team_todos");
  const todoItems = Array.isArray(todoData?.items) ? todoData.items.length : 0;
  const openTodos =
    typeof todoData?.open === "number" && Number.isFinite(todoData.open) ? Number(todoData.open) : todoItems;
  const hours = byType("hours_month");
  const clockedIn = hours?.openSession === true;
  return homeNowAction({
    orgId: input.orgId,
    nextMatchLabel: matchLabel,
    dutyTitle,
    clockedIn,
    openTodos,
  });
}
