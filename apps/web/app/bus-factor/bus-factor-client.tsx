"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type BadgeTone,
} from "../../components/ui";
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

function BusFactorRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = busFactorRelatedLinks(orgId, {
    include: [...BUS_FACTOR_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related bus-factor-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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
}: {
  description: string;
  orgId?: string | null;
  shell: BusFactorShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const actions = busFactorNextActions({ orgId, shell });
  const copy = busFactorShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "bus-factor", orgId);
  const steps = shell === "setup" ? busFactorSetupSteps(orgId) : [];

  return (
    <main className="module-page bus-factor-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Bus-Factor & Burnout"}
          </>
        }
        title="Bus-Factor & Burnout Watch"
        description={description}
      >
        <BusFactorRelatedStrip orgId={orgId} />
      </PageHeader>
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
          badge={shell === "setup" ? "Setup required" : shell === "empty" ? "No entries yet" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button is-primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</a>
          ) : null}
          {shell === "empty" ? (
            <a className="app-button is-primary" href="#bus-factor-log">Log a workload entry</a>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="bus-factor-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="bus-factor-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted bus-factor-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <BusFactorNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function BusFactorClient() {
  const [view, setView] = useState<BusFactorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [windowWeeks, setWindowWeeks] = useState<number | null>(null);

  const load = useCallback((weeksOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const weeksQuery = weeksOverride ?? (params.get("weeks") ? Number(params.get("weeks")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (weeksQuery) query.set("weeks", String(weeksQuery));
    void fetch(`/api/bus-factor${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BusFactorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setWindowWeeks(data.windowWeeks);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const entryCount = view?.status === "live" ? view.entries.length : 0;
  const flagCount = view?.status === "live" ? view.summary.flags.length : 0;

  const shell = classifyBusFactorShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
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
        });
        const data = (await response.json()) as BusFactorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setWindowWeeks(data.windowWeeks);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, windowWeeks, busy],
  );

  if (shell === "loading") {
    return <BusFactorShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <BusFactorShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <BusFactorShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <BusFactorShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page bus-factor-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Bus-Factor & Burnout"}
          </>
        }
        title="Bus-Factor & Burnout Watch"
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
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <BusFactorNextActionsPanel actions={nextActions} />

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
          <a className="app-button is-primary" href="#bus-factor-log">
            Log a workload entry
          </a>
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
        description="Bus-Factor needs org members to attribute hours."
      >
        <a className="app-button" href={withOrgHref("/workspace", view.orgId)}>
          Choose your team
        </a>
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
        <button type="submit" className="app-button" disabled={busy || !form.memberUserId || !form.weekStart}>
          Log entry
        </button>
      </div>
    </Panel>
  );
}
