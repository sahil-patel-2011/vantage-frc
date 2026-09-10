"use client";

import type { ReactNode } from "react";
import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { Icon, type IconName } from "../../../components/icon";
import { Badge, EmptyState } from "../../../components/ui";

export type EmptyHint = {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
};

/**
 * Widget accents are HUES, named from the tone ramp (soft-ui.css). They used to
 * be hex pairs — a hue plus a light-only plate — written straight into an inline
 * style, which is unreachable from any stylesheet and therefore wrong on a dark
 * panel by construction. The plate and the ink are derived per theme now
 * (system.css), so only the hue is named here.
 */
const WIDGET_ICON: Record<string, { icon: IconName; tone: string }> = {
  next_match: { icon: "swords", tone: "var(--tone-blue)" },
  recent_result: { icon: "stats", tone: "var(--tone-blue)" },
  competition_snapshot: { icon: "target", tone: "var(--tone-blue)" },
  scouting_coverage: { icon: "clipboard", tone: "var(--tone-green)" },
  prediction_summary: { icon: "bolt", tone: "var(--tone-blue)" },
  robot_readiness: { icon: "cube", tone: "var(--tone-teal)" },
  pit_youtube: { icon: "display", tone: "var(--tone-blue)" },
  sync_status: { icon: "gear", tone: "var(--tone-teal)" },
  ai_usage: { icon: "bolt", tone: "var(--tone-blue)" },
  quick_actions: { icon: "grid", tone: "var(--tone-blue)" },
  notifications: { icon: "bell", tone: "var(--tone-blue)" },
  alerts: { icon: "bell", tone: "var(--tone-red)" },
  onboarding_checklist: { icon: "pin", tone: "var(--tone-blue)" },
  team_todos: { icon: "clipboard", tone: "var(--tone-blue)" },
  subteam_upcoming: { icon: "calendar", tone: "var(--tone-teal)" },
  my_day: { icon: "calendar", tone: "var(--tone-blue)" },
  learn_progress: { icon: "pin", tone: "var(--tone-teal)" },
  files_recent: { icon: "clipboard", tone: "var(--tone-blue)" },
  team_chat: { icon: "chat", tone: "var(--tone-blue)" },
  duties: { icon: "clipboard", tone: "var(--tone-teal)" },
  budget_parts: { icon: "stats", tone: "var(--tone-green)" },
  attendance: { icon: "users", tone: "var(--tone-teal)" },
  outreach_hours: { icon: "users", tone: "var(--tone-green)" },
  announcements_ack: { icon: "bell", tone: "var(--tone-blue)" },
  ask_ai: { icon: "bolt", tone: "var(--tone-blue)" },
  event_countdown: { icon: "calendar", tone: "var(--tone-blue)" },
  hours_month: { icon: "clipboard", tone: "var(--tone-teal)" },
  calendar_today: { icon: "calendar", tone: "var(--tone-blue)" },
  cad_resources: { icon: "cube", tone: "var(--tone-teal)" },
  coding_resources: { icon: "code", tone: "var(--tone-blue)" },
  team_profile: { icon: "users", tone: "var(--tone-blue)" },
  alliance_desk: { icon: "swords", tone: "var(--tone-blue)" },
  match_schedule: { icon: "calendar", tone: "var(--tone-blue)" },
  batteries: { icon: "bolt", tone: "var(--tone-teal)" },
  assembly_manual: { icon: "clipboard", tone: "var(--tone-teal)" },
  sponsor_followups: { icon: "users", tone: "var(--tone-green)" },
  event_readiness: { icon: "target", tone: "var(--tone-blue)" },
  weather_venue: { icon: "display", tone: "var(--tone-teal)" },
};

