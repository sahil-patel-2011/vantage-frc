"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { AWARD_SUBMISSION_STATUSES, AWARD_TYPES, awardStatusLabel, awardTypeLabel, daysUntil } from "../../lib/award-tracker";
import type { AwardTrackerView } from "../../lib/award-tracker/compute-award-tracker";
import type { AwardSubmission, AwardSubmissionStatus, AwardType } from "../../lib/award-tracker/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusTone(status: AwardSubmissionStatus): string {
  if (status === "won") return "good";
  if (status === "not_won" || status === "withdrawn") return "demo";
  if (status === "submitted" || status === "judging") return "setup";
  return "setup";
}

function deadlineLabel(submission: AwardSubmission): string {
  if (!submission.submissionDeadline) return "No deadline set";
  const days = daysUntil(submission.submissionDeadline, new Date());
  if (days == null) return submission.submissionDeadline;
  if (submission.status === "won" || submission.status === "not_won" || submission.status === "withdrawn") {
    return submission.submissionDeadline;
  }
  if (days < 0) return `${submission.submissionDeadline} · ${Math.abs(days)} day(s) overdue`;
  if (days === 0) return `${submission.submissionDeadline} · due today`;
  return `${submission.submissionDeadline} · ${days} day(s) left`;
}

type LiveView = Extract<AwardTrackerView, { status: "live" }>;

export default function AwardTrackerClient() {
  const [view, setView] = useState<AwardTrackerView | null>(null);
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
    void fetch(`/api/award-tracker${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as AwardTrackerView | { error?: string };
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
        const response = await fetch("/api/award-tracker", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as AwardTrackerView | { error?: string };
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
            {" / Award Tracker"}
          </>
        }
        title="Award Tracker"
        description="Track award submissions across events with deadlines — Chairman's, Impact, Engineering Inspiration, and more."
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
        <EmptyState
          title="Could not load Award Tracker"
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
          <SummaryTiles view={view} />
          <UpcomingDeadlines view={view} />
          <CreateSubmissionForm busy={busy} mutate={mutate} />
          <SubmissionsList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Submissions", value: String(summary.total) },
    { label: "Due within 7 days", value: String(summary.dueSoonCount) },
    { label: "Overdue", value: String(summary.overdueCount) },
    { label: "Submitted / in judging", value: String(summary.submittedCount) },
    { label: "Won", value: String(summary.wonCount) },
    { label: "Progress signal", value: pct(summary.progressSignal) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
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

function UpcomingDeadlines({ view }: { view: LiveView }) {
  if (view.upcoming.length === 0) {
    return null;
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Upcoming deadlines</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {view.upcoming.map((submission) => (
          <li key={submission.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <div>
              <strong>{submission.awardName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {submission.eventName} · {awardTypeLabel(submission.awardType)}
              </small>
            </div>
            <span className={`app-badge ${statusTone(submission.status)}`}>{deadlineLabel(submission)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SubmissionsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.total === 0) {
    return (
      <EmptyState
        badge="No submissions yet"
        badgeTone="setup"
        title="Track your first award submission"
        description="Log an award, event, and deadline to start tracking status through submission and judging."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>All submissions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.submissions.map((submission) => (
          <li
            key={submission.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{submission.awardName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {submission.eventName} · {awardTypeLabel(submission.awardType)} · {deadlineLabel(submission)}
              </small>
              {submission.ownerNote ? <small className="app-muted">{submission.ownerNote}</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select
                value={submission.status}
                disabled={busy}
                onChange={(event) =>
                  mutate({
                    action: "update-status",
                    submissionId: submission.id,
                    status: event.target.value as AwardSubmissionStatus,
                  })
                }
              >
                {AWARD_SUBMISSION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {awardStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${submission.awardName}"?`)) {
                    mutate({ action: "delete-submission", submissionId: submission.id });
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

function CreateSubmissionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      awardName: "",
      eventName: "",
      awardType: "chairmans" as AwardType,
      eventDate: "",
      submissionDeadline: "",
      ownerNote: "",
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
        if (!form.awardName.trim() || !form.eventName.trim()) return;
        mutate({
          action: "create-submission",
          awardName: form.awardName,
          eventName: form.eventName,
          awardType: form.awardType,
          eventDate: form.eventDate || undefined,
          submissionDeadline: form.submissionDeadline || undefined,
          ownerNote: form.ownerNote || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Track a new submission</h2>
      <FormGrid min={160}>
        <FormRow label="Award">
          <input value={form.awardName} onChange={set("awardName")} placeholder="Chairman's Award" required />
        </FormRow>
        <FormRow label="Award type">
          <select value={form.awardType} onChange={set("awardType")}>
            {AWARD_TYPES.map((type) => (
              <option key={type} value={type}>
                {awardTypeLabel(type)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Event">
          <input value={form.eventName} onChange={set("eventName")} placeholder="Week 3 Regional" required />
        </FormRow>
        <FormRow label="Event date">
          <input type="date" value={form.eventDate} onChange={set("eventDate")} />
        </FormRow>
        <FormRow label="Submission deadline">
          <input type="date" value={form.submissionDeadline} onChange={set("submissionDeadline")} />
        </FormRow>
        <FormRow label="Owner (optional)">
          <input value={form.ownerNote} onChange={set("ownerNote")} placeholder="Assigned to…" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.awardName.trim() || !form.eventName.trim()}
        >
          Track submission
        </button>
      </div>
    </Panel>
  );
}
