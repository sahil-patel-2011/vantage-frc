"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { triageDecisionLabel } from "../../lib/pit-repair-triage";
import {
  TRIAGE_STATUSES,
  type PitRepairTriageView,
} from "../../lib/pit-repair-triage/compute-pit-repair-triage";
import type { TriageDecision, TriageStatus } from "../../lib/pit-repair-triage/types";

const DECISION_TONE: Record<TriageDecision, string> = {
  fix: "good",
  swap: "setup",
  monitor: "demo",
};

const STATUS_LABEL: Record<TriageStatus, string> = {
  open: "Open",
  staged: "Staged",
  resolved: "Resolved",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<PitRepairTriageView, { status: "live" }>;

export default function PitRepairTriageClient() {
  const [view, setView] = useState<PitRepairTriageView | null>(null);
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
    void fetch(`/api/pit-repair-triage${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PitRepairTriageView | { error?: string };
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
        const response = await fetch("/api/pit-repair-triage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as PitRepairTriageView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Pit Repair Triage"}
          </>
        }
        title="Pit Repair Triage"
        description="Log a pit failure, cross-referenced against FMEA history and spares on hand, to get a grounded fix-vs-swap call and pre-stage the right part before the next match."
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
          title="Could not load pit-repair triage"
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
          <LogFailureForm busy={busy} mutate={mutate} view={view} />
          {view.reports.length > 0 ? (
            <ReportsList view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No reports yet"
              badgeTone="setup"
              title="Log your first pit failure"
              description="Once logged, Vantage cross-references FMEA history and spares inventory against remaining match time to recommend fix or swap."
            />
          )}
          <ReferencePanels view={view} />
        </div>
      )}
    </main>
  );
}

function ReportsList({
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
      <h2 style={{ marginTop: 0 }}>Triage reports</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.reports.map((report) => (
          <li key={report.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${DECISION_TONE[report.decision]}`}>
                  {triageDecisionLabel(report.decision)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{report.title}</strong>
                <small className="app-muted">
                  {report.subsystemName} · {STATUS_LABEL[report.status]} · confidence {pct(report.confidence)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${report.title}"?`)) {
                    mutate({ action: "delete-report", reportId: report.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            {report.symptomNote ? <p style={{ margin: 0 }}>{report.symptomNote}</p> : null}
            {report.photoUrl ? (
              <a href={report.photoUrl} target="_blank" rel="noreferrer">
                View photo
              </a>
            ) : null}
            <small className="app-muted">{report.rationale}</small>
            <small className="app-muted">
              {report.minutesUntilNextMatch} min to next match · {report.priorFailureCount} prior FMEA failure(s) ·{" "}
              {report.sparesAvailable} spare(s) matched
              {report.prestageRecommended ? " · pre-stage recommended" : ""}
            </small>
            {report.status !== "resolved" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {TRIAGE_STATUSES.filter((status) => status !== report.status).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    onClick={() => mutate({ action: "update-status", reportId: report.id, status })}
                  >
                    Mark {STATUS_LABEL[status].toLowerCase()}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ReferencePanels({ view }: { view: LiveView }) {
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>FMEA history</h2>
        {view.fmeaHistory.length === 0 ? (
          <p className="app-muted">No FMEA failures logged this season yet.</p>
        ) : (
          <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {view.fmeaHistory.map((entry) => (
              <li key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  {entry.subsystemName} — {entry.title}
                </span>
                <small className="app-muted">
                  sev {entry.severity} · {entry.occurredAt}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>Spares in stock</h2>
        {view.spareCandidates.length === 0 ? (
          <p className="app-muted">No spares currently in stock.</p>
        ) : (
          <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {view.spareCandidates.map((item) => (
              <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{item.name}</span>
                <small className="app-muted">
                  {item.quantity} in stock{item.subsystem ? ` · ${item.subsystem}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LogFailureForm({
  busy,
  mutate,
  view,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  view: LiveView;
}) {
  const empty = useMemo(
    () => ({
      subsystemName: "",
      title: "",
      symptomNote: "",
      photoUrl: "",
      minutesUntilNextMatch: "",
      relatedFmeaFailureId: "",
      matchedInventoryItemId: "",
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
        if (!form.subsystemName.trim() || !form.title.trim()) return;
        mutate({
          action: "log-failure",
          subsystemName: form.subsystemName,
          title: form.title,
          symptomNote: form.symptomNote || undefined,
          photoUrl: form.photoUrl || undefined,
          minutesUntilNextMatch: Number(form.minutesUntilNextMatch) || 0,
          relatedFmeaFailureId: form.relatedFmeaFailureId || undefined,
          matchedInventoryItemId: form.matchedInventoryItemId || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a pit failure</h2>
      <FormGrid min={180}>
        <FormRow label="Subsystem">
          <input value={form.subsystemName} onChange={set("subsystemName")} placeholder="Intake" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Roller jammed under load" required />
        </FormRow>
        <FormRow label="Minutes until next match">
          <input type="number" min={0} value={form.minutesUntilNextMatch} onChange={set("minutesUntilNextMatch")} />
        </FormRow>
        <FormRow label="Related FMEA failure (optional)">
          <select value={form.relatedFmeaFailureId} onChange={set("relatedFmeaFailureId")}>
            <option value="">None</option>
            {view.fmeaHistory.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.subsystemName} — {entry.title}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Matched spare (optional)">
          <select value={form.matchedInventoryItemId} onChange={set("matchedInventoryItemId")}>
            <option value="">None</option>
            {view.spareCandidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.quantity} in stock)
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Photo URL (optional)">
          <input value={form.photoUrl} onChange={set("photoUrl")} placeholder="https://…" />
        </FormRow>
      </FormGrid>
      <FormRow label="Symptom note (optional)">
        <textarea value={form.symptomNote} onChange={set("symptomNote")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.subsystemName.trim() || !form.title.trim()}
        >
          Triage failure
        </button>
      </div>
    </Panel>
  );
}
