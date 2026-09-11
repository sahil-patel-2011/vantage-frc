"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
  type BadgeTone, Button } from "../../components/ui";
import type { TeamHealthDashboardView } from "../../lib/team-health/compute-team-health";
import {
  TEAM_HEALTH_RELATED_INCLUDE,
  classifyTeamHealthShell,
  formatTeamHealthHours,
  formatTeamHealthMetric,
  formatTeamHealthRate,
  shouldShowTeamHealthSummaryTiles,
  teamHealthNextActions,
  teamHealthRelatedLinks,
  teamHealthSetupSteps,
  teamHealthShellCopy,
  type TeamHealthNextAction,
  type TeamHealthShellKind,
} from "../../lib/team-health/related";
import type { TeamHealthTier } from "../../lib/team-health/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./team-health-dashboard.css";

function isTeamHealthDashboardView(value: unknown): value is TeamHealthDashboardView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function teamHealthCacheOrg(data: TeamHealthDashboardView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistTeamHealthSnapshot(
  orgHint: string,
  seasonHint: string,
  data: TeamHealthDashboardView,
): Promise<void> {
  const cacheOrg = teamHealthCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("team-health-dashboard", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("team-health-dashboard", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Team Health already painted; IndexedDB is best-effort.
  }
}

function tierTone(tier: TeamHealthTier | null): BadgeTone {
  if (tier === "thriving") return "good";
  if (tier === "steady") return "setup";
  if (tier === "at_risk") return "demo";
  return "setup";
}


function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = teamHealthRelatedLinks(orgId, {
    include: [...TEAM_HEALTH_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related thd-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: TeamHealthNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions thd-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TeamHealthShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: TeamHealthShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = teamHealthNextActions({ orgId, shell });
  const copy = teamHealthShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "team-health-dashboard", orgId);
  const setup = shell === "setup" ? teamHealthSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page thd-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Team Health"}
          </>
        }
        title="Team Health"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading team health">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={hubHref("/team", "attendance", orgId)}>Open Attendance</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function TeamHealthDashboardClient() {
  const [view, setView] = useState<TeamHealthDashboardView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<TeamHealthDashboardView | null>(null);
  viewRef.current = view;

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<TeamHealthDashboardView>(
          "team-health-dashboard",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isTeamHealthDashboardView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(
          `/api/team-health-dashboard${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as TeamHealthDashboardView | { error?: string };
        if (!response.ok || !isTeamHealthDashboardView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Team Health. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistTeamHealthSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Team Health. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const hasLogs = view?.status === "live" ? view.summary.hasLogs : false;
  const checkInCount = view?.status === "live" ? view.summary.checkIns.length : 0;

  const shell = classifyTeamHealthShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    hasLogs,
  });
  const shellCopy = teamHealthShellCopy(shell);
  const nextActions = teamHealthNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    hasLogs,
    checkInCount,
  });
  const teamHref = hubWorkbenchHref("team", "team-health-dashboard", orgId);
  const showTiles = shouldShowTeamHealthSummaryTiles(hasLogs);
  const loaded = view?.status === "live";

  if (shell === "loading") {
    return (
      <TeamHealthShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Team Health" fromCache={fromCache} cachedAt={cachedAt} />
      </TeamHealthShell>
    );
  }
  if (shell === "error") {
    return (
      <TeamHealthShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Team Health" fromCache={fromCache} cachedAt={cachedAt} />
      </TeamHealthShell>
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <TeamHealthShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Team Health" fromCache={fromCache} cachedAt={cachedAt} />
      </TeamHealthShell>
    );
  }
  if (shell === "empty") {
    return (
      <TeamHealthShell description={shellCopy.description} orgId={orgId} shell="empty">
        <OfflineBanner feature="Team Health" fromCache={fromCache} cachedAt={cachedAt} />
        {view.seasons.length > 1 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </TeamHealthShell>
    );
  }

  const { summary, readiness } = view;
  const components = [
    { key: "attendance", label: "Attendance coverage", value: readiness.components.attendance },
    { key: "hours", label: "Hours participation", value: readiness.components.hours },
  ] as const;

  return (
    <main className="module-page thd-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Team Health"}
          </>
        }
        title="Team Health"
        description="Engagement from attendance roll call and shop-hour clock-ins only."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view.seasons.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                value={season ?? view.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeason(next);
                  load(next);
                }}
              >
                {view.seasons.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <RelatedStrip orgId={orgId} />
        </div>
      </PageHeader>

      <OfflineBanner feature="Team Health" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="thd-panel" aria-label="Team health signal">
          <header className="thd-header">
            <div>
              <Badge tone={tierTone(readiness.tier)}>
                {(readiness.tier ?? "empty").replace("_", " ").toUpperCase()}
              </Badge>
              <h2 style={{ margin: "6px 0 0" }}>Engagement from logs</h2>
              <small className="app-muted">
                {summary.entryCount} attendance {summary.entryCount === 1 ? "entry" : "entries"} ·{" "}
                {summary.hourSessionCount} closed hour {summary.hourSessionCount === 1 ? "session" : "sessions"}
              </small>
            </div>
            <strong style={{ fontSize: "2rem" }}>{formatTeamHealthRate(readiness.score, loaded)}</strong>
          </header>
          <ul className="thd-meter-list">
            {components.map((row) => (
              <li key={row.key} className="thd-meter-row">
                <span className="app-muted">{row.label}</span>
                <small className="app-muted">{formatTeamHealthRate(row.value, loaded)}</small>
              </li>
            ))}
          </ul>
          {readiness.recommendations.length > 0 ? (
            <div>
              <strong className="app-muted">Next steps</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {readiness.recommendations.map((rec) => (
                  <li key={rec}>{rec}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {showTiles ? (
        <Panel className="thd-panel">
          <div className="thd-stats">
            <StatTile label="Attendees" value={formatTeamHealthMetric(summary.uniqueAttendees, loaded)} />
            <StatTile label="Attendance hours" value={formatTeamHealthHours(summary.totalAttendanceHours, loaded)} />
            <StatTile label="Hour loggers" value={formatTeamHealthMetric(summary.uniqueHourLoggers, loaded)} />
            <StatTile label="Shop hours" value={formatTeamHealthHours(summary.totalShopHours, loaded)} />
          </div>
        </Panel>
      ) : null}

      {summary.checkIns.length > 0 ? (
        <Panel className="thd-panel" id="team-health-checkins" aria-label="Members without logs">
          <h2 style={{ margin: 0 }}>Members without logs</h2>
          <p className="app-muted">Roster members with no attendance or closed hours this season.</p>
          <ul className="thd-member-list">
            {summary.checkIns.map((member) => (
              <li key={member.key} className="thd-member-row">
                <strong>{member.name}</strong>
                <small className="app-muted">No attendance · no shop hours</small>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel className="thd-panel" id="team-health-members" aria-label="Logged members">
        <h2 style={{ margin: 0 }}>Logged members</h2>
        <ul className="thd-member-list">
          {summary.members
            .filter((member) => member.attendanceEvents > 0 || member.hourSessions > 0)
            .map((member) => (
              <li key={member.key} className="thd-member-row">
                <div>
                  <strong>{member.name}</strong>
                  <small className="app-muted thd-block">
                    {member.attendanceEvents} attendance {member.attendanceEvents === 1 ? "event" : "events"} ·{" "}
                    {formatTeamHealthHours(member.attendanceHours, loaded)}h credited
                  </small>
                </div>
                <small className="app-muted">
                  {member.hourSessions} {member.hourSessions === 1 ? "session" : "sessions"} ·{" "}
                  {formatTeamHealthHours(member.shopHours, loaded)}h shop
                </small>
              </li>
            ))}
        </ul>
      </Panel>

      {summary.trend.length > 0 ? (
        <section className="app-card soft-panel">
          <h2 style={{ marginTop: 0 }}>Trend by week</h2>
          <ul className="thd-trend-list">
            {summary.trend.map((point) => (
              <li key={point.weekStart} className="thd-trend-row">
                <span>Week of {point.weekStart}</span>
                <small className="app-muted">
                  {point.attendanceEvents} {point.attendanceEvents === 1 ? "event" : "events"} · {point.attendees}{" "}
                  attendees · {formatTeamHealthHours(point.shopHours, loaded)}h shop
                </small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.events.length > 0 ? (
        <Panel className="thd-panel" aria-label="Attendance events">
          <h2 style={{ margin: 0 }}>Attendance events</h2>
          <ul className="thd-event-list">
            {view.events.map((event) => (
              <li key={event.id} className="thd-event-row">
                <div>
                  <strong>{event.title}</strong>
                  <small className="app-muted thd-block">
                    {event.occurredOn} · {event.kind}
                  </small>
                </div>
                <small className="app-muted">
                  {event.entryCount} {event.entryCount === 1 ? "entry" : "entries"}
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <NextActionsPanel actions={nextActions} />
    </main>
  );
}
