"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import {
  outreachAudienceLabel,
  outreachCategoryLabel,
  outreachStatusLabel,
} from "../../lib/outreach-calendar";
import type { OutreachCalendarView } from "../../lib/outreach-calendar/compute-outreach-calendar";
import {
  OUTREACH_CALENDAR_RELATED_INCLUDE,
  classifyOutreachCalendarShell,
  formatOutreachCalendarMetric,
  outreachCalendarNextActions,
  outreachCalendarRelatedLinks,
  outreachCalendarSetupSteps,
  outreachCalendarShellCopy,
  shouldShowOutreachCalendarSummaryTiles,
  type OutreachCalendarNextAction,
  type OutreachCalendarShellKind,
} from "../../lib/outreach-calendar/outreach-calendar-related";
import type {
  OutreachAudience,
  OutreachCategory,
  OutreachStatus,
} from "../../lib/outreach-calendar/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./outreach-calendar.css";

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
  if (status === "canceled") return "setup";
  return "setup";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<OutreachCalendarView, { status: "live" }>;

function OutreachRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = outreachCalendarRelatedLinks(orgId, {
    include: [...OUTREACH_CALENDAR_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav
      className="product-hub-related outreach-calendar-related"
      aria-label="Related business tools"
    >
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function OutreachNextActionsPanel({ actions }: { actions: OutreachCalendarNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions outreach-calendar-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Community Impact and Media Kit — never DEMO reach metrics.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function OutreachShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: OutreachCalendarShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = outreachCalendarNextActions({ orgId, shell });
  const copy = outreachCalendarShellCopy(shell);
  const steps = shell === "setup" ? outreachCalendarSetupSteps(orgId) : [];

  return (
    <main className="module-page outreach-calendar-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? withOrgHref("/media", orgId) : "/media"}>Media</a>
            {" / Outreach Calendar"}
          </>
        }
        title="Outreach Calendar"
        description={description}
      >
        <OutreachRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No events yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href="#outreach-calendar-schedule">
              Schedule an event
            </a>
            <a className="app-button secondary" href={hubHref("/business", "impact", orgId)}>
              Open Community Impact
            </a>
            <a className="app-button secondary" href={hubHref("/business", "media-kit", orgId)}>
              Open Media Kit
            </a>
          </>
        ) : null}
      </EmptyState>
      {shell === "setup" && steps.length > 0 ? (
        <ol className="strategy-setup-steps">
          {steps.map((step) => (
            <li key={step.id}>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
            </li>
          ))}
        </ol>
      ) : null}
      <OutreachNextActionsPanel actions={actions} />
    </main>
  );
}

export default function OutreachCalendarClient() {
  const [view, setView] = useState<OutreachCalendarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery =
      seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const eventCount = view?.status === "live" ? view.summary.totalEvents : 0;

  const shell = classifyOutreachCalendarShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" || view?.status === "setup_required" ? view.orgId : null,
    eventCount,
  });
  const shellCopy = outreachCalendarShellCopy(shell);
  const nextActions = outreachCalendarNextActions({ orgId, shell, eventCount });
  const relatedLinks = outreachCalendarRelatedLinks(orgId, {
    include: [...OUTREACH_CALENDAR_RELATED_INCLUDE],
  });

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

  if (shell === "loading") {
    return <OutreachShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <OutreachShell
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
      <OutreachShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <OutreachShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page outreach-calendar-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/media", orgId)}>Media</a>
            {" / Outreach Calendar"}
          </>
        }
        title="Outreach Calendar"
        description="Plan outreach events ahead of time and track their projected hours and reach. Projections use only what you schedule — never DEMO reach metrics."
      >
        <div className="outreach-calendar-header-actions">
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

      <OutreachNextActionsPanel actions={nextActions} />

      {shouldShowOutreachCalendarSummaryTiles(eventCount) ? (
        <section className="outreach-calendar-stats" aria-label="Outreach plan summary">
          <div>
            <strong>{formatOutreachCalendarMetric(view.summary.totalEvents, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Planned events
            </span>
          </div>
          <div>
            <strong>{formatOutreachCalendarMetric(view.summary.totalProjectedHours, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Projected hours
            </span>
          </div>
          <div>
            <strong>
              {formatOutreachCalendarMetric(view.summary.totalProjectedPeopleReached, true)}
            </strong>
            <span className="app-muted" style={{ display: "block" }}>
              Projected reach
            </span>
          </div>
          <div>
            <strong>{pct(view.summary.projectedImpactScore)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Projected impact
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No events yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#outreach-calendar-schedule">
            Schedule an event
          </a>
          <a className="app-button secondary" href={hubHref("/business", "impact", orgId)}>
            Open Community Impact
          </a>
        </EmptyState>
      ) : null}

      <div className="outreach-calendar-layout">
        <ScheduleEventForm busy={busy} mutate={mutate} />
        {view.summary.totalEvents > 0 ? <Breakdowns view={view} /> : null}
        <UpcomingEvents view={view} />
        <AllEvents view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
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
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.scheduledOn} · {outreachCategoryLabel(item.category)} ·{" "}
                {outreachAudienceLabel(item.audience)}
                {item.location ? ` · ${item.location}` : ""}
              </small>
              <small className="app-muted">
                {item.projectedHours}h projected · {item.projectedPeopleReached.toLocaleString()}{" "}
                projected reach
              </small>
            </div>
            <span className={`app-badge ${statusTone(item.status)}`}>
              {outreachStatusLabel(item.status)}
            </span>
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
        soft
        badge="No events yet"
        badgeTone="setup"
        title="Schedule your first outreach event"
        description="Plan STEM demos, mentoring sessions, and community events with projected hours and reach — never invent DEMO metrics."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>All events</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.events.map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.scheduledOn} · {outreachCategoryLabel(item.category)} ·{" "}
                {outreachAudienceLabel(item.audience)}
                {item.location ? ` · ${item.location}` : ""}
              </small>
              <small className="app-muted">
                {item.projectedHours}h projected · {item.projectedPeopleReached.toLocaleString()}{" "}
                projected reach
              </small>
              {item.impactActivityId ? (
                <small style={{ display: "block", marginTop: 4 }}>
                  <span className="app-badge good">Logged to Impact</span>{" "}
                  <a href={hubHref("/business", "impact", view.orgId)}>open Community Impact</a>
                </small>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {!item.impactActivityId && item.status !== "canceled" ? (
                <button
                  type="button"
                  className="app-button secondary sm"
                  disabled={busy}
                  title="Marks the event completed and logs it as a Community Impact activity"
                  onClick={() => {
                    const reached = window.prompt(
                      `People actually reached at "${item.title}"? Leave blank to log the projected ${item.projectedPeopleReached}.`,
                      "",
                    );
                    if (reached === null) return;
                    mutate({
                      action: "complete",
                      eventId: item.id,
                      actualPeopleReached: reached.trim() === "" ? undefined : Number(reached),
                    });
                  }}
                >
                  {item.status === "completed" ? "Log to Impact" : "Complete & log to Impact"}
                </button>
              ) : null}
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
      id="outreach-calendar-schedule"
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
          <input
            value={form.title}
            onChange={set("title")}
            placeholder="Elementary STEM night"
            required
          />
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
          <input
            type="number"
            min={0}
            step="0.5"
            value={form.projectedHours}
            onChange={set("projectedHours")}
          />
        </FormRow>
        <FormRow label="Projected people reached">
          <input
            type="number"
            min={0}
            value={form.projectedPeopleReached}
            onChange={set("projectedPeopleReached")}
          />
        </FormRow>
        <FormRow label="Location (optional)">
          <input value={form.location} onChange={set("location")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.title.trim() || !form.scheduledOn}
        >
          Schedule event
        </button>
      </div>
    </Panel>
  );
}
