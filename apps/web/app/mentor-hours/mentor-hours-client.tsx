"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { mentorHoursCategoryLabel, mentorHoursRoleLabel } from "../../lib/mentor-hours";
import {
  MENTOR_HOURS_CATEGORIES,
  MENTOR_HOURS_ROLES,
  type MentorHoursView,
} from "../../lib/mentor-hours/compute-mentor-hours";
import type { MentorHoursCategory, MentorHoursRole, MentorHoursTier } from "../../lib/mentor-hours/types";

const COMPONENT_LABEL: Record<string, string> = {
  volume: "Hours volume",
  cadence: "Season cadence",
  mentorBreadth: "Mentor bench",
  roleBreadth: "Role diversity",
};

function tierTone(tier: MentorHoursTier): string {
  if (tier === "strong") return "good";
  if (tier === "developing") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MentorHoursView, { status: "live" }>;

export default function MentorHoursClient() {
  const [view, setView] = useState<MentorHoursView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/mentor-hours${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MentorHoursView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
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
        const response = await fetch("/api/mentor-hours", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as MentorHoursView | { error?: string };
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
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Mentor Hours"}
          </>
        }
        title="Mentor Hours & Engagement"
        description="Log mentor time by role and activity — the evidence trail for grant reporting. Engagement readiness uses only what you record."
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
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
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <EngagementPanel view={view} />
          <SummaryTiles view={view} />
          <LogEntryForm busy={busy} mutate={mutate} />
          {view.summary.totalEntries > 0 ? <Breakdowns view={view} /> : null}
          <RecentEntries view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function EngagementPanel({ view }: { view: LiveView }) {
  const { engagement } = view;
  const components = Object.entries(engagement.components) as Array<[string, number]>;
  return (
    <Panel aria-label="Mentor engagement readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(engagement.tier)}`}>{engagement.tier.toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Grant-report engagement readiness</h2>
          <small className="app-muted">
            Active in {engagement.monthsActive} month(s) · {engagement.mentorsEngaged} mentor(s) engaged
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(engagement.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
      {engagement.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {engagement.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Entries", value: String(summary.totalEntries) },
    { label: "Hours", value: String(summary.totalHours) },
    { label: "Mentors engaged", value: String(summary.uniqueMentors) },
    { label: "Engagement signal", value: pct(summary.engagementSignal) },
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
      </div>
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
              <span>{mentorHoursCategoryLabel(row.category)}</span>
              <small className="app-muted">
                {row.entries} · {row.hours}h
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By role</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byRole.map((row) => (
            <li key={row.role} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{mentorHoursRoleLabel(row.role)}</span>
              <small className="app-muted">
                {row.entries} · {row.hours}h
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By mentor</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byMentor.slice(0, 10).map((row) => (
            <li key={row.mentorName} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.mentorName}</span>
              <small className="app-muted">
                {row.entries} · {row.hours}h
              </small>
            </li>
          ))}
        </ul>
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
  if (view.summary.totalEntries === 0) {
    return (
      <EmptyState
        badge="No entries yet"
        badgeTone="setup"
        title="Log your first mentor-hours entry"
        description="Build sessions, strategy meetings, and outreach support all count toward grant-ready mentor engagement records."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent entries</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.mentorName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.occurredOn} · {mentorHoursRoleLabel(item.role)} · {mentorHoursCategoryLabel(item.category)}
              </small>
              <small className="app-muted">
                {Math.round(item.durationMinutes / 6) / 10}h
                {item.notes ? ` · ${item.notes}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete entry for "${item.mentorName}"?`)) {
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
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      mentorName: "",
      occurredOn: "",
      role: "mentor" as MentorHoursRole,
      category: "build" as MentorHoursCategory,
      durationMinutes: "",
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
        if (!form.mentorName.trim() || !form.occurredOn) return;
        mutate({
          action: "log-entry",
          mentorName: form.mentorName,
          occurredOn: form.occurredOn,
          role: form.role,
          category: form.category,
          durationMinutes: Number(form.durationMinutes) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log mentor hours</h2>
      <FormGrid min={160}>
        <FormRow label="Mentor name">
          <input value={form.mentorName} onChange={set("mentorName")} placeholder="Pat Mentor" required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} required />
        </FormRow>
        <FormRow label="Role">
          <select value={form.role} onChange={set("role")}>
            {MENTOR_HOURS_ROLES.map((role) => (
              <option key={role} value={role}>
                {mentorHoursRoleLabel(role)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Activity">
          <select value={form.category} onChange={set("category")}>
            {MENTOR_HOURS_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {mentorHoursCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Duration (min)">
          <input type="number" min={0} value={form.durationMinutes} onChange={set("durationMinutes")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.mentorName.trim() || !form.occurredOn}>
          Log hours
        </button>
      </div>
    </Panel>
  );
}

