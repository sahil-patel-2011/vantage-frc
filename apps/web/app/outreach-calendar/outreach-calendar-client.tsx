"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { outreachAudienceLabel, outreachCategoryLabel, outreachStatusLabel } from "../../lib/outreach-calendar";
import type { OutreachCalendarView } from "../../lib/outreach-calendar/compute-outreach-calendar";
import type { OutreachAudience, OutreachCategory, OutreachStatus } from "../../lib/outreach-calendar/types";

const OUTREACH_CATEGORIES: OutreachCategory[] = [
  "stem_demo",
  "mentoring",
  "community_event",
  "fundraising",
  "media",
  "other",
];
const OUTREACH_AUDIENCES: OutreachAudience[] = [
  "k12",
  "college",
  "public",
  "industry",
  "other_teams",
  "internal",
  "other",
];
const OUTREACH_STATUSES: OutreachStatus[] = ["planned", "confirmed", "completed", "canceled"];

function statusTone(status: OutreachStatus): string {
  if (status === "completed") return "good";
  if (status === "confirmed") return "setup";
  if (status === "canceled") return "demo";
  return "setup";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<OutreachCalendarView, { status: "live" }>;

export default function OutreachCalendarClient() {
  const [view, setView] = useState<OutreachCalendarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/outreach-calendar${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as OutreachCalendarView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/outreach-calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as OutreachCalendarView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Outreach Calendar"}
          </>
        }
        title="Outreach Calendar"
        description="Plan outreach events ahead of time and track their projected hours and reach. Projections use only what you schedule."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" && view.seasons.length > 0 ? (
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
          {orgId ? (
            <a className="app-button secondary" href={`/impact?orgId=${encodeURIComponent(orgId)}`}>
              Community Impact log
            </a>
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
          title="Could not load the Outreach Calendar"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
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
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryPanel view={view} />
          <ScheduleEventForm busy={busy} mutate={mutate} />
          {view.summary.totalEvents > 0 ? <Breakdowns view={view} /> : null}
          <UpcomingEvents view={view} />
          <AllEvents view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Planned events", value: String(summary.totalEvents) },
    { label: "Projected hours", value: String(summary.totalProjectedHours) },
    { label: "Projected reach", value: summary.totalProjectedPeopleReached.toLocaleString() },
    { label: "Completed hours", value: String(summary.completedProjectedHours) },
    { label: "Projected impact", value: pct(summary.projectedImpactScore) },
  ];
  return (
    <Panel aria-label="Outreach plan summary">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      <small className="app-muted">
        {summary.plannedEvents} planned · {summary.confirmedEvents} confirmed · {summary.completedEvents} completed ·{" "}
        {summary.canceledEvents} canceled
      </small>
    </Panel>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byCategory.map((row) => (
            <li key={row.category} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{outreachCategoryLabel(row.category)}</span>
              <small className="app-muted">
                {row.events} · {row.projectedHours}h · {row.projectedPeopleReached.toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By month</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byMonth.map((row) => (
            <li key={row.month} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.month}</span>
              <small className="app-muted">
                {row.events} · {row.projectedHours}h · {row.projectedPeopleReached.toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function UpcomingEvents({ view }: { view: LiveView }) {
  if (view.upcoming.length === 0) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Upcoming</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.upcoming.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.scheduledOn} · {outreachCategoryLabel(item.category)} · {outreachAudienceLabel(item.audience)}
                {item.location ? ` · ${item.location}` : ""}
              </small>
              <small className="app-muted">
                {item.projectedHours}h projected · {item.projectedPeopleReached.toLocaleString()} projected reach
              </small>
            </div>
            <span className={`app-badge ${statusTone(item.status)}`}>{outreachStatusLabel(item.status)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AllEvents({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.events.length === 0) {
    return (
      <EmptyState
        badge="No events yet"
        badgeTone="setup"
        title="Schedule your first outreach event"
        description="Plan STEM demos, mentoring sessions, and community events ahead of time with a projected hours and reach estimate."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>All events</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.events.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.scheduledOn} · {outreachCategoryLabel(item.category)} · {outreachAudienceLabel(item.audience)}
                {item.location ? ` · ${item.location}` : ""}
              </small>
              <small className="app-muted">
                {item.projectedHours}h projected · {item.projectedPeopleReached.toLocaleString()} projected reach
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={item.status}
                disabled={busy}
                onChange={(event) =>
                  mutate({ action: "update-status", eventId: item.id, status: event.target.value })
                }
              >
                {OUTREACH_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {outreachStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${item.title}"?`)) {
                    mutate({ action: "delete-event", eventId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ScheduleEventForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      scheduledOn: "",
      category: "stem_demo" as OutreachCategory,
      audience: "k12" as OutreachAudience,
      status: "planned" as OutreachStatus,
      projectedHours: "",
      projectedPeopleReached: "",
      location: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.scheduledOn) return;
        mutate({
          action: "create-event",
          title: form.title,
          scheduledOn: form.scheduledOn,
          category: form.category,
          audience: form.audience,
          status: form.status,
          projectedHours: Number(form.projectedHours) || 0,
          projectedPeopleReached: Number(form.projectedPeopleReached) || 0,
          location: form.location || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Schedule event</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Elementary STEM night" required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.scheduledOn} onChange={set("scheduledOn")} required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {OUTREACH_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {outreachCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Audience">
          <select value={form.audience} onChange={set("audience")}>
            {OUTREACH_AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {outreachAudienceLabel(audience)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {OUTREACH_STATUSES.map((status) => (
              <option key={status} value={status}>
                {outreachStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Projected hours">
          <input type="number" min={0} step="0.5" value={form.projectedHours} onChange={set("projectedHours")} />
        </FormRow>
        <FormRow label="Projected people reached">
          <input type="number" min={0} value={form.projectedPeopleReached} onChange={set("projectedPeopleReached")} />
        </FormRow>
        <FormRow label="Location (optional)">
          <input value={form.location} onChange={set("location")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.scheduledOn}>
          Schedule event
        </button>
      </div>
    </Panel>
  );
}
