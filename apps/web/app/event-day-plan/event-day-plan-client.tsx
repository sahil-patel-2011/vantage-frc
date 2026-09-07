"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
  type BadgeTone,
} from "../../components/ui";
import { eventDayPlanKindLabel, eventDayPlanStatusLabel, EVENT_DAY_PLAN_KINDS } from "../../lib/event-day-plan";
import type { EventDayPlanView } from "../../lib/event-day-plan/compute-event-day-plan";
import type { EventDayPlanKind, EventDayPlanStatus } from "../../lib/event-day-plan/types";
import {
  EVENT_DAY_PLAN_RELATED_INCLUDE,
  classifyEventDayPlanShell,
  eventDayPlanNextActions,
  eventDayPlanRelatedLinks,
  eventDayPlanSetupSteps,
  eventDayPlanShellCopy,
  formatEventDayPlanMetric,
  shouldShowEventDayPlanSummaryTiles,
  type EventDayPlanNextAction,
  type EventDayPlanShellKind,
} from "../../lib/event-day-plan/event-day-plan-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./event-day-plan.css";

type LiveView = Extract<EventDayPlanView, { status: "live" }>;

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTimeRange(startAt: string, endAt: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${fmt(startAt)} – ${fmt(endAt)}`;
}

function hourLabel(hour: number): string {
  const dt = new Date();
  dt.setHours(hour, 0, 0, 0);
  return dt.toLocaleTimeString(undefined, { hour: "numeric" });
}

function statusTone(status: EventDayPlanStatus): BadgeTone {
  if (status === "done") return "good";
  if (status === "cancelled") return "neutral";
  if (status === "in_progress") return "setup";
  return "info";
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = eventDayPlanRelatedLinks(orgId, {
    include: [...EVENT_DAY_PLAN_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related edp-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: EventDayPlanNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions edp-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Command, Batteries, and Pit — never DEMO schedule blocks.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlanShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: EventDayPlanShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = eventDayPlanNextActions({ orgId, shell });
  const copy = eventDayPlanShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "event-day-plan", orgId);
  const steps = shell === "setup" ? eventDayPlanSetupSteps(orgId) : [];

  return (
    <main className="module-page edp-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Event-Day Plan"}
          </>
        }
        title="Event-Day Stress Planner"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading event-day plan">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href="#event-day-plan-add">
                Add the first block
              </a>
              <a className="app-button secondary" href={hubHref("/competition", "command", orgId)}>
                Open Command
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="edp-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Command and Batteries — never DEMO schedule blocks.</p>
          </header>
          <ul className="edp-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted edp-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <NextActionsPanel actions={actions} />
    </main>
  );
}

export default function EventDayPlanClient() {
  const [view, setView] = useState<EventDayPlanView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const load = useCallback((overrides?: { planDate?: string; eventKey?: string }) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    const nextDate = overrides?.planDate ?? planDate;
    const nextEvent = overrides?.eventKey ?? eventKey;
    if (nextDate) query.set("planDate", nextDate);
    if (nextEvent) query.set("eventKey", nextEvent);
    void fetch(`/api/event-day-plan${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as EventDayPlanView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setPlanDate(data.planDate);
        if (data.status === "live") setEventKey(data.eventKey);
      })
      .catch(() => setFetchFailed(true));
     
  }, [planDate, eventKey]);

  useEffect(() => {
    load();
     
  }, []);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const blockCount = view?.status === "live" ? view.blocks.length : 0;
  const conflictCount = view?.status === "live" ? view.conflicts.length : 0;

  const shell = classifyEventDayPlanShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    blockCount,
  });
  const shellCopy = eventDayPlanShellCopy(shell);
  const nextActions = eventDayPlanNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    blockCount,
    conflictCount,
  });
  const relatedLinks = eventDayPlanRelatedLinks(orgId, {
    include: [...EVENT_DAY_PLAN_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "event-day-plan", orgId);
  const showTiles = shouldShowEventDayPlanSummaryTiles(blockCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/event-day-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            planDate: planDate ?? undefined,
            eventKey: eventKey ?? undefined,
            ...payload,
          }),
        });
        const data = (await response.json()) as EventDayPlanView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setPlanDate(data.planDate);
        if (data.status === "live") setEventKey(data.eventKey);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, planDate, eventKey],
  );

  if (shell === "loading") {
    return <PlanShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <PlanShell
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
      <PlanShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </PlanShell>
    );
  }

  if (view?.status !== "live") {
    return <PlanShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page edp-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Event-Day Plan"}
          </>
        }
        title="Event-Day Stress Planner"
        description="A per-hour overlay of qual matches, battery charges, scout shifts, pit-repair windows, and logistics — with automatic conflict alerts. Never DEMO schedule blocks. Cross-check Command, Battery Rotation, and Pit Repair."
      >
        <div className="edp-header-actions">
          <label className="app-muted edp-filter">
            Event
            <select
              value={eventKey ?? view.eventKey}
              onChange={(event) => {
                setEventKey(event.target.value);
                load({ eventKey: event.target.value });
              }}
            >
              {view.eventKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="app-muted edp-filter">
            Date
            <input
              type="date"
              value={planDate ?? view.planDate}
              onChange={(event) => {
                setPlanDate(event.target.value);
                load({ planDate: event.target.value });
              }}
            />
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

      <NextActionsPanel actions={nextActions} />

      {showTiles ? (
        <section className="edp-stats" aria-label="Event-day plan counts">
          <StatTile
            label="Blocks"
            value={formatEventDayPlanMetric(view.summary.totalBlocks, true)}
          />
          <StatTile
            label="Conflicts"
            value={formatEventDayPlanMetric(view.summary.conflictCount, true)}
          />
          <StatTile
            label="Unassigned"
            value={formatEventDayPlanMetric(view.summary.unassignedCount, true)}
          />
          {view.summary.byKind.map((row) => (
            <StatTile
              key={row.kind}
              label={eventDayPlanKindLabel(row.kind)}
              value={formatEventDayPlanMetric(row.count, true)}
            />
          ))}
        </section>
      ) : null}

      <ConflictBanner view={view} />
      <div id="event-day-plan-add">
        <AddBlockForm busy={busy} mutate={mutate} planDate={view.planDate} defaultEventKey={view.eventKey} />
      </div>
      <HourlyOverlay view={view} busy={busy} mutate={mutate} />
    </main>
  );
}

