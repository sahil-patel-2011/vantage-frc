"use client";

import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { parseYouTubeEmbed } from "../../lib/youtube";
import { Icon, type IconName } from "../../components/app-shell";

type EmptyHint = {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
};

const WIDGET_ICON: Record<string, { icon: IconName; tone: string; toneBg: string }> = {
  next_match: { icon: "swords", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  recent_result: { icon: "stats", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  competition_snapshot: { icon: "target", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  scouting_coverage: { icon: "clipboard", tone: "#15803d", toneBg: "#dcfce7" },
  prediction_summary: { icon: "bolt", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  robot_readiness: { icon: "cube", tone: "#0f766e", toneBg: "#ccfbf1" },
  pit_youtube: { icon: "display", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  sync_status: { icon: "gear", tone: "#0f766e", toneBg: "#ccfbf1" },
  ai_usage: { icon: "bolt", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  quick_actions: { icon: "grid", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  notifications: { icon: "bell", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  alerts: { icon: "bell", tone: "#b91c1c", toneBg: "#fee2e2" },
};

const EMPTY_COPY: Record<string, EmptyHint> = {
  next_match: {
    title: "No upcoming match yet",
    body: "Select a team workspace and active event to load the schedule from TBA.",
    ctaHref: "/workspace",
    ctaLabel: "Select workspace",
  },
  recent_result: {
    title: "No scored matches yet",
    body: "Once TBA syncs results for your event, the latest W/L shows here.",
    ctaHref: "/workspace",
    ctaLabel: "Select event",
  },
  competition_snapshot: {
    title: "No competition snapshot",
    body: "Rank, record, and EPA appear after an event is selected and TBA/Statbotics sync.",
    ctaHref: "/workspace",
    ctaLabel: "Select event",
  },
  scouting_coverage: {
    title: "No scouting coverage yet",
    body: "Assignments and reports appear after your team workspace and event are set.",
    ctaHref: "/scouting",
    ctaLabel: "Open scouting",
  },
  prediction_summary: {
    title: "No prediction yet",
    body: "Need match schedule + team metrics from TBA/Statbotics/scouting before a win/loss prediction can run.",
    ctaHref: "/strategy",
    ctaLabel: "Open strategy",
  },
  sync_status: {
    title: "Sync not ready",
    body: "Connect TBA (platform key or admin connector) before live rank/match sync.",
    ctaHref: "/team/data",
    ctaLabel: "Connect TBA",
  },
  pit_youtube: {
    title: "No pit stream",
    body: "Add an org YouTube URL in Displays when you are ready to share the pit feed.",
    ctaHref: "/display",
    ctaLabel: "Open displays",
  },
  ai_usage: {
    title: "AI usage unavailable",
    body: "Owner/admin access and a billing plan are required to view usage.",
    ctaHref: "/team",
    ctaLabel: "Team settings",
  },
  notifications: {
    title: "No notifications",
    body: "Alerts for matches, scouting, and sync issues appear here when they are sent.",
  },
  robot_readiness: {
    title: "No checklist data yet",
    body: "Add robot / battery / maintenance records after your team workspace is set up.",
    ctaHref: "/code",
    ctaLabel: "Open robot checks",
  },
  alerts: {
    title: "No new alerts",
    body: "Live org alerts and open scouting disagreements will list here when they exist.",
  },
  quick_actions: {
    title: "Get set up",
    body: "Use the actions below to connect workspace, event, and TBA before live widgets fill in.",
  },
};

function emptyHintFor(type: string): EmptyHint {
  return (
    EMPTY_COPY[type] ?? {
      title: "Nothing to show yet",
      body: "Complete workspace and event setup to load live data. Vantage does not invent stats.",
    }
  );
}

function StatusBadge({ status }: { status: WidgetPayload["status"] | "waiting" }) {
  if (status === "live") return <span className="app-badge good">Live</span>;
  if (status === "empty") return <span className="app-badge">No data</span>;
  if (status === "waiting") return <span className="app-badge setup">Waiting</span>;
  return <span className="app-badge setup">Setup required</span>;
}

function EmptyState({
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
    <div className="dash-empty">
      <strong>{hint.title}</strong>
      <p>{message || hint.body}</p>
      {ctaHref && hint.ctaLabel ? (
        <a className="dash-empty-cta" href={ctaHref}>
          {hint.ctaLabel}
        </a>
      ) : null}
    </div>
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
  const isHero = type === "next_match" && showLive;

  return (
    <article
      className={`dash-widget app-card${isHero ? " hero" : ""}`}
      style={iconMeta ? ({ ["--tone" as string]: iconMeta.tone, ["--tone-bg" as string]: iconMeta.toneBg }) : undefined}
    >
      <header>
        <div className="dash-widget-title">
          {iconMeta ? (
            <i className="dash-widget-icon">
              <Icon name={iconMeta.icon} />
            </i>
          ) : null}
          <div>
            <h2>{title}</h2>
            {showLive && payload?.updatedAt ? (
              <small className="dash-updated">Updated {new Date(payload.updatedAt).toLocaleTimeString()}</small>
            ) : null}
          </div>
        </div>
        <StatusBadge status={payload ? (preferChildren && status !== "live" ? "waiting" : payload.status) : "waiting"} />
      </header>
      {useChildren ? (
        children
      ) : (
        <EmptyState hint={emptyHint} message={payload?.message} href={href} orgId={orgId} />
      )}
      {href ? (
        <a className="dash-widget-link" href={href}>
          Open →
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

function setupQuickActions(orgId: string, tbaConfigured?: boolean) {
  const links: Array<{ href: string; label: string; detail: string }> = [];
  if (!orgId) {
    links.push({ href: "/workspace", label: "Workspace", detail: "Select workspace" });
  } else {
    links.push({ href: "/workspace", label: "Event", detail: "Select event / location" });
  }
  if (tbaConfigured === false) {
    links.push({ href: "/team/data", label: "TBA", detail: "Connect TBA" });
  }
  links.push({ href: "/team", label: "Invite", detail: "Invite members" });
  return links;
}

export function DashboardWidgetView({
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
  const withOrg = (href: string) => (orgId ? `${href}${href.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}` : href);
  const hint = emptyHintFor(type);

  switch (type) {
    case "next_match": {
      const scheduled = data.scheduledTime as string | undefined;
      return (
        <Shell type={type} title="Next match" payload={payload} href={withOrg("/intel")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <div className="dash-next-match">
              <div>
                <span>{String(data.compLevel ?? "Match")}</span>
                <strong>{String(data.matchNumber ?? "—")}</strong>
              </div>
              <div className="dash-countdown">
                <span>Starts in</span>
                <strong>{countdownLabel(scheduled)}</strong>
              </div>
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
            href={withOrg("/code")}
            emptyHint={hint}
            orgId={orgId}
          >
            {null}
          </Shell>
        );
      }
      return (
        <Shell type={type} title="Robot readiness" payload={payload} href={withOrg("/code")} emptyHint={hint} orgId={orgId}>
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
      const pRed = Number(data.pRed ?? 0);
      const factors = (data.keyFactors as Array<{ name?: string; impact?: string }> | undefined)?.slice(0, 3) ?? [];
      return (
        <Shell type={type} title="Prediction" payload={payload} href={withOrg("/strategy")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <>
              <div className="dash-stat-row">
                <strong>{Math.round(pRed * 100)}%</strong>
                <span>red alliance · {String(data.modelVersion ?? "")}</span>
              </div>
              <div className="mini-probability">
                <i style={{ width: `${pRed * 100}%` }} />
              </div>
              <ul className="dash-checklist">
                {factors.map((factor, index) => (
                  <li key={`${factor.name}-${index}`}>
                    <span>{factor.name ?? "Factor"}</span>
                    <b>{factor.impact ?? ""}</b>
                  </li>
                ))}
              </ul>
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
    case "competition_snapshot":
      return (
        <Shell type={type} title="Competition snapshot" payload={payload} href={withOrg("/intel")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <div className="dash-metric-grid">
              <div>
                <strong>#{String(data.rank ?? "—")}</strong>
                <span>rank · {String(data.record ?? "")}</span>
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
          {embed ? (
            <div className="dash-pit-frame">
              <iframe
                title={String(data.title ?? "Pit stream")}
                src={`${embed}${embed.includes("?") ? "&" : "?"}mute=1`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          ) : null}
        </Shell>
      );
    }
    case "notifications": {
      const items = (data.items as Array<{ id: string; type: string; payload: Record<string, unknown>; readAt: string | null }> | undefined) ?? [];
      const unread = Number(data.unread ?? 0);
      if (payload?.status === "live" && items.length === 0) {
        return (
          <Shell type={type} title="Notifications" payload={payload} emptyHint={emptyHintFor("notifications")} orgId={orgId} preferChildren>
            <div className="dash-empty calm">
              <strong>Inbox clear</strong>
              <p>No notifications yet. Unread count stays at zero until something is sent.</p>
            </div>
          </Shell>
        );
      }
      return (
        <Shell type={type} title="Notifications" payload={payload} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? (
            <ul className="dash-checklist">
              {unread >= 1 ? (
                <li>
                  <span>Unread</span>
                  <b>{String(unread)}</b>
                </li>
              ) : null}
              {items.slice(0, 4).map((item) => (
                <li key={item.id} className={item.readAt ? "done" : undefined}>
                  <span>{item.type.replaceAll("_", " ")}</span>
                  <b>{item.readAt ? "Read" : "New"}</b>
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
    default:
      return (
        <Shell type={type} title={type.replaceAll("_", " ")} payload={payload} emptyHint={hint} orgId={orgId}>
          <p className="app-muted">Unknown widget.</p>
        </Shell>
      );
  }
}