const EMPTY_COPY: Record<string, EmptyHint> = {
  next_match: {
    title: "No upcoming match",
    body: "Shows the next scheduled match after TBA sync.",
    ctaHref: "/my-day",
    ctaLabel: "Open My Day",
  },
  recent_result: {
    title: "No scored matches",
    body: "Results appear after TBA sync.",
    ctaHref: "/command",
    ctaLabel: "Set event",
  },
  competition_snapshot: {
    title: "No snapshot",
    body: "Rank and EPA need an event plus TBA sync.",
    ctaHref: "/command",
    ctaLabel: "Set event",
  },
  scouting_coverage: {
    title: "No coverage yet",
    body: "Assignments appear after event setup.",
    ctaHref: "/scouting",
    ctaLabel: "Open scouting",
  },
  prediction_summary: {
    title: "No prediction yet",
    body: "Needs schedule and team metrics.",
    ctaHref: "/strategy",
    ctaLabel: "Open strategy",
  },
  sync_status: {
    title: "Sync not ready",
    body: "Connect TBA for live match data.",
    ctaHref: "/team/data",
    ctaLabel: "Connect TBA",
  },
  pit_youtube: {
    title: "No pit stream",
    body: "Add a YouTube URL in Displays.",
    ctaHref: "/display",
    ctaLabel: "Open displays",
  },
  ai_usage: {
    title: "AI usage unavailable",
    body: "Owner/admin access required.",
    ctaHref: "/team",
    ctaLabel: "Team settings",
  },
  notifications: {
    title: "No notifications",
    body: "Alerts appear when they are sent.",
    ctaHref: "/notifications",
    ctaLabel: "Open notifications",
  },
  robot_readiness: {
    title: "No checklist data",
    body: "Add robot checks after setup.",
    ctaHref: "/code",
    ctaLabel: "Open robot checks",
  },
  alerts: {
    title: "No new alerts",
    body: "Org alerts list here when they exist.",
    ctaHref: "/command",
    ctaLabel: "Open command",
  },
  team_todos: {
    title: "No open todos",
    body: "Team todos appear when your org adds them.",
    ctaHref: "/todos",
    ctaLabel: "Open todos",
  },
  subteam_upcoming: {
    title: "Nothing upcoming",
    body: "Schedule a practice to see the next session.",
    ctaHref: "/team/calendar",
    ctaLabel: "Open calendar",
  },
  my_day: {
    title: "Nothing on your day yet",
    body: "Your next match and leave time show up after TBA sync.",
    ctaHref: "/my-day",
    ctaLabel: "Open My Day",
  },
  learn_progress: {
    title: "No learning track started",
    body: "Open Learn CAD or programming setup.",
    ctaHref: "/cad-learn",
    ctaLabel: "Learn CAD",
  },
  files_recent: {
    title: "No files yet",
    body: "Open Files to add one.",
    ctaHref: "/files",
    ctaLabel: "Open Files",
  },
  team_chat: {
    title: "No unread chats",
    body: "Team messages show up here.",
    ctaHref: "/messages",
    ctaLabel: "Open chat",
  },
  duties: {
    title: "Nothing to assign",
    body: "Duties appear when a session needs people.",
    ctaHref: "/logistics",
    ctaLabel: "Open logistics",
  },
  budget_parts: {
    title: "No budget or part requests",
    body: "Open Money to add a budget or review requests.",
    ctaHref: "/business?tab=finance",
    ctaLabel: "Open Money",
  },
  ask_ai: {
    title: "Ask AI",
    body: "Type a question. It uses your team's facts and says when it does not know.",
    ctaHref: "/ai?tab=chat",
    ctaLabel: "Ask AI",
  },
  quick_actions: {
    title: "Get set up",
    body: "Connect team, event, and TBA.",
  },
  onboarding_checklist: {
    title: "Finish setup",
    body: "Set team, event, and TBA.",
    ctaHref: "/command",
    ctaLabel: "Set event",
  },
  attendance: {
    title: "No session tonight",
    body: "Attendance shows up after a practice or meeting is on the calendar.",
    ctaHref: "/team/calendar",
    ctaLabel: "Open calendar",
  },
  outreach_hours: {
    title: "No outreach hours",
    body: "Log outreach hours after an event.",
    ctaHref: "/business?tab=evidence",
    ctaLabel: "Open outreach",
  },
  announcements_ack: {
    title: "Nothing to acknowledge",
    body: "Announcements that need a read-receipt show up here.",
    ctaHref: "/announcements",
    ctaLabel: "Open announcements",
  },
  event_countdown: {
    title: "No upcoming event",
    body: "Set an active event to see the countdown.",
    ctaHref: "/command",
    ctaLabel: "Set event",
  },
  hours_month: {
    title: "No hours this month",
    body: "Clock in from Hours after a session.",
    ctaHref: "/hours",
    ctaLabel: "Open hours",
  },
  calendar_today: {
    title: "Nothing on the calendar",
    body: "Add a practice or meeting to see today.",
    ctaHref: "/team/calendar",
    ctaLabel: "Open calendar",
  },
  cad_resources: {
    title: "No CAD files yet",
    body: "Paste an Onshape link or open the vault.",
    ctaHref: "/cad",
    ctaLabel: "Open CAD",
  },
  coding_resources: {
    title: "No robot-code repo",
    body: "Connect GitHub from Connectors to see the repo and Bugbot findings.",
    ctaHref: "/code",
    ctaLabel: "Open code",
  },
  team_profile: {
    title: "Team profile not built",
    body: "Open Team profile to load TBA and Statbotics facts.",
    ctaHref: "/team/profile",
    ctaLabel: "Open profile",
  },
  alliance_desk: {
    title: "Alliance desk idle",
    body: "Alliance selection opens at the event.",
    ctaHref: "/alliance-selection-desk",
    ctaLabel: "Open alliance desk",
  },
  match_schedule: {
    title: "No match schedule",
    body: "Connect TBA or paste a schedule.",
    ctaHref: "/schedule",
    ctaLabel: "Open schedule",
  },
  batteries: {
    title: "No batteries logged",
    body: "Add a battery from pit tools.",
    ctaHref: "/pit",
    ctaLabel: "Open pit",
  },
  assembly_manual: {
    title: "No assembly manual",
    body: "Start one from an Onshape assembly.",
    ctaHref: "/assembly-manual",
    ctaLabel: "Open assembly manual",
  },
  sponsor_followups: {
    title: "No sponsor follow-ups",
    body: "Open Sponsors to log the next step.",
    ctaHref: "/business?tab=sponsors",
    ctaLabel: "Open sponsors",
  },
  event_readiness: {
    title: "No event on the calendar",
    body: "Set an active event to see packing and travel.",
    ctaHref: "/command",
    ctaLabel: "Set event",
  },
  weather_venue: {
    title: "No venue weather",
    body: "Weather appears when an event with a location is active.",
    ctaHref: "/command",
    ctaLabel: "Set event",
  },
};

