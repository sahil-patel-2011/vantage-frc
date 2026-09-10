"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import {
  AWARD_SUBMISSION_STATUSES,
  AWARD_TYPES,
  awardStatusLabel,
  awardTypeLabel,
  daysUntil,
} from "../../lib/award-tracker";
import type { AwardTrackerView } from "../../lib/award-tracker/compute-award-tracker";
import {
  AWARD_TRACKER_RELATED_INCLUDE,
  classifyAwardTrackerShell,
  formatAwardTrackerMetric,
  formatAwardTrackerProgress,
  awardTrackerNextActions,
  awardTrackerRelatedLinks,
  awardTrackerShellCopy,
  shouldShowAwardTrackerSummaryTiles,
  type AwardTrackerNextAction,
  type AwardTrackerShellKind,
} from "../../lib/award-tracker/award-tracker-related";
import type { AwardSubmission, AwardSubmissionStatus, AwardType } from "../../lib/award-tracker/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./award-tracker.css";

function statusTone(status: AwardSubmissionStatus): string {
  if (status === "won") return "good";
  if (status === "not_won" || status === "withdrawn") return "danger";
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

function AwardTrackerRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = awardTrackerRelatedLinks(orgId, {
    include: [...AWARD_TRACKER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related award-tracker-related" aria-label="Related business tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function AwardTrackerNextActionsPanel({ actions }: { actions: AwardTrackerNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions award-tracker-next-actions"
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

function AwardTrackerShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: AwardTrackerShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const copy = awardTrackerShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "award-tracker", orgId);

  return (
    <main className="module-page award-tracker-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Award Tracker"}
          </>
        }
        title="Award Tracker"
        description={description}
      >
        <AwardTrackerRelatedStrip orgId={orgId} />
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
                ? "No submissions yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={hubHref("/business", "evidence", orgId)}>Open Awards</Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export default function AwardTrackerClient() {
  const [view, setView] = useState<AwardTrackerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const submissionCount = view?.status === "live" ? view.summary.total : 0;
  const dueSoonCount = view?.status === "live" ? view.summary.dueSoonCount : 0;
  const overdueCount = view?.status === "live" ? view.summary.overdueCount : 0;
  const submittedCount = view?.status === "live" ? view.summary.submittedCount : 0;
  const wonCount = view?.status === "live" ? view.summary.wonCount : 0;
  const progressSignal = view?.status === "live" ? view.summary.progressSignal : 0;

  const shell = classifyAwardTrackerShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    submissionCount,
  });
  const shellCopy = awardTrackerShellCopy(shell);
  const nextActions = awardTrackerNextActions({
    orgId,
    shell,
    submissionCount,
    dueSoonCount,
  });
  const relatedLinks = awardTrackerRelatedLinks(orgId, {
    include: [...AWARD_TRACKER_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "award-tracker", orgId);
  const evidenceHref = hubHref("/business", "evidence", orgId);
  const awardsHref = withOrgHref("/team/awards", orgId);
  const essayHref = hubHref("/business", "impact-essay", orgId);

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

  if (shell === "loading") {
    return <AwardTrackerShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <AwardTrackerShell
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
      <AwardTrackerShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <AwardTrackerShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page award-tracker-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Award Tracker"}
          </>
        }
        title="Award Tracker"
        description="Track award submissions across events with deadlines. Cross-check Awards and Impact Essay."
      >
        <div className="award-tracker-header-actions">
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
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <AwardTrackerNextActionsPanel actions={nextActions} />

      {shouldShowAwardTrackerSummaryTiles(submissionCount) ? (
        <section className="award-tracker-stats" aria-label="Award submission counts">
          <div>
            <strong>{formatAwardTrackerMetric(submissionCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Submissions
            </span>
          </div>
          <div>
            <strong>{formatAwardTrackerMetric(dueSoonCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Due within 7 days
            </span>
          </div>
          <div>
            <strong>{formatAwardTrackerMetric(overdueCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Overdue
            </span>
          </div>
          <div>
            <strong>{formatAwardTrackerMetric(submittedCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Submitted / in judging
            </span>
          </div>
          <div>
            <strong>{formatAwardTrackerMetric(wonCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Won
            </span>
          </div>
          <div>
            <strong>{formatAwardTrackerProgress(progressSignal, submissionCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Progress signal
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No submissions yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#award-tracker-create">
            Track a submission
          </Button>
        </EmptyState>
      ) : null}

      <div className="award-tracker-layout">
        <UpcomingDeadlines view={view} />
        <CreateSubmissionForm busy={busy} mutate={mutate} />
        <SubmissionsList view={view} busy={busy} mutate={mutate} />
        <Panel className="award-tracker-tip" aria-label="Award Tracker tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep packets in <a href={evidenceHref}>Awards</a>, review workbench uploads in{" "}
            <a href={awardsHref}>Awards workbench</a>, and draft narratives in{" "}
            <a href={essayHref}>Impact Essay</a>
          </p>
        </Panel>
      </div>
    </main>
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
        soft
        badge="No submissions yet"
        badgeTone="setup"
        title="Track your first award submission"
        description="Log an award, event, and deadline to start tracking."
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
      id="award-tracker-create"
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
      <p className="app-muted" style={{ margin: 0 }}>
        Counts reflect submissions you start.
      </p>
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
        <Button variant="primary" type="submit" disabled={busy || !form.awardName.trim() || !form.eventName.trim()}>
          Track submission
        </Button>
      </div>
    </Panel>
  );
}
