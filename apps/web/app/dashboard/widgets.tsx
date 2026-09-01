"use client";

import { memo, useEffect, useState } from "react";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { predictionWinDisplay } from "../../lib/strategy/prediction-display";
import { parseYouTubeEmbed } from "../../lib/youtube";
import { Icon, type IconName } from "../../components/icon";
import { Badge, EmptyState } from "../../components/ui";

type EmptyHint = {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
};

const WIDGET_ICON: Record<string, { icon: IconName; tone: string; toneBg: string }> = {
  next_match: { icon: "swords", tone: "#1457d9", toneBg: "#e4ecfc" },
  recent_result: { icon: "stats", tone: "#1457d9", toneBg: "#e4ecfc" },
  competition_snapshot: { icon: "target", tone: "#1457d9", toneBg: "#e4ecfc" },
  scouting_coverage: { icon: "clipboard", tone: "#15803d", toneBg: "#dcfce7" },
  prediction_summary: { icon: "bolt", tone: "#1457d9", toneBg: "#e4ecfc" },
  robot_readiness: { icon: "cube", tone: "#0f766e", toneBg: "#ccfbf1" },
  pit_youtube: { icon: "display", tone: "#1457d9", toneBg: "#e4ecfc" },
  sync_status: { icon: "gear", tone: "#0f766e", toneBg: "#ccfbf1" },
  ai_usage: { icon: "bolt", tone: "#1457d9", toneBg: "#e4ecfc" },
  quick_actions: { icon: "grid", tone: "#1457d9", toneBg: "#e4ecfc" },
  notifications: { icon: "bell", tone: "#1457d9", toneBg: "#e4ecfc" },
  alerts: { icon: "bell", tone: "#b91c1c", toneBg: "#fee2e2" },
  onboarding_checklist: { icon: "pin", tone: "#1457d9", toneBg: "#e4ecfc" },
  team_todos: { icon: "clipboard", tone: "#1457d9", toneBg: "#e4ecfc" },
  subteam_upcoming: { icon: "calendar", tone: "#0f766e", toneBg: "#ccfbf1" },
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
  children: React.ReactNode;
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
      style={showIcon ? ({ ["--tone" as string]: iconMeta!.tone, ["--tone-bg" as string]: iconMeta!.toneBg }) : undefined}
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

function allianceTeams(alliance: unknown) {
  if (!alliance || typeof alliance !== "object") return "—";
  const keys = (alliance as { teamKeys?: string[] }).teamKeys ?? [];
  return keys.map((key) => key.replace(/^frc/, "")).join(" · ") || "—";
}

export function countdownLabel(iso: string | null | undefined) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "Now";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const countdownListeners = new Set<() => void>();
let countdownTimer: number | null = null;

function startSharedCountdown() {
  if (countdownTimer !== null || typeof window === "undefined") return;
  countdownTimer = window.setInterval(() => {
    for (const listener of countdownListeners) listener();
  }, 1000);
}

function stopSharedCountdown() {
  if (countdownListeners.size > 0 || countdownTimer === null || typeof window === "undefined") return;
  window.clearInterval(countdownTimer);
  countdownTimer = null;
}

/** Tick once per second so countdownLabel stays live (next match, leave times, etc.). */
export function useCountdownTick(active = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const listener = () => setTick((n) => n + 1);
    countdownListeners.add(listener);
    startSharedCountdown();
    return () => {
      countdownListeners.delete(listener);
      stopSharedCountdown();
    };
  }, [active]);
}

/** Live Soft-UI countdown — only renders when a real ISO schedule exists (never DEMO). */
export function LiveCountdown({ iso }: { iso: string | null | undefined }) {
  useCountdownTick(Boolean(iso));
  return <>{countdownLabel(iso)}</>;
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
      const scheduled = data.scheduledTime as string | undefined;
      const alliance = data.ourAlliance === "red" || data.ourAlliance === "blue" ? data.ourAlliance : null;
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
          {payload?.status === "live" ? (
            <div className={`dash-next-match${alliance ? ` alliance-${alliance}` : ""}`}>
              <div>
                <span>{String(data.compLevel ?? "Match")}</span>
                <strong>{String(data.matchNumber ?? "—")}</strong>
              </div>
              <div className="dash-countdown">
                <span>Starts in</span>
                <strong>
                  <LiveCountdown iso={scheduled} />
                </strong>
              </div>
              {typeof data.bumperCue === "string" && data.bumperCue ? (
                <p className="dash-bumper-cue">{data.bumperCue}</p>
              ) : null}
              {Array.isArray(data.partners) || Array.isArray(data.opponents) ? (
                <p className="dash-match-sides">
                  With{" "}
                  {Array.isArray(data.partners) && data.partners.length
                    ? data.partners.map(String).join(" · ")
                    : "—"}
                  <em>
                    {" "}
                    vs{" "}
                    {Array.isArray(data.opponents) && data.opponents.length
                      ? data.opponents.map(String).join(" · ")
                      : "—"}
                  </em>
                </p>
              ) : null}
              <footer>
                <div>
                  <span>Red</span>
                  <b>{allianceTeams(data.redAlliance)}</b>
                </div>
                <div>
                  <span>Blue</span>
                  <b>{allianceTeams(data.blueAlliance)}</b>
                </div>
              </footer>
            </div>
          ) : null}
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
              <p className="app-muted">This tile is the last stored row — never a DEMO %.</p>
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
    default:
      return (
        <Shell type={type} title={type.replaceAll("_", " ")} payload={payload} emptyHint={hint} orgId={orgId}>
          <p className="app-muted">Unknown widget.</p>
        </Shell>
      );
  }
});
