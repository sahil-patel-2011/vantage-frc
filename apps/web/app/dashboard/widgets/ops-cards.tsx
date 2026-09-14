"use client";

import { useState, type ReactNode } from "react";
import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { parseYouTubeEmbed } from "../../../lib/youtube";
import { predictionWinDisplay } from "../../../lib/strategy/prediction-display";
import { studentRatingLabel } from "../../../lib/ui/student-rating-label";
import { LiveCountdown } from "./live-countdown";
import { emptyHintFor, WidgetShell as Shell } from "./widget-shell";
import { OnboardingChecklistCard } from "./onboarding-card";

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

function sourceLabel(source: string): string {
  switch (source.toLowerCase()) {
    case "tba":
      return "Official matches";
    case "statbotics":
      return "Season ratings";
    default:
      return source;
  }
}

/** Setup wall: one next step, never a laundry list of sibling CTAs. */
function setupQuickActions(orgId: string, tbaConfigured?: boolean) {
  if (!orgId) {
    return [{ href: "/invite", label: "Open invite", detail: "Use the link sent to your email." }];
  }
  if (tbaConfigured === false) {
    return [{ href: withOrgHref("/team/data", orgId), label: "Connect match results", detail: "Match times for this team." }];
  }
  return [
    { href: hubHref("/competition", "command", orgId), label: "Set active event", detail: "Competition cards need an event." },
  ];
}

export function renderOpsWidget({
  type,
  payload,
  orgId,
  tbaConfigured,
}: {
  type: string;
  payload?: WidgetPayload;
  orgId: string;
  tbaConfigured?: boolean;
}): ReactNode {
  const data = payload?.data ?? {};
  const withOrg = (href: string) => withOrgHref(href, orgId || null);
  const hint = emptyHintFor(type);

  switch (type) {
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
                  {alliance ? `${alliance} alliance` : "alliance not set"}
                </span>
              </div>
              <div className="mini-probability">
                <i style={{ width: `${win.percent}%` }} />
              </div>
              <ul className="dash-checklist">
                {factors.map((factor, index) => (
                  <li key={`${factor.name}-${index}`}>
                    <span>{factor.name ? studentRatingLabel(factor.name) : "Factor"}</span>
                    <b>{factor.impact ?? ""}</b>
                  </li>
                ))}
              </ul>
              <p className="app-muted">Showing the last stored result.</p>
            </>
          ) : payload?.status === "live" ? (
            <p className="app-muted">Last stored row is not a grounded prediction. Open Strategy to compute one.</p>
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
              <p>You are clear — disagreements and team alerts will show up here.</p>
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
                  {scope === "year" ? "this season" : `rank · ${String(data.record ?? "")}`}
                </span>
              </div>
              <div>
                <strong>{data.epaTotal != null ? Number(data.epaTotal).toFixed(1) : "—"}</strong>
                <span>season score{data.source ? ` · ${sourceLabel(String(data.source))}` : ""}</span>
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
                  <span>{sourceLabel(source.source)}</span>
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
                        style={{ background: item.subteamColor ?? "var(--accent, #0f766e)" }}
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
      return <OnboardingChecklistCard steps={steps} payload={payload} orgId={orgId} />;
    }
    default:
      return null;
  }
}
