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
  onboarding_checklist: { icon: "pin", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  team_todos: { icon: "clipboard", tone: "#1f4fd6", toneBg: "#e4ecfc" },
  subteam_upcoming: { icon: "calendar", tone: "#0f766e", toneBg: "#ccfbf1" },
};

const EMPTY_COPY: Record<string, EmptyHint> = {
  next_match: {
    title: "No upcoming match yet",
    body: "Select a team workspace and active event, then open My Day for bumper color and travel cues.",
    ctaHref: "/my-day",
    ctaLabel: "Open My Day",
  },
  recent_result: {
    title: "No scored matches yet",
    body: "Once TBA syncs results for your event, the latest W/L shows here.",
    ctaHref: "/command",
    ctaLabel: "Select event",
  },
  competition_snapshot: {
    title: "No competition snapshot",
    body: "Rank, record, and EPA appear after an event is selected and TBA/Statbotics sync.",
    ctaHref: "/command",
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
  team_todos: {
    title: "No open todos",
    body: "Shared team todos appear here after your org adds real action items — nothing is invented.",
    ctaHref: "/todos",
    ctaLabel: "Open todos",
  },
  subteam_upcoming: {
    title: "Nothing upcoming for your subteams",
    body: "Create a subteam and schedule a practice — the next session shows here.",
    ctaHref: "/team/calendar",
    ctaLabel: "Open calendar",
  },
  quick_actions: {
    title: "Get set up",
    body: "Use the actions below to connect workspace, event, and TBA before live widgets fill in.",
  },
  onboarding_checklist: {
    title: "Finish setup",
    body: "Complete workspace, event, TBA, scouting, and AI steps to unlock live widgets.",
    ctaHref: "/command",
    ctaLabel: "Select event",
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
  const orgQuery = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  const links: Array<{ href: string; label: string; detail: string }> = [];
  if (!orgId) {
    links.push({ href: "/invite", label: "Workspace", detail: "Accept invite" });
  } else {
    links.push({ href: `/command${orgQuery}`, label: "Event", detail: "Select event" });
  }
  if (tbaConfigured === false) {
    links.push({ href: `/team/data${orgQuery}`, label: "TBA", detail: "Connect TBA" });
  }
  links.push({ href: `/team${orgQuery}`, label: "Invite", detail: "Invite members" });
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
      const alliance = data.ourAlliance === "red" || data.ourAlliance === "blue" ? data.ourAlliance : null;
      const myDayHref =
        typeof data.href === "string" && data.href ? data.href : withOrg("/my-day");
      return (
        <Shell
          type={type}
          title="Next match / bumper"
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
                <strong>{countdownLabel(scheduled)}</strong>
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
              {items.map((item) => (
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
                    {fmt(item.startsAt)}
                    {item.subteamName ? ` · ${item.subteamName}` : " · Whole team"}
                  </b>
                </li>
              ))}
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
}
