"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { eventDayPlanKindLabel, eventDayPlanStatusLabel, EVENT_DAY_PLAN_KINDS } from "../../lib/event-day-plan";
import type { EventDayPlanView } from "../../lib/event-day-plan/compute-event-day-plan";
import type { EventDayPlanKind, EventDayPlanStatus } from "../../lib/event-day-plan/types";

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

function statusTone(status: EventDayPlanStatus): string {
  if (status === "done") return "good";
  if (status === "cancelled") return "demo";
  if (status === "in_progress") return "setup";
  return "";
}

export default function EventDayPlanClient() {
  const [view, setView] = useState<EventDayPlanView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planDate, setPlanDate] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDate, eventKey]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/event-day-plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, planDate: planDate ?? undefined, eventKey: eventKey ?? undefined, ...payload }),
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Event-Day Plan"}
          </>
        }
        title="Event-Day Stress Planner"
        description="A per-hour overlay of qual matches, battery charges, scout shifts, pit-repair windows, and logistics — with automatic conflict alerts."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" ? (
            <>
              <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
              <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
            </>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the event-day plan"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
            <ol className="strategy-setup-steps">
              {view.steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                  <a href={step.href}>Open</a>
                </li>
              ))}
            </ol>
          </EmptyState>
          {view.orgId ? (
            <AddBlockForm
              busy={busy}
              mutate={mutate}
              planDate={planDate ?? view.planDate}
              defaultEventKey=""
            />
          ) : null}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ConflictBanner view={view} />
          <SummaryTiles view={view} />
          <AddBlockForm busy={busy} mutate={mutate} planDate={view.planDate} defaultEventKey={view.eventKey} />
          <HourlyOverlay view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ConflictBanner({ view }: { view: LiveView }) {
  if (view.conflicts.length === 0) return null;
  return (
    <Panel aria-label="Schedule conflicts">
      <span className="app-badge demo">CONFLICTS</span>
      <h2 style={{ margin: "6px 0 0" }}>{view.conflicts.length} scheduling conflict(s)</h2>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
        {view.conflicts.map((conflict) => (
          <li key={conflict.id}>{conflict.detail}</li>
        ))}
      </ul>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Blocks", value: String(summary.totalBlocks) },
    { label: "Conflicts", value: String(summary.conflictCount) },
    { label: "Unassigned", value: String(summary.unassignedCount) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
        {summary.byKind.map((row) => (
          <div key={row.kind}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{row.count}</strong>
            <span className="app-muted">{eventDayPlanKindLabel(row.kind)}</span>
          </div>
        ))}
      </div>
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
        badge="No blocks yet"
        badgeTone="setup"
        title="Add your first event-day block"
        description="Qual matches, battery charges, scout shifts, pit-repair windows, and logistics all overlay on one hourly plan."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Hourly overlay</h2>
      <div style={{ display: "grid", gap: 12 }}>
        {view.hourly.map((slot) => (
          <div key={slot.hour} style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 10 }}>
            <strong className="app-muted">{hourLabel(slot.hour)}</strong>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {slot.blocks.map((block) => (
                <li
                  key={`${slot.hour}-${block.id}`}
                  style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
                >
                  <div>
                    <span className={`app-badge ${statusTone(block.status)}`}>
                      {eventDayPlanKindLabel(block.kind)}
                    </span>
                    <strong style={{ display: "block", marginTop: 2 }}>{block.title}</strong>
                    <small className="app-muted" style={{ display: "block" }}>
                      {formatTimeRange(block.startAt, block.endAt)}
                      {block.assignedTo ? ` · ${block.assignedTo}` : ""}
                      {block.location ? ` · ${block.location}` : ""} · {eventDayPlanStatusLabel(block.status)}
                    </small>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {block.status !== "done" && block.status !== "cancelled" ? (
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => mutate({ action: "update-status", blockId: block.id, status: "done" })}
                      >
                        Mark done
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete "${block.title}"?`)) {
                          mutate({ action: "delete-block", blockId: block.id });
                        }
                      }}
                    >
                      Delete
                    </button>
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
      style={{ display: "grid", gap: 10 }}
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
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.eventKey.trim() || !form.title.trim() || !form.startAt || !form.endAt}
        >
          Add block
        </button>
      </div>
    </Panel>
  );
}
