"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import {
  ruleChangeCategoryLabel,
  ruleChangeSeverityLabel,
  ruleImpactStatusLabel,
  subsystemCategoryLabel,
} from "../../lib/rule-impact";
import {
  RULE_CHANGE_CATEGORIES,
  RULE_CHANGE_SEVERITIES,
  SUBSYSTEM_CATEGORIES,
  type RuleImpactView,
} from "../../lib/rule-impact/compute-rule-impact";
import type {
  RuleChangeCategory,
  RuleChangeSeverity,
  RuleImpactStatus,
  SubsystemCategory,
} from "../../lib/rule-impact/types";

function statusTone(status: RuleImpactStatus): string {
  if (status === "still_legal") return "good";
  if (status === "needs_rework") return "setup";
  return "demo";
}

function severityTone(severity: RuleChangeSeverity): string {
  if (severity === "blocking") return "demo";
  if (severity === "major") return "setup";
  return "good";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<RuleImpactView, { status: "live" }>;

export default function RuleImpactClient() {
  const [view, setView] = useState<RuleImpactView | null>(null);
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
    void fetch(`/api/rule-impact${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as RuleImpactView | { error?: string };
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
        const response = await fetch("/api/rule-impact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as RuleImpactView | { error?: string };
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
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Rule Impact Analyzer"}
          </>
        }
        title="Rule Impact Analyzer"
        description="Log this season's game-manual rule changes and diff them against your subsystem library — see which prior-season designs are still legal, need rework, or are blocked."
      >
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the Rule Impact Analyzer"
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
          <RuleChangeForm busy={busy} mutate={mutate} />
          <RuleChangeList view={view} busy={busy} mutate={mutate} />
          {view.candidates.length > 0 ? (
            <CandidateList view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No subsystem history"
              badgeTone="setup"
              title="No prior-season subsystems on file"
              description="Log robot subsystems on the Build spec sheet to see rule-impact candidates here."
            />
          )}
          <AssessmentList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function RuleChangeForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      ruleCode: "",
      title: "",
      category: "dimension" as RuleChangeCategory,
      severity: "minor" as RuleChangeSeverity,
      subsystemCategory: "" as SubsystemCategory | "",
      summary: "",
      sourceUrl: "",
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
        if (!form.ruleCode.trim() || !form.title.trim()) return;
        mutate({
          action: "log-rule-change",
          ruleCode: form.ruleCode,
          title: form.title,
          category: form.category,
          severity: form.severity,
          subsystemCategory: form.subsystemCategory || undefined,
          summary: form.summary || undefined,
          sourceUrl: form.sourceUrl || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a rule change</h2>
      <FormGrid min={160}>
        <FormRow label="Rule code">
          <input value={form.ruleCode} onChange={set("ruleCode")} placeholder="R301" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Cage height reduced" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {RULE_CHANGE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {ruleChangeCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Severity">
          <select value={form.severity} onChange={set("severity")}>
            {RULE_CHANGE_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {ruleChangeSeverityLabel(severity)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Subsystem category (optional)">
          <select value={form.subsystemCategory} onChange={set("subsystemCategory")}>
            <option value="">Applies to all subsystems</option>
            {SUBSYSTEM_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {subsystemCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Source URL (optional)">
          <input value={form.sourceUrl} onChange={set("sourceUrl")} placeholder="https://…" />
        </FormRow>
      </FormGrid>
      <FormRow label="Summary (optional)">
        <textarea value={form.summary} onChange={set("summary")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.ruleCode.trim() || !form.title.trim()}>
          Log rule change
        </button>
      </div>
    </Panel>
  );
}

function RuleChangeList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.ruleChanges.length === 0) {
    return (
      <EmptyState
        badge="No rule changes logged"
        badgeTone="setup"
        title="Log this season's rule changes"
        description="Add each new-season game-manual delta above to start diffing it against your subsystem library."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Logged rule changes ({view.ruleChanges.length})</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.ruleChanges.map((rule) => (
          <li key={rule.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${severityTone(rule.severity)}`}>{ruleChangeSeverityLabel(rule.severity)}</span>{" "}
              <strong>{rule.ruleCode}</strong> — {rule.title}
              <small className="app-muted" style={{ display: "block" }}>
                {ruleChangeCategoryLabel(rule.category)}
                {rule.subsystemCategory ? ` · ${subsystemCategoryLabel(rule.subsystemCategory)}` : " · applies to all subsystems"}
                {rule.summary ? ` · ${rule.summary}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete rule "${rule.ruleCode}"?`)) {
                  mutate({ action: "delete-rule-change", ruleChangeId: rule.id });
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

function CandidateList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Subsystem impact ({view.candidates.length})</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.candidates.map((candidate) => (
          <li key={candidate.subsystemId} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${statusTone(candidate.impactStatus)}`}>
                {ruleImpactStatusLabel(candidate.impactStatus)}
              </span>{" "}
              <strong>{candidate.subsystemName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {subsystemCategoryLabel(candidate.category)} · {candidate.sourceSeasonYear} · {candidate.motorType}
                {candidate.motorCount ? ` ×${candidate.motorCount}` : ""} · {pct(candidate.confidence)} confidence
              </small>
              <small className="app-muted" style={{ display: "block" }}>
                {candidate.rationale}
              </small>
              {candidate.matchedRules.length > 0 ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Matched: {candidate.matchedRules.map((rule) => rule.ruleCode).join(", ")}
                </small>
              ) : null}
            </div>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() =>
                mutate({
                  action: "assess",
                  subsystemId: candidate.subsystemId,
                  subsystemName: candidate.subsystemName,
                  category: candidate.category,
                  sourceSeasonYear: candidate.sourceSeasonYear,
                })
              }
            >
              {candidate.alreadyAssessed ? "Reassess" : "Assess"}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AssessmentList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.assessments.length === 0) {
    return (
      <EmptyState
        badge="No assessments yet"
        badgeTone="setup"
        title="Assess a subsystem above"
        description="Persisted assessments — including status changes as you triage them — appear here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Assessments ({view.assessments.length})</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.assessments.map((assessment) => (
          <li key={assessment.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${statusTone(assessment.impactStatus)}`}>
                {ruleImpactStatusLabel(assessment.impactStatus)}
              </span>{" "}
              <strong>{assessment.subsystemName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {subsystemCategoryLabel(assessment.category)} · {assessment.matchedRuleCount} matched rule(s) ·{" "}
                {pct(assessment.confidence)} confidence · {assessment.status}
              </small>
              <small className="app-muted" style={{ display: "block" }}>
                {assessment.rationale}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {assessment.status === "open" ? (
                <>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "update-status", assessmentId: assessment.id, status: "accepted" })}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "update-status", assessmentId: assessment.id, status: "dismissed" })}
                  >
                    Dismiss
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete assessment for "${assessment.subsystemName}"?`)) {
                    mutate({ action: "delete-assessment", assessmentId: assessment.id });
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
