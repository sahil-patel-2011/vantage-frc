"use client";

import { memo, useState } from "react";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { parseYouTubeEmbed } from "../../lib/youtube";
import { Icon, type IconName } from "../../components/icon";
import { Badge, EmptyState } from "../../components/ui";
import { predictionWinDisplay } from "../../lib/strategy/prediction-display";
import { AskAiWidget } from "./widgets/ask-ai";
import { LiveCountdown } from "./widgets/live-countdown";
import { NextMatchLive } from "./widgets/next-match";
import {
  AllianceDeskLive,
  AnnouncementsLive,
  AssemblyManualLive,
  AttendanceLive,
  BatteriesLive,
  BudgetPartsLive,
  CadResourcesLive,
  CalendarTodayLive,
  CodingResourcesLive,
  DutiesLive,
  EventCountdownLive,
  EventReadinessLive,
  FilesRecentLive,
  HoursLive,
  LearnProgressLive,
  MatchScheduleLive,
  MyDayLive,
  SponsorFollowupsLive,
  TeamChatLive,
  TeamProfileLive,
  WeatherVenueLive,
} from "./widgets/home-cards";

export { LiveCountdown, countdownLabel, useCountdownTick } from "./widgets/live-countdown";

type EmptyHint = {
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
    body: "Connect workspace, event, and TBA.",
  },
  onboarding_checklist: {
    title: "Finish setup",
    body: "Set workspace, event, and TBA.",
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

function emptyHintFor(type: string): EmptyHint {
  return (
    EMPTY_COPY[type] ?? {
      title: "Nothing yet",
      body: "Finish workspace and event setup.",
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

function Shell({
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
  children?: React.ReactNode;
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

function PitStreamEmbed({ title, embedUrl }: { title: string; embedUrl: string }) {
  const [play, setPlay] = useState(false);
  if (!play) {
    return (
      <button className="dash-pit-facade" type="button" onClick={() => setPlay(true)}>
        Load {title}
      </button>
    );
  }
  return (
    <div className="dash-pit-frame">
      <iframe
        title={title}
        src={`${embedUrl}${embedUrl.includes("?") ? "&" : "?"}mute=1`}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function setupQuickActions(orgId: string, tbaConfigured?: boolean) {
  const links: Array<{ href: string; label: string; detail: string }> = [];
  if (!orgId) {
    links.push({ href: "/invite", label: "Invite", detail: "Open invite from email" });
  } else {
    links.push({ href: hubHref("/competition", "command", orgId), label: "Event", detail: "Select event" });
    links.push({ href: withOrgHref("/team/admin", orgId), label: "Members", detail: "Invite teammates" });
  }
  if (tbaConfigured === false) {
    links.push({ href: withOrgHref("/team/data", orgId), label: "TBA", detail: "Connect TBA" });
  }
  return links;
}

export const DashboardWidgetView = memo(function DashboardWidgetView({
  type,
  payload,
  orgId,
  tbaConfigured,
}: {
  type: string;
  payload?: WidgetPayload;
  orgId: string;
  tbaConfigured?: boolean;
}) {
  const data = payload?.data ?? {};
  const withOrg = (href: string) => withOrgHref(href, orgId || null);
  const hint = emptyHintFor(type);

  switch (type) {
    case "next_match": {
      const myDayHref =
        typeof data.href === "string" && data.href ? data.href : withOrg("/my-day");
      return (
        <Shell
          type={type}
          title="Next match"
          payload={payload}
          href={myDayHref}
          emptyHint={hint}
          orgId={orgId}
        >
          {payload?.status === "live" ? <NextMatchLive data={data} /> : null}
        </Shell>
      );
    }
    case "robot_readiness": {
      const checklist = (data.checklist as Array<{ label: string; ready: boolean; detail: string }> | undefined) ?? [];
      const hasSignals = checklist.some((item) => item.detail && item.detail !== "None logged" && item.detail !== "None");
      if (payload?.status === "live" && !hasSignals && Number(data.percent ?? 0) === 0) {
        return (
          <Shell
            type={type}
            title="Robot readiness"
            payload={{ ...payload, status: "empty", message: hint.body }}
            href={withOrg("/pit")}
            emptyHint={hint}
            orgId={orgId}
          >
            {null}
          </Shell>
        );
      }
      return (
        <Shell type={type} title="Robot readiness" payload={payload} href={withOrg("/pit")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <>
              <div className="dash-stat-row">
                <strong>{String(data.percent ?? 0)}%</strong>
                <span>checklist ready</span>
              </div>
              <div className="readiness-track">
                <i style={{ width: `${Number(data.percent ?? 0)}%` }} />
              </div>
              <ul className="dash-checklist">
                {checklist.map((item) => (
                  <li key={item.label} className={item.ready ? "done" : undefined}>
                    <span>{item.label}</span>
                    <b>{item.detail}</b>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Shell>
      );
    }
    case "recent_result":
      return (
        <Shell type={type} title="Recent result" payload={payload} href={withOrg("/intel")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <div className="dash-result">
              <span className={`wl ${String(data.result).toLowerCase()}`}>{String(data.result)}</span>
              <div>
                <strong>
                  Us {String(data.us)} · Opp {String(data.opp)}
                </strong>
                <small>
                  {String(data.matchKey)} · margin {Number(data.margin) > 0 ? "+" : ""}
                  {String(data.margin)}
                </small>
              </div>
            </div>
          ) : null}
        </Shell>
      );
    case "prediction_summary": {
      const alliance = data.ourAlliance === "blue" ? "blue" : data.ourAlliance === "red" ? "red" : null;
      const win = predictionWinDisplay({
        pRed: typeof data.pRed === "number" ? data.pRed : Number(data.pRed),
        pBlue: typeof data.pBlue === "number" ? data.pBlue : Number(data.pBlue),
        alliance,
        modelVersion: typeof data.modelVersion === "string" ? data.modelVersion : null,
      });
      const factors = (data.keyFactors as Array<{ name?: string; impact?: string }> | undefined)?.slice(0, 3) ?? [];
      return (
        <Shell type={type} title="Prediction" payload={payload} href={withOrg("/strategy")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" && win ? (
            <>
              <div className="dash-stat-row">
                <strong>{win.label}</strong>
                <span>
                  {alliance ? `${alliance} alliance` : "alliance TBD"} · {String(data.modelVersion ?? "")}
                </span>
              </div>
              <div className="mini-probability">
                <i style={{ width: `${win.percent}%` }} />
              </div>
              <ul className="dash-checklist">
                {factors.map((factor, index) => (
                  <li key={`${factor.name}-${index}`}>
                    <span>{factor.name ?? "Factor"}</span>
                    <b>{factor.impact ?? ""}</b>
                  </li>
                ))}
              </ul>
              <p className="app-muted">Showing the last stored result.</p>
              <a className="app-button secondary" href={withOrg("/strategy")}>
                Recompute on Strategy
              </a>
            </>
          ) : payload?.status === "live" ? (
            <>
              <p className="app-muted">Last stored row is not a grounded prediction.</p>
              <a className="app-button secondary" href={withOrg("/strategy")}>
                Recompute on Strategy
              </a>
            </>
          ) : null}
        </Shell>
      );
    }
    case "alerts": {
      const items = (data.items as Array<{ id: string; title: string; body: string; severity: string }> | undefined) ?? [];
      const openDisagreements = Number(data.openDisagreements ?? 0);
      if (payload?.status === "live" && items.length === 0 && openDisagreements === 0) {
        return (
          <Shell
            type={type}
            title="Alerts"
            payload={payload}
            href={withOrg("/scouting")}
            emptyHint={emptyHintFor("alerts")}
            orgId={orgId}
            preferChildren
          >
            <div className="dash-empty calm">
              <strong>No new alerts</strong>
              <p>You are clear — disagreements and live org alerts will show up here.</p>
            </div>
          </Shell>
        );
      }
      return (
        <Shell type={type} title="Alerts" payload={payload} href={withOrg("/scouting")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <ul className="dash-checklist">
              <li>
                <span>Open scouting disagreements</span>
                <b>{String(openDisagreements)}</b>
              </li>
              {items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.title}
                    <small className="dash-sub">{item.body}</small>
                  </span>
                  <b>{item.severity}</b>
                </li>
              ))}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "scouting_coverage":
      return (
        <Shell type={type} title="Scouting coverage" payload={payload} href={withOrg("/scouting")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <div className="dash-metric-grid">
              <div>
                <strong>{String(data.assignments ?? 0)}</strong>
                <span>assignments</span>
              </div>
              <div>
                <strong>{String(data.reports ?? 0)}</strong>
                <span>reports</span>
              </div>
              <div>
                <strong>{String(data.openDisagreements ?? 0)}</strong>
                <span>open gaps</span>
              </div>
            </div>
          ) : null}
        </Shell>
      );
    case "competition_snapshot": {
      const scope = String(data.scope ?? "event");
      const rankLabel =
        data.rank != null
          ? `#${String(data.rank)}`
          : scope === "year"
            ? String(data.record ?? "Season")
            : "—";
      return (
        <Shell type={type} title="Competition snapshot" payload={payload} href={withOrg("/intel")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <div className="dash-metric-grid">
              <div>
                <strong>{rankLabel}</strong>
                <span>
                  {scope === "year" ? "year EPA scope" : `rank · ${String(data.record ?? "")}`}
                </span>
              </div>
              <div>
                <strong>{data.epaTotal != null ? Number(data.epaTotal).toFixed(1) : "—"}</strong>
                <span>EPA ({String(data.source ?? "")})</span>
              </div>
              <div>
                <strong>
                  {data.epaAuto != null ? Number(data.epaAuto).toFixed(1) : "—"} /{" "}
                  {data.epaTeleop != null ? Number(data.epaTeleop).toFixed(1) : "—"} /{" "}
                  {data.epaEndgame != null ? Number(data.epaEndgame).toFixed(1) : "—"}
                </strong>
                <span>auto / teleop / end</span>
              </div>
            </div>
          ) : null}
        </Shell>
      );
    }
    case "sync_status": {
      const sources = (data.sources as Array<{ source: string; status: string; lastSuccessAt: string | null }> | undefined) ?? [];
      return (
        <Shell type={type} title="Sync status" payload={payload} href={withOrg("/team/data")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <ul className="dash-checklist">
              {sources.map((source) => (
                <li key={source.source} className={source.status === "ok" || source.status === "healthy" ? "done" : undefined}>
                  <span>{source.source.toUpperCase()}</span>
                  <b>
                    {source.status}
                    {source.lastSuccessAt ? ` · ${new Date(source.lastSuccessAt).toLocaleString()}` : ""}
                  </b>
                </li>
              ))}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "pit_youtube": {
      const url = String(data.url ?? "");
      const embed = url ? parseYouTubeEmbed(url)?.embedUrl : null;
      return (
        <Shell type={type} title={String(data.title ?? "Pit stream")} payload={payload} href={withOrg("/display")} emptyHint={hint} orgId={orgId}>
          {embed ? <PitStreamEmbed title={String(data.title ?? "Pit stream")} embedUrl={embed} /> : null}
        </Shell>
      );
    }
    case "notifications": {
      const items = (data.items as Array<{ id: string; type: string; payload: Record<string, unknown>; readAt: string | null }> | undefined) ?? [];
      const unread = Number(data.unread ?? 0);
      if (payload?.status === "live" && items.length === 0) {
        return (
          <Shell
            type={type}
            title="Notifications"
            payload={payload}
            href="/notifications"
            emptyHint={emptyHintFor("notifications")}
            orgId={orgId}
            preferChildren
          >
            <div className="dash-empty calm">
              <strong>Inbox clear</strong>
              <p>No notifications yet. Unread count stays at zero until something is sent.</p>
            </div>
          </Shell>
        );
      }
      return (
        <Shell type={type} title="Notifications" payload={payload} href="/notifications" emptyHint={hint} orgId={orgId} preferChildren>
          {payload?.status === "live" ? (
            <ul className="dash-checklist">
              {unread >= 1 ? (
                <li>
                  <span>Unread</span>
                  <b>{String(unread)}</b>
                </li>
              ) : null}
              {items.slice(0, 4).map((item) => {
                const isMessageNotif =
                  item.type === "direct_message" || item.type === "message_mention";
                const conversationId =
                  isMessageNotif && typeof item.payload?.conversationId === "string"
                    ? item.payload.conversationId
                    : null;
                const fromName =
                  isMessageNotif && typeof item.payload?.fromName === "string"
                    ? item.payload.fromName
                    : null;
                const preview =
                  isMessageNotif && typeof item.payload?.preview === "string"
                    ? item.payload.preview
                    : null;
                const label =
                  item.type === "direct_message"
                    ? fromName
                      ? `DM from ${fromName}`
                      : "Direct message"
                    : item.type === "message_mention"
                      ? fromName
                        ? `${fromName} mentioned you`
                        : "Mentioned in Team Messages"
                      : item.type.replaceAll("_", " ");
                const href = conversationId
                  ? withOrg(`/messages?conversationId=${encodeURIComponent(conversationId)}`)
                  : isMessageNotif
                    ? withOrg("/messages")
                    : null;
                return (
                  <li key={item.id} className={item.readAt ? "done" : undefined}>
                    {href ? (
                      <a href={href}>
                        <span>{label}</span>
                        {preview ? <small className="dash-notif-preview">{preview}</small> : null}
                      </a>
                    ) : (
                      <span>{label}</span>
                    )}
                    <b>{item.readAt ? "Read" : "New"}</b>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "subteam_upcoming": {
      const items =
        (data.items as Array<{
          id: string;
          title: string;
          kind: string;
          startsAt: string;
          subteamName: string | null;
          subteamColor: string | null;
        }> | undefined) ?? [];
      const calendarHref = withOrg(String(data.href ?? "/team/calendar"));
      const fmt = (iso: string) => {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return iso;
        return date.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      };
      return (
        <Shell
          type={type}
          title="What's next for my subteam"
          payload={payload}
          href={calendarHref}
          emptyHint={{
            ...hint,
            ctaHref: calendarHref,
            ctaLabel: String(data.ctaLabel ?? hint.ctaLabel ?? "Open calendar"),
            body: payload?.message ?? hint.body,
          }}
          orgId={orgId}
          preferChildren
        >
          {payload?.status === "live" && items.length > 0 ? (
            <ul className="dash-checklist dash-subteam-strip">
              {items.map((item) => {
                const startMs = new Date(item.startsAt).getTime();
                const live = Number.isFinite(startMs) && startMs > Date.now() - 60_000;
                return (
                  <li key={item.id}>
                    <span>
                      <i
                        className="dash-subteam-dot"
                        style={{ background: item.subteamColor ?? "var(--app-accent, #0f766e)" }}
                        aria-hidden
                      />
                      <a href={calendarHref}>{item.title}</a>
                    </span>
                    <b>
                      {live ? (
                        <>
                          <LiveCountdown iso={item.startsAt} />
                          {" · "}
                        </>
                      ) : null}
                      {fmt(item.startsAt)}
                      {item.subteamName ? ` · ${item.subteamName}` : " · Whole team"}
                    </b>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "team_todos": {
      const items =
        (data.items as Array<{
          id: string;
          title: string;
          status: string;
          dueOn: string | null;
          assigneeName: string | null;
        }> | undefined) ?? [];
      return (
        <Shell type={type} title="Team todos" payload={payload} href={withOrg("/todos")} emptyHint={hint} orgId={orgId} preferChildren>
          {payload?.status === "live" ? (
            <div className="dash-metric-grid" style={{ marginBottom: items.length ? 10 : 0 }}>
              <div>
                <strong>{String(data.open ?? 0)}</strong>
                <span>open</span>
              </div>
              <div>
                <strong>{String(data.mineOpen ?? 0)}</strong>
                <span>mine</span>
              </div>
              <div>
                <strong>{String(data.overdue ?? 0)}</strong>
                <span>overdue</span>
              </div>
            </div>
          ) : null}
          {payload?.status === "live" && items.length > 0 ? (
            <ul className="dash-checklist">
              {items.map((item) => (
                <li key={item.id}>
                  <a href={withOrg(`/todos?todoId=${encodeURIComponent(item.id)}`)}>
                    <span>{item.title}</span>
                    <small className="dash-notif-preview">
                      {item.status}
                      {item.assigneeName ? ` · ${item.assigneeName}` : ""}
                      {item.dueOn ? ` · ${item.dueOn}` : ""}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "ai_usage":
      return (
        <Shell type={type} title="AI usage" payload={payload} href={withOrg("/team")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <div className="dash-metric-grid">
              <div>
                <strong>{data.planCode ? String(data.planCode) : "—"}</strong>
                <span>plan</span>
              </div>
              <div>
                <strong>${Number(data.used ?? 0).toFixed(2)}</strong>
                <span>used</span>
              </div>
              <div>
                <strong>{data.allowancePercent != null ? `${Math.round(Number(data.allowancePercent))}%` : "—"}</strong>
                <span>of allowance</span>
              </div>
            </div>
          ) : null}
        </Shell>
      );
    case "quick_actions": {
      const fromPayload = (data.links as Array<{ href: string; label: string; detail: string }> | undefined) ?? [];
      const needsSetup = !orgId || tbaConfigured === false;
      const links = needsSetup || fromPayload.length === 0 ? setupQuickActions(orgId, tbaConfigured) : fromPayload;
      return (
        <Shell
          type={type}
          title="Quick actions"
          payload={payload}
          emptyHint={hint}
          orgId={orgId}
          preferChildren
        >
          <div className="dash-actions">
            {links.map((link) => (
              <a key={`${link.href}-${link.label}`} href={withOrg(link.href)}>
                <span>{link.label}</span>
                <strong>{link.detail}</strong>
              </a>
            ))}
          </div>
        </Shell>
      );
    }
    case "onboarding_checklist": {
      const steps =
        (data.steps as Array<{
          key: string;
          label: string;
          detail: string;
          done: boolean;
          href: string;
        }> | undefined) ?? [];
      return (
        <Shell
          type={type}
          title="Setup checklist"
          payload={payload}
          emptyHint={emptyHintFor("onboarding_checklist")}
          orgId={orgId}
          preferChildren
        >
          <ol className="dash-setup-steps compact">
            {steps.map((step, index) => (
              <li key={step.key} className={step.done ? "done" : index === steps.findIndex((item) => !item.done) ? "current" : undefined}>
                <b>{index + 1}</b>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                {!step.done ? <a href={withOrg(step.href)}>Open</a> : <em>Done</em>}
              </li>
            ))}
          </ol>
        </Shell>
      );
    }
    case "ask_ai": {
      const href = typeof data.href === "string" && data.href ? data.href : "/ai?tab=chat";
      const askHref = withOrg(href);
      return (
        <Shell type={type} title="Ask AI" payload={payload} href={askHref} emptyHint={hint} orgId={orgId} preferChildren>
          <AskAiWidget href={askHref} />
        </Shell>
      );
    }
    case "my_day":
      return (
        <Shell type={type} title="My day" payload={payload} href={withOrg("/my-day")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <MyDayLive data={data} /> : null}
        </Shell>
      );
    case "learn_progress":
      return (
        <Shell type={type} title="Learn" payload={payload} href={withOrg("/cad-learn")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <LearnProgressLive data={data} /> : null}
        </Shell>
      );
    case "files_recent":
      return (
        <Shell type={type} title="Recent files" payload={payload} href={withOrg("/files")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <FilesRecentLive data={data} /> : null}
        </Shell>
      );
    case "team_chat":
      return (
        <Shell type={type} title="Team chat" payload={payload} href={withOrg("/messages")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <TeamChatLive data={data} /> : null}
        </Shell>
      );
    case "duties":
      return (
        <Shell type={type} title="Duties" payload={payload} href={withOrg("/duties")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <DutiesLive data={data} /> : null}
        </Shell>
      );
    case "budget_parts":
      return (
        <Shell type={type} title="Budget & parts" payload={payload} href={withOrg("/business?tab=finance")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <BudgetPartsLive data={data} /> : null}
        </Shell>
      );
    case "attendance":
      return (
        <Shell type={type} title="Attendance tonight" payload={payload} href={withOrg("/team?tab=attendance")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AttendanceLive data={data} /> : null}
        </Shell>
      );
    case "outreach_hours":
      return (
        <Shell type={type} title="Outreach hours" payload={payload} href={withOrg("/business?tab=evidence")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <HoursLive data={data} label="this month" /> : null}
        </Shell>
      );
    case "announcements_ack":
      return (
        <Shell type={type} title="Announcements" payload={payload} href={withOrg("/announcements")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AnnouncementsLive data={data} /> : null}
        </Shell>
      );
    case "event_countdown":
      return (
        <Shell type={type} title="Next event" payload={payload} href={withOrg("/command")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <EventCountdownLive data={data} /> : null}
        </Shell>
      );
    case "hours_month":
      return (
        <Shell type={type} title="Hours this month" payload={payload} href={withOrg("/hours")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <HoursLive data={data} label="your hours" /> : null}
        </Shell>
      );
    case "calendar_today":
      return (
        <Shell type={type} title="Today" payload={payload} href={withOrg("/team/calendar")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <CalendarTodayLive data={data} /> : null}
        </Shell>
      );
    case "cad_resources":
      return (
        <Shell type={type} title="CAD resources" payload={payload} href={withOrg("/cad")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <CadResourcesLive data={data} /> : null}
        </Shell>
      );
    case "coding_resources":
      return (
        <Shell type={type} title="Coding resources" payload={payload} href={withOrg("/code")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <CodingResourcesLive data={data} /> : null}
        </Shell>
      );
    case "team_profile":
      return (
        <Shell type={type} title="Team profile" payload={payload} href={withOrg("/team/profile")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <TeamProfileLive data={data} /> : null}
        </Shell>
      );
    case "alliance_desk":
      return (
        <Shell type={type} title="Alliance desk" payload={payload} href={withOrg("/alliance-selection-desk")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AllianceDeskLive data={data} /> : null}
        </Shell>
      );
    case "match_schedule":
      return (
        <Shell type={type} title="Match schedule" payload={payload} href={withOrg("/schedule")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <MatchScheduleLive data={data} /> : null}
        </Shell>
      );
    case "batteries":
      return (
        <Shell type={type} title="Batteries" payload={payload} href={withOrg("/batteries")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <BatteriesLive data={data} /> : null}
        </Shell>
      );
    case "assembly_manual":
      return (
        <Shell type={type} title="Assembly manual" payload={payload} href={withOrg("/assembly-manual")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <AssemblyManualLive data={data} /> : null}
        </Shell>
      );
    case "sponsor_followups":
      return (
        <Shell type={type} title="Sponsor follow-ups" payload={payload} href={withOrg("/business?tab=sponsors")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <SponsorFollowupsLive data={data} /> : null}
        </Shell>
      );
    case "event_readiness":
      return (
        <Shell type={type} title="Event readiness" payload={payload} href={withOrg("/packing")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <EventReadinessLive data={data} /> : null}
        </Shell>
      );
    case "weather_venue":
      return (
        <Shell type={type} title="Venue weather" payload={payload} href={withOrg("/command")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <WeatherVenueLive data={data} /> : null}
        </Shell>
      );
    default:
      return <Shell type={type} title={hint.title} payload={payload} emptyHint={hint} orgId={orgId} />;
  }
});
