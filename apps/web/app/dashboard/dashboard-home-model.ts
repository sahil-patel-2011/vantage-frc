import { MEDIA_ENABLED } from "../../lib/media-availability";
import {
  WIDGET_CATALOG,
  canAccessWidget,
  type DashboardWidgetLayout,
} from "../../lib/dashboard/catalog";
import { HIDDEN_ON_HOME_SHORT, type HiddenOnHomeReason } from "../../lib/dashboard/edit-mode";
import { widgetLockReason } from "./dashboard-canvas";
import type { BoardMeta, BoardState, PaletteRow } from "./dashboard-board-types";

/**
 * Every catalog entry with a reason it cannot be added, so nothing fails
 * silently. A card already on the board that Home is not showing right now says
 * so ("Hidden (empty)") instead of "On Home", and a card whose data is empty
 * right now is marked before you add it.
 */
export function dashboardPaletteRows(
  layout: DashboardWidgetLayout[],
  role: string | null,
  opts: {
    hidden?: ReadonlyMap<string, HiddenOnHomeReason>;
    widgets?: Record<string, { status?: string } | undefined>;
  } = {},
): PaletteRow[] {
  return WIDGET_CATALOG.filter((entry) => MEDIA_ENABLED || entry.type !== "pit_youtube").map((entry) => {
    const placed = layout.find((item) => item.type === entry.type);
    if (placed) {
      const reason = opts.hidden?.get(placed.i);
      return { entry, status: "placed" as const, reason: null, placedLabel: reason ? HIDDEN_ON_HOME_SHORT[reason] : "On Home" };
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
  // Silent: the card below is headed "Choose your team" and its button says
  // the same words again. Three sightings of one instruction on one screen.
  if (!input.orgId) return "";
  const namedEvent = typeof input.eventName === "string" && input.eventName.trim().length > 0;
  // The event row under this header already names a set event. Saying a mentor
  // still has to connect one contradicts that row.
  if (input.tbaConfigured === false && !namedEvent) {
    return "Your week — next match, hours, and what to do now. Match times fill in after a mentor connects the event.";
  }
  // Deliberately silent. The SETUP card below is driven by this same state and
  // carries the instruction plus the button that acts on it; saying it up here
  // as well meant the first two things on the page were the same sentence.
  if (input.setupRequired) return "";
  // Deliberately silent. The event row directly below this is the same words
  // with a pin icon and a link on it, so printing the name here as well put
  // the event on screen twice, one line apart.
  if (input.eventName) return "";
  return "Your week. Cards fill in as the team adds matches, hours, and duties.";
}

export type HomeNowAction = {
  title: string;
  detail: string;
  href: string;
  cta: string;
  /** Nothing to act on (idle, or still loading): offer the way in as a quiet link, not the
   * screen's primary button. A blue "Open My Day" under "Nothing to do" asks for a click
   * that leads nowhere new. */
  quiet?: boolean;
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

export type ScoutDuty = { matchKey: string; teamKey: string; matchLabel: string; station?: string | null };

/**
 * "Scout Qual 22 · Red 2 · 254", with one button that opens the match form with
 * that robot already picked. Only from a real assignment (my_day's scoutDuty):
 * no assignment, no card.
 */
export function scoutDutyAction(scout: ScoutDuty | null | undefined): HomeNowAction | null {
  if (!scout?.matchKey || !scout.teamKey) return null;
  const number = scout.teamKey.replace(/^frc/i, "");
  const station = firstString(scout.station ?? null);
  return {
    title: `Scout ${scout.matchLabel}${station ? ` · ${station}` : ""} · ${number}`,
    detail: "Your next scouting assignment. The form opens with this robot picked.",
    href: `/competition?tab=scouting&scoutTab=match&matchKey=${encodeURIComponent(scout.matchKey)}&teamKey=${encodeURIComponent(scout.teamKey)}`,
    cta: "Open scouting form",
  };
}

/** One next step a student can take — never a wall of launchpads, never invented counts. */
export function homeNowAction(input: {
  orgId: string;
  nextMatchLabel?: string | null;
  /** The person's own next scouting robot, from the my_day widget. */
  scoutDuty?: ScoutDuty | null;
  /** Team role; a scout's next robot comes before everything else. */
  role?: string | null;
  dutyTitle?: string | null;
  clockedIn?: boolean;
  openTodos?: number;
  /** The next thing on today's calendar, already formatted. */
  nextEventToday?: { title: string; whenLabel: string } | null;
}): HomeNowAction {
  if (!input.orgId) {
    return {
      title: "Choose your team",
      detail: "Home fills in with your next match, hours, and what to do today.",
      href: "/workspace",
      cta: "Choose your team",
    };
  }
  const scoutAction = scoutDutyAction(input.scoutDuty);
  // At an event a scout's job is the next robot on their list. Home said "Nothing you have
  // to do right now" (all of the team's own matches were played) while Scouting had them
  // up next, and Home had no way into the form at all.
  if (scoutAction && (input.role ?? "").toLowerCase() === "scout") return scoutAction;
  const match = firstString(input.nextMatchLabel);
  if (match) {
    return {
      title: "You’re up next",
      detail: match,
      href: "/my-day",
      cta: "Open My Day",
    };
  }
  if (scoutAction) return scoutAction;
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
      cta: "Open My Hours",
    };
  }
  /*
    What the calendar says is on today.

    This is the thing most students want from Home on most days, and the card
    was the one place in the app that could not see it — the data was already
    loaded, by the `calendar_today` widget, and simply never read. A build
    night at six is more use than "3 things on your list", and less use than
    a match starting or a shift you are already on, which is where it sits.

    Today only. The widget returns a week, and "Practice tonight" is a
    different claim from "practice on Thursday" — one of them you act on now.
  */
  const event = input.nextEventToday;
  if (event?.title && event.whenLabel) {
    return {
      title: event.title,
      detail: event.whenLabel,
      href: "/team?tab=calendar",
      cta: "Open Calendar",
    };
  }

  const todos = input.openTodos ?? 0;
  if (Number.isInteger(todos) && todos > 0) {
    return {
      title: todos === 1 ? "One thing on your list" : `${todos} things on your list`,
      // No sentence here: the heading counts them and the button opens them.
      // "Open Todos and knock one out." sat between the two saying neither.
      detail: "",
      href: "/todos",
      cta: "Open todos",
    };
  }
  return {
    title: "Nothing you have to do right now",
    detail: "When a match, duty, or task is assigned, it shows up here.",
    href: "/my-day",
    cta: "Open My Day",
    quiet: true,
  };
}

/**
 * The card, from whatever the widgets have loaded.
 *
 * `loaded: false` matters. Before the widgets arrive there is nothing to read,
 * and every check below falls through to "Nothing you have to do right now" —
 * which the card then showed, and replaced a moment later with "You're in the
 * shop". A student saw the wrong answer first, confidently, and it is the one
 * answer that tells them to stop looking.
 *
 * So while it does not know, it says that instead.
 */
export function homeNowFromWidgets(input: {
  orgId: string;
  nextMatchData?: Record<string, unknown>;
  widgets: Record<string, { type: string; data?: Record<string, unknown> }>;
  loaded?: boolean;
  /** Fixed clock for tests; the real one otherwise. */
  now?: Date;
  role?: string | null;
}): HomeNowAction {
  // Not loaded yet says nothing, with or without a team: "Choose your team" flashed for an
  // owner whose team simply had not loaded.
  if (input.loaded === false) {
    return {
      title: "Working out what is next",
      detail: "",
      href: "/my-day",
      cta: "Open My Day",
      quiet: true,
    };
  }
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
  const scoutRaw = myDay?.scoutDuty as
    | { matchKey?: unknown; teamKey?: unknown; matchLabel?: unknown; station?: unknown }
    | null
    | undefined;
  const scoutDuty =
    scoutRaw && typeof scoutRaw.matchKey === "string" && typeof scoutRaw.teamKey === "string"
      ? {
          matchKey: scoutRaw.matchKey,
          teamKey: scoutRaw.teamKey,
          matchLabel: firstString(scoutRaw.matchLabel) ?? scoutRaw.matchKey,
          station: firstString(scoutRaw.station),
        }
      : null;
  return homeNowAction({
    orgId: input.orgId,
    nextMatchLabel: matchLabel,
    scoutDuty,
    role: input.role,
    dutyTitle,
    clockedIn,
    openTodos,
    nextEventToday: nextEventToday(byType("calendar_today"), input.now ?? new Date()),
  });
}


/**
 * The next thing on today's calendar, or null.
 *
 * The `calendar_today` widget loads a week, because that is what its own card
 * shows. The "what to do now" card is about now, so this takes only what is
 * still ahead *today* — a practice that finished an hour ago is not something
 * to do, and Thursday's is not something to do yet.
 *
 * Local time throughout: which day an instant belongs to is a question about
 * the person reading the screen, and they are standing in the shop.
 */
export function nextEventToday(
  data: Record<string, unknown> | undefined,
  now: Date,
): { title: string; whenLabel: string } | null {
  const items = Array.isArray(data?.items) ? data.items : [];
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  let best: { title: string; at: Date } | null = null;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as { title?: unknown; startsAt?: unknown };
    const title = firstString(row.title);
    if (!title || typeof row.startsAt !== "string") continue;
    const at = new Date(row.startsAt);
    if (Number.isNaN(at.getTime())) continue;
    if (at.getTime() < now.getTime() || at.getTime() >= endOfDay) continue;
    if (!best || at.getTime() < best.at.getTime()) best = { title, at };
  }
  if (!best) return null;
  return { title: best.title, whenLabel: `Today at ${clockLabel(best.at)}` };
}

/** "6 PM", "6:30 PM" — the hour drops its zeroes. */
function clockLabel(at: Date): string {
  const hour = at.getHours();
  const minute = at.getMinutes();
  const meridiem = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0
    ? `${twelve} ${meridiem}`
    : `${twelve}:${`${minute}`.padStart(2, "0")} ${meridiem}`;
}
