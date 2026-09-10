"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { PROFICIENCY_LEVELS, SKILL_CATEGORIES, skillCategoryLabel, proficiencyLabel } from "../../lib/skills-graph";
import type { SkillsGraphView } from "../../lib/skills-graph/compute-skills-graph";
import type { ProficiencyLevel, SkillCategory } from "../../lib/skills-graph/types";

type LiveView = Extract<SkillsGraphView, { status: "live" }>;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function SkillsGraphClient() {
  const [view, setView] = useState<SkillsGraphView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/skills-graph${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SkillsGraphView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setErrorMessage("error" in data && data.error ? data.error : null);
          setFetchFailed(true);
          return;
        }
        setView(data);
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
        const response = await fetch("/api/skills-graph", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as SkillsGraphView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Skills & Mentorship"}
          </>
        }
        title="Skills & Mentorship Graph"
        description="Declared skills backed by real completed-task evidence, matched to novices requesting a mentor. No invented scores — only what your team has logged."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: errorMessage,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: errorMessage,
            },
          );
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
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
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
          <CalibrationEvidence view={view} busy={busy} mutate={mutate} />
          <AddSkillForm view={view} busy={busy} mutate={mutate} />
          <RequestMentorForm busy={busy} mutate={mutate} />
          <MentorRequests view={view} busy={busy} mutate={mutate} />
          <SkillEntries view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Declared skills", value: String(summary.totalEntries) },
    { label: "Members with skills", value: String(summary.totalMembers) },
    { label: "Categories covered", value: String(summary.totalCategories) },
    { label: "Open mentor requests", value: String(summary.openRequests) },
    { label: "Matched requests", value: String(summary.matchedRequests) },
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

/**
 * "Call Your Shot" calibration signals surfaced as EVIDENCE. A strong signal
 * may propose a skill entry; only a mentor's explicit click (the countersign)
 * writes one — the signal itself never changes anyone's proficiency. Thin
 * samples say "not enough graded calls yet" instead of scoring anybody.
 * RLS already scoped the rows: students see only their own signals here.
 */
function CalibrationEvidence({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.calibration.length === 0) return null;
  return (
    <Panel style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Prediction calibration (Call Your Shot)</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Evidence from calls made on the engineering calculators. A signal can propose a skill entry, but
        nothing lands in the graph until a mentor countersigns it.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {view.calibration.map((signal) => (
          <li
            key={`${signal.userId}:${signal.surface}`}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <div style={{ display: "grid", gap: 2 }}>
              <strong>
                {signal.userName} · {signal.surfaceLabel}
                {signal.proposal ? (
                  <span className="app-badge good" style={{ marginLeft: 8 }}>
                    Proposal
                  </span>
                ) : null}
              </strong>
              <small className="app-muted">{signal.note}</small>
            </div>
            {signal.proposal && view.viewerCanCountersign ? (
              <button
                type="button"
                className="app-button secondary"
                disabled={busy}
                onClick={() =>
                  mutate({
                    action: "add-skill",
                    targetUserId: signal.userId,
                    skillCategory: signal.proposal!.skillCategory,
                    proficiency: signal.proposal!.proficiency,
                    evidenceNote: signal.proposal!.evidenceNote,
                  })
                }
              >
                Countersign as {proficiencyLabel(signal.proposal.proficiency)}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddSkillForm({
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
      targetUserId: view.members[0]?.userId ?? "",
      skillCategory: "drivetrain" as SkillCategory,
      proficiency: "developing" as ProficiencyLevel,
      customLabel: "",
      evidenceNote: "",
    }),
    [view.members],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.targetUserId) return;
        mutate({
          action: "add-skill",
          targetUserId: form.targetUserId,
          skillCategory: form.skillCategory,
          proficiency: form.proficiency,
          customLabel: form.customLabel || undefined,
          evidenceNote: form.evidenceNote || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Declare a skill</h2>
      <FormGrid min={160}>
        <FormRow label="Member">
          <select value={form.targetUserId} onChange={set("targetUserId")} required>
            {view.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.userName}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Category">
          <select value={form.skillCategory} onChange={set("skillCategory")}>
            {SKILL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {skillCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Proficiency">
          <select value={form.proficiency} onChange={set("proficiency")}>
            {PROFICIENCY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {proficiencyLabel(level)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Custom label (optional)">
          <input value={form.customLabel} onChange={set("customLabel")} placeholder="e.g. swerve wiring" />
        </FormRow>
      </FormGrid>
      <FormRow label="Evidence note (optional)">
        <textarea value={form.evidenceNote} onChange={set("evidenceNote")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.targetUserId}>
          Add skill
        </button>
      </div>
    </Panel>
  );
}

function RequestMentorForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ skillCategory: "drivetrain" as SkillCategory, note: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ action: "request-mentor", skillCategory: form.skillCategory, note: form.note || undefined });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Request a mentor</h2>
      <FormGrid min={160}>
        <FormRow label="Category">
          <select value={form.skillCategory} onChange={set("skillCategory")}>
            {SKILL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {skillCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Note (optional)">
          <input value={form.note} onChange={set("note")} placeholder="What do you want help with?" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy}>
          Request mentor
        </button>
      </div>
    </Panel>
  );
}

function MentorRequests({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.requests.length === 0) {
    return (
      <EmptyState
        badge="No requests yet"
        badgeTone="setup"
        title="No mentor requests logged"
        description="Novices can request a mentor for any skill category above; matches are ranked from declared skills and real completed-task evidence."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Mentor requests</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.requests.map((request) => (
          <li key={request.id} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>
                  {request.requesterName} · {skillCategoryLabel(request.skillCategory)}
                </strong>
                <span className={`app-badge ${request.status === "matched" ? "good" : request.status === "closed" ? "demo" : "setup"}`} style={{ marginLeft: 8 }}>
                  {request.status.toUpperCase()}
                </span>
                {request.note ? (
                  <small className="app-muted" style={{ display: "block" }}>
                    {request.note}
                  </small>
                ) : null}
              </div>
              {request.status !== "closed" ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "close-request", requestId: request.id })}
                >
                  Close
                </button>
              ) : null}
            </div>
            {request.matchedUserName ? (
              <small className="app-muted">
                Suggested mentor: <strong>{request.matchedUserName}</strong>
                {request.matchedRationale ? ` — ${request.matchedRationale}` : ""}
              </small>
            ) : (
              <small className="app-muted">No declared-skill candidate found yet for this category.</small>
            )}
            {request.candidates.length > 0 ? (
              <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 4 }}>
                {request.candidates.map((candidate) => (
                  <li key={candidate.userId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{candidate.userName}</span>
                    <small className="app-muted">
                      {proficiencyLabel(candidate.proficiency)} · {pct(candidate.score)} · {candidate.taskEvidenceCount} task(s)
                    </small>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SkillEntries({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        badge="No skills yet"
        badgeTone="setup"
        title="No skills declared yet"
        description="Declare skills above to start building the team's mentorship graph."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Declared skills</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.map((entry) => (
          <li key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>
                {entry.userName} · {entry.customLabel || skillCategoryLabel(entry.skillCategory)}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {proficiencyLabel(entry.proficiency)} · {entry.taskEvidenceCount} completed task(s) in this category
              </small>
              {entry.evidenceNote ? <small className="app-muted">{entry.evidenceNote}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove this skill for ${entry.userName}?`)) {
                  mutate({ action: "delete-skill", entryId: entry.id });
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
