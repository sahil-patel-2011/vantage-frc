"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  StatRowSkeleton,
  StatTile,
  TableSkeleton,
  type BadgeTone, Button } from "../../components/ui";
import { busFactorAreaLabel } from "../../lib/bus-factor";
import { BUS_FACTOR_AREAS, DEFAULT_WINDOW_WEEKS, type BusFactorView } from "../../lib/bus-factor/compute-bus-factor";
import {
  BUS_FACTOR_RELATED_INCLUDE,
  busFactorNextActions,
  busFactorRelatedLinks,
  busFactorSetupSteps,
  busFactorShellCopy,
  classifyBusFactorShell,
  formatBusFactorMetric,
  formatBusFactorPercent,
  shouldShowBusFactorSummaryTiles,
  type BusFactorNextAction,
  type BusFactorShellKind,
} from "../../lib/bus-factor/bus-factor-related";
import type { BusFactorArea, RiskLevel } from "../../lib/bus-factor/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./bus-factor.css";

function riskTone(level: RiskLevel): BadgeTone {
  if (level === "high") return "danger";
  if (level === "watch") return "setup";
  return "good";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<BusFactorView, { status: "live" }>;

function isBusFactorView(value: unknown): value is BusFactorView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function busFactorCacheOrg(data: BusFactorView, orgHint: string): string {
  switch (data.status) {
    case "live":
      return data.orgId.trim() || orgHint;
    case "setup_required":
      return data.orgId?.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistBusFactorSnapshot(orgHint: string, data: BusFactorView): Promise<void> {
  const cacheOrg = busFactorCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("bus-factor", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("bus-factor", "_", data);
  } catch {
    // Live Bus factor already painted; IndexedDB is best-effort.
  }
}

function BusFactorRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = busFactorRelatedLinks(orgId, {
    include: [...BUS_FACTOR_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related bus-factor-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function BusFactorNextActionsPanel({ actions }: { actions: BusFactorNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions bus-factor-next-actions"
      aria-label="Next actions"
    >
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

function BusFactorShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  fromCache = false,
  cachedAt = null,
}: {
  description: string;
  orgId?: string | null;
  shell: BusFactorShellKind;
  error?: string;
  onRetry?: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
}) {
  const actions = busFactorNextActions({ orgId, shell });
  const copy = busFactorShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "bus-factor", orgId);
  const setup = shell === "setup" ? busFactorSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page bus-factor-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Bus factor"}
          </>
        }
        title="Bus factor"
        description={description}
      >
        <BusFactorRelatedStrip orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="Bus factor" fromCache={fromCache} cachedAt={cachedAt} />
      {shell === "loading" ? (
        <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading bus-factor">
          <StatRowSkeleton count={5} />
          <TableSkeleton rows={4} cols={3} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : shell === "empty" ? "No entries yet" : copy.badge}
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
            <Button as="a" variant="primary" href="#bus-factor-log">Log a workload entry</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <BusFactorNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function BusFactorClient() {
  const [view, setView] = useState<BusFactorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [windowWeeks, setWindowWeeks] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<BusFactorView | null>(null);
  viewRef.current = view;

  const load = useCallback((weeksOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const orgHint = params.get("orgId")?.trim() ?? "";
      const weeksQuery = weeksOverride ?? (params.get("weeks") ? Number(params.get("weeks")) : null);
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<BusFactorView>("bus-factor", orgHint || "_");
        if (!viewRef.current && cached?.data && isBusFactorView(cached.data)) {
          setView(cached.data);
          setWindowWeeks(cached.data.windowWeeks);
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
      if (orgHint) query.set("orgId", orgHint);
      if (weeksQuery) query.set("weeks", String(weeksQuery));
      try {
        const response = await fetch(`/api/bus-factor${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          return;
        }
        if (!response.ok || !isBusFactorView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Bus factor. Showing the last copy on this device.");
            setFetchFailed(false);
            return;
          }
          setFetchFailed(true);
          return;
        }
        setView(data);
        setWindowWeeks(data.windowWeeks);
        setFromCache(false);
        setCachedAt(null);
        await persistBusFactorSnapshot(orgHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Bus factor. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const entryCount = view?.status === "live" ? view.entries.length : 0;
  const flagCount = view?.status === "live" ? view.summary.flags.length : 0;

  const shell = classifyBusFactorShell({
    loading: view == null && !fetchFailed,
    fetchFailed: fetchFailed && view == null,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    entryCount,
  });
  const shellCopy = busFactorShellCopy(shell);
  const nextActions = busFactorNextActions({
    orgId,
    shell,
    entryCount,
    flagCount,
  });
  const relatedLinks = busFactorRelatedLinks(orgId, {
    include: [...BUS_FACTOR_RELATED_INCLUDE],
  });
  const teamHref = hubWorkbenchHref("team", "bus-factor", orgId);
  const showTiles = shouldShowBusFactorSummaryTiles(entryCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/bus-factor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, windowWeeks: windowWeeks ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isBusFactorView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setWindowWeeks(data.windowWeeks);
        setFromCache(false);
        void persistBusFactorSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, windowWeeks, busy],
  );

  if (shell === "loading") {
    return (
      <BusFactorShell
        description={shellCopy.description}
        orgId={null}
        shell="loading"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (shell === "error") {
    return (
      <BusFactorShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (shell === "setup") {
    return (
      <BusFactorShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (view?.status !== "live") {
    return (
      <BusFactorShell
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  return (
    <main className="module-page bus-factor-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Bus factor"}
          </>
        }
        title="Bus factor"
        description="Early-warning for single-point-of-human-failure and overload risk from logged hours and task concentration only. Cross-check Attendance, My Hours, and Task board."
      >
        <div className="bus-factor-header-actions">
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Window
            <select
              value={windowWeeks ?? view.windowWeeks ?? DEFAULT_WINDOW_WEEKS}
              onChange={(event) => {
                const next = Number(event.target.value);
                setWindowWeeks(next);
                load(next);
              }}
            >
              {[4, 6, 8, 12].map((weeks) => (
                <option key={weeks} value={weeks}>
                  {weeks} weeks
                </option>
              ))}
            </select>
          </label>
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Bus factor" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {shell === "ready" ? <BusFactorNextActionsPanel actions={nextActions} /> : null}

      {showTiles ? <SummaryTiles view={view} /> : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No entries yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <Button as="a" variant="primary" href="#bus-factor-log">
            Log a workload entry
          </Button>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {entryCount > 0 ? <RiskPanel view={view} /> : null}
        <LogEntryForm view={view} busy={busy} mutate={mutate} />
        {view.summary.areaConcentration.length > 0 ? <ConcentrationBreakdown view={view} /> : null}
        {view.entries.length > 0 ? <RecentEntries view={view} busy={busy} mutate={mutate} /> : null}
      </div>
    </main>
  );
}

function RiskPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <Panel id="bus-factor-risk" className="bus-factor-panel" aria-label="Bus-factor risk">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <Badge tone={riskTone(summary.riskLevel)}>{summary.riskLevel.toUpperCase()}</Badge>
          <h2 style={{ margin: "6px 0 0" }}>Organizational risk signal</h2>
          <small className="app-muted">
            {formatBusFactorMetric(summary.activeMembers, true)} active member(s) logged over the last{" "}
            {view.windowWeeks} week(s).
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{formatBusFactorPercent(summary.riskScore, true)}</strong>
      </header>
      {summary.flags.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Flags</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {summary.flags.slice(0, 10).map((flag) => (
              <li key={flag.id}>
                <span style={{ marginRight: 6 }}>
                  <Badge tone={riskTone(flag.level)}>{flag.level}</Badge>
                </span>
                {flag.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : summary.activeMembers > 0 ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          No concentration, overload, or sole-knowledge risks detected in this window.
        </p>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <Panel className="bus-factor-panel" aria-label="Bus-factor counts">
      <div className="bus-factor-stats">
        <StatTile label="Weeks covered" value={formatBusFactorMetric(summary.weeksCovered, true)} />
        <StatTile label="Active members" value={formatBusFactorMetric(summary.activeMembers, true)} />
        <StatTile label="Total hours" value={formatBusFactorMetric(summary.totalHours, true)} />
        <StatTile
          label="Mean hrs/member/wk"
          value={formatBusFactorMetric(summary.meanWeeklyHoursPerMember, true)}
        />
        <StatTile
          label="Areas tracked"
          value={formatBusFactorMetric(summary.areaConcentration.length, true)}
        />
      </div>
    </Panel>
  );
}

function ConcentrationBreakdown({ view }: { view: LiveView }) {
  const { summary } = view;
  const actualByUser = useMemo(
    () => new Map(view.actualBuildHours.map((row) => [row.userId, row.hours])),
    [view.actualBuildHours],
  );
  return (
    <section
      className="app-card soft-panel bus-factor-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By area</h2>
        <ul className="bus-factor-list">
          {summary.areaConcentration.map((row) => (
            <li key={row.area} className="bus-factor-row">
              <span>{busFactorAreaLabel(row.area)}</span>
              <small className="app-muted">
                {row.contributors} contributor(s) · {row.totalHours}h · top {pct(row.topContributorShare)}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By member</h2>
        <ul className="bus-factor-list">
          {summary.memberWorkloads.map((row) => {
            const actual = actualByUser.get(row.memberUserId);
            return (
              <li key={row.memberUserId} className="bus-factor-row">
                <span>{row.memberName}</span>
                <small className="app-muted">
                  {row.totalHours}h · {row.totalTasksOwned} task(s) · {row.overloadRatio}x avg
                  {actual != null ? ` · ${actual}h clocked` : ""}
                </small>
              </li>
            );
          })}
        </ul>
        {view.actualBuildHours.length > 0 ? (
          <small className="app-muted" style={{ display: "block", marginTop: 6 }}>
            &quot;Clocked&quot; hours are actual Build Hours over the same window.
          </small>
        ) : null}
      </div>
    </section>
  );
}

function RecentEntries({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel className="bus-factor-panel">
      <h2 style={{ marginTop: 0 }}>Logged entries</h2>
      <ul className="bus-factor-list">
        {view.entries.slice(0, 30).map((item) => (
          <li key={item.id} className="bus-factor-row">
            <div>
              <strong>{item.memberName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.weekStart} · {busFactorAreaLabel(item.area)}
              </small>
              <small className="app-muted">
                {item.hoursLogged}h · {item.tasksOwned} task(s) owned
                {item.soleKnowledgeCount > 0 ? ` · ${item.soleKnowledgeCount} sole-knowledge task(s)` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete this entry for ${item.memberName}?`)) {
                  mutate({ action: "delete-entry", entryId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogEntryForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      memberUserId: view.members[0]?.userId ?? "",
      area: "mechanical" as BusFactorArea,
      weekStart: "",
      hoursLogged: "",
      tasksOwned: "",
      soleKnowledgeCount: "",
    }),
    [view.members],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (view.members.length === 0) {
    return (
      <EmptyState
        soft
        badge="No members"
        badgeTone="setup"
        title="Invite teammates before logging workload"
        description="Bus factor needs org members to attribute hours."
      >
        <Button as="a" variant="primary" href={withOrgHref("/workspace", view.orgId)}>
          Choose your team
        </Button>
      </EmptyState>
    );
  }

  return (
    <Panel
      id="bus-factor-log"
      as="form"
      className="bus-factor-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.memberUserId || !form.weekStart) return;
        mutate({
          action: "log-entry",
          memberUserId: form.memberUserId,
          area: form.area,
          weekStart: form.weekStart,
          hoursLogged: Number(form.hoursLogged) || 0,
          tasksOwned: Number(form.tasksOwned) || 0,
          soleKnowledgeCount: Number(form.soleKnowledgeCount) || 0,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log weekly workload</h2>
      <FormGrid min={160}>
        <FormRow label="Member">
          <select value={form.memberUserId} onChange={set("memberUserId")} required>
            {view.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Area">
          <select value={form.area} onChange={set("area")}>
            {BUS_FACTOR_AREAS.map((area) => (
              <option key={area} value={area}>
                {busFactorAreaLabel(area)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Week starting">
          <input type="date" value={form.weekStart} onChange={set("weekStart")} required />
        </FormRow>
        <FormRow label="Hours logged">
          <input type="number" min={0} step="0.5" value={form.hoursLogged} onChange={set("hoursLogged")} />
        </FormRow>
        <FormRow label="Tasks owned">
          <input type="number" min={0} value={form.tasksOwned} onChange={set("tasksOwned")} />
        </FormRow>
        <FormRow label="Sole-knowledge tasks" hint="Tasks only this person knows how to do">
          <input type="number" min={0} value={form.soleKnowledgeCount} onChange={set("soleKnowledgeCount")} />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.memberUserId || !form.weekStart}>
          Log entry
        </Button>
      </div>
    </Panel>
  );
}
