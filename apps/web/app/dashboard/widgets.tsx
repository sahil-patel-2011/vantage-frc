"use client";

import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { parseYouTubeEmbed } from "../../lib/youtube";

function StatusBadge({ status }: { status: WidgetPayload["status"] }) {
  if (status === "live") return <span className="app-badge good">Live</span>;
  if (status === "empty") return <span className="app-badge">No data</span>;
  return <span className="app-badge demo">Setup required</span>;
}

function Shell({
  title,
  payload,
  children,
  href,
}: {
  title: string;
  payload?: WidgetPayload;
  children: React.ReactNode;
  href?: string;
}) {
  return (
    <article className="dash-widget app-card">
      <header>
        <div>
          <h2>{title}</h2>
          {payload?.updatedAt && (
            <small className="dash-updated">Updated {new Date(payload.updatedAt).toLocaleTimeString()}</small>
          )}
        </div>
        {payload && <StatusBadge status={payload.status} />}
      </header>
      {payload?.status !== "live" && payload?.message ? <p className="app-muted dash-widget-msg">{payload.message}</p> : null}
      {children}
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

function countdownLabel(iso: string | null | undefined) {
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

export function DashboardWidgetView({
  type,
  payload,
  orgId,
}: {
  type: string;
  payload?: WidgetPayload;
  orgId: string;
}) {
  const data = payload?.data ?? {};
  const withOrg = (href: string) => (orgId ? `${href}${href.includes("?") ? "&" : "?"}orgId=${encodeURIComponent(orgId)}` : href);

  switch (type) {
    case "next_match": {
      const scheduled = data.scheduledTime as string | undefined;
      return (
        <Shell title="Next match" payload={payload} href={withOrg("/intel")}>
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
      return (
        <Shell title="Robot readiness" payload={payload} href={withOrg("/code")}>
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
        <Shell title="Recent result" payload={payload} href={withOrg("/intel")}>
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
        <Shell title="Prediction" payload={payload} href={withOrg("/strategy")}>
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
      return (
        <Shell title="Alerts" payload={payload} href={withOrg("/scouting")}>
          {payload?.status === "live" ? (
            <ul className="dash-checklist">
              <li>
                <span>Open scouting disagreements</span>
                <b>{String(data.openDisagreements ?? 0)}</b>
              </li>
              {items.length === 0 ? (
                <li className="done">
                  <span>No live alerts</span>
                  <b>Clear</b>
                </li>
              ) : (
                items.map((item) => (
                  <li key={item.id}>
                    <span>
                      {item.title}
                      <small className="dash-sub">{item.body}</small>
                    </span>
                    <b>{item.severity}</b>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "scouting_coverage":
      return (
        <Shell title="Scouting coverage" payload={payload} href={withOrg("/scouting")}>
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
        <Shell title="Competition snapshot" payload={payload} href={withOrg("/intel")}>
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
        <Shell title="Sync status" payload={payload} href={withOrg("/team")}>
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
        <Shell title={String(data.title ?? "Pit stream")} payload={payload} href={withOrg("/display")}>
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
      return (
        <Shell title="Notifications" payload={payload}>
          {payload?.status === "live" ? (
            <ul className="dash-checklist">
              <li>
                <span>Unread</span>
                <b>{String(data.unread ?? 0)}</b>
              </li>
              {items.length === 0 ? (
                <li className="done">
                  <span>Inbox clear</span>
                  <b>0</b>
                </li>
              ) : (
                items.slice(0, 4).map((item) => (
                  <li key={item.id} className={item.readAt ? "done" : undefined}>
                    <span>{item.type.replaceAll("_", " ")}</span>
                    <b>{item.readAt ? "Read" : "New"}</b>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "ai_usage":
      return (
        <Shell title="AI usage" payload={payload} href={withOrg("/team")}>
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
      const links =
        (data.links as Array<{ href: string; label: string; detail: string }> | undefined) ??
        [];
      return (
        <Shell title="Quick actions" payload={payload}>
          <div className="dash-actions">
            {links.map((link) => (
              <a key={link.href} href={withOrg(link.href)}>
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
        <Shell title={type.replaceAll("_", " ")} payload={payload}>
          <p className="app-muted">Unknown widget.</p>
        </Shell>
      );
  }
}
