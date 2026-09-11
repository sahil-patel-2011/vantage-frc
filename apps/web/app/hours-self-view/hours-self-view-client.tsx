"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SectionHeading,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { hourLogKindLabel } from "../../lib/hours-self-view";
import type { HoursSelfViewView } from "../../lib/hours-self-view/compute-hours-self-view";
import {
  HOURS_SELF_VIEW_RELATED_INCLUDE,
  classifyHoursSelfViewShell,
  formatHoursSelfViewHours,
  formatHoursSelfViewMetric,
  hoursSelfViewNextActions,
  hoursSelfViewRelatedLinks,
  hoursSelfViewSetupSteps,
  hoursSelfViewShellCopy,
  shouldShowHoursSelfViewSummaryTiles,
  type HoursSelfViewNextAction,
  type HoursSelfViewShellKind,
} from "../../lib/hours-self-view/hours-self-view-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  QUEUED_ON_DEVICE,
  clearFeatureSnapshot,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
} from "../../lib/offline";
import "./hours-self-view.css";

type LiveView = Extract<HoursSelfViewView, { status: "live" }>;

function isHoursSelfViewView(value: unknown): value is HoursSelfViewView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistHoursSelfViewSnapshot(orgHint: string, data: HoursSelfViewView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("hours-self-view", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("hours-self-view", "_", data);
  } catch {
    // Live My Hours already painted; IndexedDB is best-effort.
  }
}