function ConflictBanner({ view }: { view: LiveView }) {
  if (view.conflicts.length === 0) return null;
  return (
    <Panel id="event-day-plan-conflicts" className="edp-panel" aria-label="Schedule conflicts">
      <Badge tone="demo">Conflicts</Badge>
      <h2 style={{ margin: "6px 0 0" }}>
        {formatEventDayPlanMetric(view.conflicts.length, true)} scheduling conflict(s)
      </h2>
      <ul className="edp-conflict-list">
        {view.conflicts.map((conflict) => (
          <li key={conflict.id}>{conflict.detail}</li>
        ))}
      </ul>
    </Panel>
  );
}

function HourlyOverlay({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.blocks.length === 0) {
    return (
      <EmptyState
        soft
        badge="No blocks yet"
        badgeTone="setup"
        title="Add your first event-day block"
        description="Qual matches, battery charges, scout shifts, pit-repair windows, and logistics all overlay on one hourly plan — never DEMO schedule packs."
      >
        <a className="app-button" href="#event-day-plan-add">
          Add block
        </a>
      </EmptyState>
    );
  }
  return (
    <Panel id="event-day-plan-hourly" className="edp-panel">
      <h2 style={{ marginTop: 0 }}>Hourly overlay</h2>
      <div className="edp-hourly">
        {view.hourly.map((slot) => (
          <div key={slot.hour} className="edp-hour-row">
            <strong className="app-muted">{hourLabel(slot.hour)}</strong>
            <ul className="edp-block-list">
              {slot.blocks.map((block) => (
                <li key={`${slot.hour}-${block.id}`} className="edp-block-row">
                  <div>
                    <Badge tone={statusTone(block.status)} icon={null}>
                      {eventDayPlanKindLabel(block.kind)}
                    </Badge>
                    <strong className="edp-block-title">{block.title}</strong>
                    <small className="app-muted">
                      {formatTimeRange(block.startAt, block.endAt)}
                      {block.assignedTo ? ` · ${block.assignedTo}` : ""}
                      {block.location ? ` · ${block.location}` : ""} · {eventDayPlanStatusLabel(block.status)}
                    </small>
                  </div>
                  <div className="edp-block-actions">
                    {block.status !== "done" && block.status !== "cancelled" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => mutate({ action: "update-status", blockId: block.id, status: "done" })}
                      >
                        Mark done
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete "${block.title}"?`)) {
                          mutate({ action: "delete-block", blockId: block.id });
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddBlockForm({
  busy,
  mutate,
  planDate,
  defaultEventKey,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  planDate: string;
  defaultEventKey: string;
}) {
  const defaultStart = useMemo(() => toLocalInputValue(`${planDate}T09:00:00`), [planDate]);
  const defaultEnd = useMemo(() => toLocalInputValue(`${planDate}T10:00:00`), [planDate]);
  const empty = useMemo(
    () => ({
      eventKey: defaultEventKey,
      title: "",
      kind: "scout_shift" as EventDayPlanKind,
      startAt: defaultStart,
      endAt: defaultEnd,
      assignedTo: "",
      location: "",
      notes: "",
    }),
    [defaultEventKey, defaultStart, defaultEnd],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      className="edp-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.eventKey.trim() || !form.title.trim() || !form.startAt || !form.endAt) return;
        mutate({
          action: "add-block",
          eventKey: form.eventKey.trim(),
          title: form.title,
          kind: form.kind,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          assignedTo: form.assignedTo || undefined,
          location: form.location || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Add block</h2>
      <FormGrid min={160}>
        <FormRow label="Event key">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026casj" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Battery bank 2 charging" required />
        </FormRow>
        <FormRow label="Kind">
          <select value={form.kind} onChange={set("kind")}>
            {EVENT_DAY_PLAN_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {eventDayPlanKindLabel(kind)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Start">
          <input type="datetime-local" value={form.startAt} onChange={set("startAt")} required />
        </FormRow>
        <FormRow label="End">
          <input type="datetime-local" value={form.endAt} onChange={set("endAt")} required />
        </FormRow>
        <FormRow label="Assigned to (optional)">
          <input value={form.assignedTo} onChange={set("assignedTo")} placeholder="Jamie" />
        </FormRow>
        <FormRow label="Location (optional)">
          <input value={form.location} onChange={set("location")} placeholder="Pit 12" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !form.eventKey.trim() || !form.title.trim() || !form.startAt || !form.endAt}
        >
          Add block
        </Button>
      </div>
    </Panel>
  );
}