export function emptyHintFor(type: string): EmptyHint {
  return (
    EMPTY_COPY[type] ?? {
      title: "Nothing yet",
      body: "Finish team and event setup.",
    }
  );
}

function StatusBadge({ status }: { status: WidgetPayload["status"] | "waiting" }) {
  // icon={null}: the "good" tone's default checkmark glyph would be new visual
  // noise on every live widget header — keep the text-only pill this replaced.
  if (status === "live") return <Badge tone="good" icon={null}>Live</Badge>;
  return null;
}

/** Widget-scoped empty slot — the shared `EmptyState` in `compact` mode, so it drops
 * into a widget that is already an `app-card` without doubling the border/shadow. */
function WidgetEmptyState({
  hint,
  message,
  href,
  orgId,
}: {
  hint: EmptyHint;
  message?: string;
  href?: string;
  orgId: string;
}) {
  const withOrg = (path: string) =>
    orgId ? `${path}${path.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}` : path;
  const ctaHref = hint.ctaHref ? withOrg(hint.ctaHref) : href;
  return (
    <EmptyState compact title={hint.title} description={message || hint.body}>
      {ctaHref && hint.ctaLabel ? (
        <a className="dash-empty-cta" href={ctaHref}>
          {hint.ctaLabel}
        </a>
      ) : null}
    </EmptyState>
  );
}

export function WidgetShell({
  type,
  title,
  payload,
  children,
  href,
  emptyHint,
  orgId,
  preferChildren,
}: {
  type: string;
  title: string;
  payload?: WidgetPayload;
  children?: ReactNode;
  href?: string;
  emptyHint: EmptyHint;
  orgId: string;
  preferChildren?: boolean;
}) {
  const status = payload?.status ?? "setup_required";
  const showLive = status === "live";
  const useChildren = preferChildren || (showLive && children != null && children !== false);
  const iconMeta = WIDGET_ICON[type];
  // Colored circle icons only when the widget has real live data — never decorate empty/waiting shells.
  const showIcon = showLive && Boolean(iconMeta);
  const isHero = type === "next_match";

  return (
    <article
      className={`dash-widget app-card${isHero ? " hero" : ""}${showLive ? "" : " is-empty"}`}
      style={showIcon ? ({ ["--tone" as string]: iconMeta!.tone }) : undefined}
    >
      <header>
        <div className="dash-widget-title">
          {showIcon ? (
            <i className="dash-widget-icon">
              <Icon name={iconMeta!.icon} />
            </i>
          ) : null}
          <div>
            <h2>{title}</h2>
            {showLive && payload?.updatedAt ? (
              <small className="dash-updated">Updated {new Date(payload.updatedAt).toLocaleTimeString()}</small>
            ) : null}
          </div>
        </div>
        {showLive ? <StatusBadge status={payload?.status ?? "live"} /> : null}
      </header>
      {useChildren ? (
        children
      ) : (
        <WidgetEmptyState hint={emptyHint} message={payload?.message} href={href} orgId={orgId} />
      )}
      {href && showLive ? (
        <a className="dash-widget-link" href={href}>
          {emptyHint.ctaLabel ?? "Open"} →
        </a>
      ) : null}
    </article>
  );
}