function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = hoursSelfViewRelatedLinks(orgId, {
    include: [...HOURS_SELF_VIEW_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related hsv-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: HoursSelfViewNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions hsv-next-actions" aria-label="Next actions">
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

function HoursShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: HoursSelfViewShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = hoursSelfViewNextActions({ orgId, shell });
  const copy = hoursSelfViewShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "hours-self-view", orgId);
  const setup = shell === "setup" ? hoursSelfViewSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page hsv-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / My Hours"}
          </>
        }
        title="My Hours"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading my hours">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function HoursSelfViewClient() {
  const [view, setView] = useState<HoursSelfViewView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<HoursSelfViewView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<HoursSelfViewView>("hours-self-view", urlOrg || "_");
        if (!viewRef.current && cached?.data && isHoursSelfViewView(cached.data)) {
          setView(cached.data);
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
      try {
        const response = await fetch(
          `/api/hours-self-view${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as HoursSelfViewView | { error?: string };
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          void clearFeatureSnapshot("hours-self-view", urlOrg || "_");
          if (urlOrg) void clearFeatureSnapshot("hours-self-view", urlOrg);
          return;
        }
        if (!response.ok || !isHoursSelfViewView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh My Hours. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistHoursSelfViewSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh My Hours. Showing the last copy on this device.");
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
  const entryCount = view?.status === "live" ? view.summary.totalEntries : 0;
  const kioskCount = view?.status === "live" ? view.kioskSessions.length : 0;

  const shell = classifyHoursSelfViewShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    entryCount,
  });
  const shellCopy = hoursSelfViewShellCopy(shell);
  const nextActions = hoursSelfViewNextActions({
    orgId,
    shell,
    entryCount,
    kioskCount,
  });
  const teamHref = hubWorkbenchHref("team", "hours-self-view", orgId);
  const showTiles = shouldShowHoursSelfViewSummaryTiles(entryCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      const action = typeof payload.action === "string" ? payload.action : "";
      if (isBrowserOffline() && (action === "clock_in" || action === "clock_out")) {
        await queueProductWrite({
          feature: "hours_clock",
          orgId,
          payload: { orgId, action, kind: payload.kind ?? "build" },
        });
        setError(QUEUED_ON_DEVICE);
        return;
      }
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/hours-self-view", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as HoursSelfViewView | { error?: string };
        if (!response.ok || !isHoursSelfViewView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistHoursSelfViewSnapshot(orgId, data);
      } catch {
        if (action === "clock_in" || action === "clock_out") {
          await queueProductWrite({
            feature: "hours_clock",
            orgId,
            payload: { orgId, action, kind: payload.kind ?? "build" },
          });
          setError(QUEUED_ON_DEVICE);
          return;
        }
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <HoursShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="My Hours" fromCache={fromCache} cachedAt={cachedAt} />
      </HoursShell>
    );
  }
  if (shell === "error") {
    return (
      <HoursShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="My Hours" fromCache={fromCache} cachedAt={cachedAt} />
      </HoursShell>
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <HoursShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="My Hours" fromCache={fromCache} cachedAt={cachedAt} />
      </HoursShell>
    );
  }

  if (shell === "empty") {
    return (
      <main className="module-page hsv-page soft-gate">
        <PageHeader
          breadcrumbs={
            <>
              <a href={teamHref}>Team</a>
              {" / My Hours"}
            </>
          }
          title="My Hours"
          description={shellCopy.description}
        >
          <RelatedStrip orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="My Hours" fromCache={fromCache} cachedAt={cachedAt} />
        {error ? (
          <p className="telemetry-status" role="alert">
            {error}
          </p>
        ) : null}
        <EmptyState
          soft
          badge={shellCopy.badge}
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button
            variant="primary"
            type="button"
            disabled={busy}
            onClick={() => void mutate({ action: "clock_in", kind: "build" })}
          >
            {busy ? "Clocking in…" : "Clock in"}
          </Button>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="module-page hsv-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / My Hours"}
          </>
        }
        title="My Hours"
        description="Your own logged shop, meeting, and outreach time — plus who’s in the shop right now from open clock-ins."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      <OfflineBanner feature="My Hours" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="hsv-panel">
          <div className="hsv-stats">
            <StatTile label="Total hours" value={formatHoursSelfViewHours(view.summary.totalHours, loaded)} />
            <StatTile label="Sessions" value={formatHoursSelfViewMetric(view.summary.totalEntries, loaded)} />
            <StatTile label="Status" value={view.summary.openEntry ? "Clocked in" : "Clocked out"} />
            {view.presentNow.length > 0 ? (
              <StatTile label="In the shop" value={formatHoursSelfViewMetric(view.presentNow.length, loaded)} />
            ) : null}
          </div>
          {view.summary.byKind.length > 0 ? (
            <ul className="hsv-kind-list">
              {view.summary.byKind.map((row) => (
                <li key={row.kind} className="hsv-kind-row">
                  <span>{hourLogKindLabel(row.kind)}</span>
                  <small className="app-muted">
                    {row.entries} session(s) · {row.hours}h
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      <Panel className="hsv-panel" id="hours-clock" aria-label="Clock in or out">
        {view.summary.openEntry ? (
          <Button
            variant="primary"
            type="button"
            disabled={busy}
            onClick={() => void mutate({ action: "clock_out" })}
          >
            {busy ? "Clocking out…" : "Clock out"}
          </Button>
        ) : (
          <Button
            variant="primary"
            type="button"
            disabled={busy}
            onClick={() => void mutate({ action: "clock_in", kind: "build" })}
          >
            {busy ? "Clocking in…" : "Clock in"}
          </Button>
        )}
      </Panel>

      <PresencePanel view={view} />
      <EntriesList view={view} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function PresencePanel({ view }: { view: LiveView }) {
  if (view.presentNow.length === 0) {
    return (
      <EmptyState
        soft
        badge="Shop floor"
        badgeTone="setup"
        title="Nobody clocked in"
        description="People who are in the shop show up here after they clock in."
      />
    );
  }
  return (
    <Panel id="hours-self-present" className="hsv-panel">
      <SectionHeading title="In the shop now" />
      <ul className="hsv-presence-list">
        {view.presentNow.map((person) => (
          <li key={person.userId} className="hsv-presence-row">
            <div>
              <strong>{person.displayName}</strong>
              <small className="app-muted hsv-block">
                {hourLogKindLabel(person.kind)} · since {fmtDateTime(person.clockIn)}
              </small>
            </div>
            <small className="app-muted">{fmtHours(person.minutesOpen)}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EntriesList({ view }: { view: LiveView }) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        soft
        badge="No hours yet"
        badgeTone="setup"
        title="No logged hours yet"
        description="Clock in on this page to start your record."
      />
    );
  }
  return (
    <Panel id="hours-self-entries" className="hsv-panel">
      <SectionHeading title="Recent sessions" />
      <ul className="hsv-entry-list">
        {view.entries.slice(0, 30).map((entry) => (
          <li key={entry.id} className="hsv-entry-row">
            <div>
              <strong>{hourLogKindLabel(entry.kind)}</strong>
              <small className="app-muted hsv-block">
                {fmtDateTime(entry.clockIn)}
                {entry.clockOut ? ` – ${fmtDateTime(entry.clockOut)}` : " · in progress"}
                {entry.note ? ` · ${entry.note}` : ""}
              </small>
            </div>
            <small className="app-muted">{entry.clockOut ? fmtHours(entry.minutes) : "—"}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
