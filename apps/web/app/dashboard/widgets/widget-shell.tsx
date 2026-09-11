"use client";

import type { ReactNode } from "react";
import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { Icon, type IconName } from "../../../components/icon";
import { Badge, EmptyState } from "../../../components/ui";
import { type EmptyHint } from "./widget-empty-copy";

export type { EmptyHint } from "./widget-empty-copy";
export { emptyHintFor } from "./widget-empty-copy";

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
