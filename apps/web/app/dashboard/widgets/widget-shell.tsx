"use client";

import { useContext, type ReactNode } from "react";
import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { Icon, type IconName } from "../../../components/icon";
import { EmptyState } from "../../../components/ui";
import { type EmptyHint, liveLinkLabel, studentWidgetDescription } from "./widget-empty-copy";
import { WidgetsLoadedContext } from "./widgets-loaded";

export type { EmptyHint } from "./widget-empty-copy";
export { emptyHintFor, liveLinkLabel, syncStatusDestination } from "./widget-empty-copy";

/** Cards that are a tool, not a feed: a "Live" badge on them says nothing. */
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

/** Widget-scoped empty slot — the shared `EmptyState` in `compact` mode, so it drops
 * into a widget that is already an `app-card` without doubling the border/shadow. */
function WidgetEmptyState({
  type,
  hint,
  message,
  href,
  orgId,
  lead,
}: {
  type: string;
  hint: EmptyHint;
  message?: string;
  href?: string;
  orgId: string;
  lead?: boolean;
}) {
  const withOrg = (path: string) =>
    orgId ? `${path}${path.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}` : path;
  // Every match played: the next useful look is where the team finished, not a dead card.
  const eventOver = type === "next_match" && /are played/.test(message ?? "");
  // Not on this event's schedule: usually the wrong event. A lead can change it from here;
  // everyone else is told who does, instead of being asked to check something they can't change.
  const wrongEvent = type === "next_match" && /isn't on this event's match schedule/.test(message ?? "");
  const description = wrongEvent && !lead
    ? (message ?? "").replace(/Check that it's the event you're at\.?/, "Your team lead picks the event.")
    : studentWidgetDescription(message, hint);
  const ctaHref = wrongEvent
    ? lead ? withOrg("/command?pickEvent=1") : undefined
    : eventOver
    ? withOrg("/rankings")
    : hint.noEmptyCta
      ? undefined
      : hint.ctaHref
        ? withOrg(hint.ctaHref)
        : href;
  const ctaLabel = wrongEvent ? "Change event" : eventOver ? "See the rankings" : hint.ctaLabel;
  return (
    <EmptyState compact title={eventOver ? "Our matches here are done" : hint.title} description={description}>
      {ctaHref && ctaLabel ? (
        <a className="dash-empty-cta" href={ctaHref}>
          {ctaLabel} →
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
  lead,
}: {
  type: string;
  title: string;
  payload?: WidgetPayload;
  children?: ReactNode;
  href?: string;
  emptyHint: EmptyHint;
  orgId: string;
  preferChildren?: boolean;
  /** Owner or admin: may change what the card depends on (the team's event). */
  lead?: boolean;
}) {
  const widgetsLoaded = useContext(WidgetsLoadedContext);
  const status = payload?.status ?? "setup_required";
  const showLive = status === "live";
  // Not loaded yet is not "empty": the card waits quietly instead of claiming
  // there is nothing (or that AI is off) and changing its mind a second later.
  const loading = !payload && !widgetsLoaded;
  // A widget that renders its own body only when live used to leave a titled, blank card
  // behind otherwise (Team todos, Notifications). No rendered child means the empty state.
  const hasChildren = Array.isArray(children)
    ? children.some((child) => child != null && child !== false)
    : children != null && children !== false;
  const useChildren = hasChildren && (preferChildren || showLive);
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
          </div>
        </div>
        {/* No "LIVE" pill or to-the-second "Updated" stamp on each card: live is the normal state,
            and Home says once, under the cards, when it last synced. */}
      </header>
      {loading ? (
        <div className="dash-widget-wait" aria-busy="true" aria-label={`Loading ${title}`}>
          <i />
          <i />
        </div>
      ) : useChildren ? (
        children
      ) : (
        <WidgetEmptyState type={type} hint={emptyHint} message={payload?.message} href={href} orgId={orgId} lead={lead} />
      )}
      {href && showLive ? (
        <a className="dash-widget-link" href={href}>
          {liveLinkLabel(emptyHint)} →
        </a>
      ) : null}
    </article>
  );
}
