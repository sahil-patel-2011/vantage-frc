/**
 * "Today" strip for Home — the four or five things a member needs before they
 * touch a widget: next match, next thing on the calendar, their open work,
 * unread chat, and the sharpest ops cue for their role.
 *
 * Pure: it only reads what the snapshot and /api/me already return. Anything
 * with no real data is left out — the strip shrinks, it never invents.
 */
import type { HomeStripItem } from "../home-workflows";
import { withOrgHref } from "../nav/product-nav";
import type { WidgetPayload } from "./snapshot";

export type TodayCard = {
  id: "next_match" | "next_event" | "my_work" | "chat" | "focus" | "clock";
  label: string;
  title: string;
  detail?: string | null;
  href: string;
  /** ISO time for a live countdown, when the card is about a moment. */
  at?: string | null;
  tone: "accent" | "neutral" | "warn";
  icon: "swords" | "calendar" | "clipboard" | "chat" | "target" | "clock";
};

export type TodayInput = {
  orgId: string | null | undefined;
  widgets: Record<string, WidgetPayload | undefined>;
  homeStrip?: HomeStripItem[];
  unreadMessages?: number;
  /** Open hours session started at (ISO), when the member is clocked in. */
  clockedInAt?: string | null;
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function formatEventWhen(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const dayMs = 24 * 60 * 60_000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayOffset = Math.floor((date.getTime() - startOfToday.getTime()) / dayMs);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (dayOffset === 0) return `Today · ${time}`;
  if (dayOffset === 1) return `Tomorrow · ${time}`;
  if (dayOffset > 1 && dayOffset < 7) {
    return `${date.toLocaleDateString(undefined, { weekday: "short" })} · ${time}`;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ` · ${time}`;
}

export function buildTodayCards(input: TodayInput, now = Date.now()): TodayCard[] {
  const orgId = input.orgId ?? null;
  const cards: TodayCard[] = [];

  const nextMatch = input.widgets.next_match;
  if (nextMatch?.status === "live" && nextMatch.data) {
    const level = str(nextMatch.data.compLevel)?.toUpperCase() ?? "MATCH";
    const number = nextMatch.data.matchNumber != null ? String(nextMatch.data.matchNumber) : "";
    cards.push({
      id: "next_match",
      label: "Next match",
      title: `${level} ${number}`.trim(),
      detail: str(nextMatch.data.bumperCue),
      href: str(nextMatch.data.href) ?? withOrgHref("/competition?tab=my-day", orgId),
      at: str(nextMatch.data.scheduledTime),
      tone: "accent",
      icon: "swords",
    });
  }

  const upcoming = input.widgets.subteam_upcoming;
  const events = Array.isArray(upcoming?.data?.items) ? (upcoming!.data!.items as Array<Record<string, unknown>>) : [];
  const nextEvent = events.find((row) => {
    const at = str(row.startsAt);
    return at && new Date(at).getTime() >= now - 60 * 60_000;
  });
  if (upcoming?.status === "live" && nextEvent) {
    const subteam = str(nextEvent.subteamName);
    cards.push({
      id: "next_event",
      label: subteam ? `${subteam} · next` : "Next on calendar",
      title: str(nextEvent.title) ?? "Upcoming",
      detail: formatEventWhen(str(nextEvent.startsAt), now),
      href: str(upcoming.data?.href) ?? withOrgHref("/team?tab=calendar", orgId),
      at: str(nextEvent.startsAt),
      tone: "neutral",
      icon: "calendar",
    });
  }

  const todos = input.widgets.team_todos;
  if (todos?.status === "live" && todos.data) {
    const mine = num(todos.data.mineOpen);
    const overdue = num(todos.data.overdue);
    const open = num(todos.data.open);
    if (mine > 0 || overdue > 0) {
      cards.push({
        id: "my_work",
        label: "My work",
        title: mine > 0 ? `${mine} open task${mine === 1 ? "" : "s"}` : `${open} open on the team`,
        detail: overdue > 0 ? `${overdue} overdue` : null,
        href: withOrgHref("/team?tab=todos", orgId),
        tone: overdue > 0 ? "warn" : "neutral",
        icon: "clipboard",
      });
    }
  }

  if ((input.unreadMessages ?? 0) > 0) {
    const unread = input.unreadMessages ?? 0;
    cards.push({
      id: "chat",
      label: "Team chat",
      title: `${unread > 99 ? "99+" : unread} unread`,
      detail: null,
      href: withOrgHref("/team?tab=messages", orgId),
      tone: "neutral",
      icon: "chat",
    });
  }

  if (input.clockedInAt) {
    cards.push({
      id: "clock",
      label: "Shop hours",
      title: "Clocked in",
      detail: formatEventWhen(input.clockedInAt, now),
      href: withOrgHref("/hours", orgId),
      at: input.clockedInAt,
      tone: "neutral",
      icon: "clock",
    });
  }

  // The role strip's sharpest warning earns a slot; a calm strip stays quiet.
  const focus = (input.homeStrip ?? []).find((item) => item.tone === "warn");
  if (focus && cards.length < 5) {
    cards.push({
      id: "focus",
      label: focus.label,
      title: focus.detail,
      detail: null,
      href: focus.href,
      at: focus.at ?? null,
      tone: "warn",
      icon: "target",
    });
  }

  return cards.slice(0, 5);
}
