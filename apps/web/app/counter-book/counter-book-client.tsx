"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { counterBookFieldLabel } from "../../lib/counter-book";
import type { CounterBookView } from "../../lib/counter-book/compute-counter-book";
import type { CounterBookReport } from "../../lib/counter-book/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<CounterBookView, { status: "live" }>;

export default function CounterBookClient() {
  const [view, setView] = useState<CounterBookView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/counter-book${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CounterBookView | { error?: string };
        if (!response.ok || !("status" in data)) {
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
        const response = await fetch("/api/counter-book", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as CounterBookView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Counter-book"}
          </>
        }
        title="Opponent Counter-book"
        description="One-page counter-strategy per likely playoff opponent — tendencies and failure triggers pulled only from your team's own scouted matches, never fabricated."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState title="Could not load Counter-book" description="A network or server issue prevented loading. Try again.">
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
          <GenerateReportForm busy={busy} mutate={mutate} />
          <ReportList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function GenerateReportForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [teamKey, setTeamKey] = useState("");
  const [eventKey, setEventKey] = useState("");

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!teamKey.trim()) return;
        mutate({ action: "generate-report", teamKey: teamKey.trim(), eventKey: eventKey.trim() || undefined });
        setTeamKey("");
        setEventKey("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Generate counter-book</h2>
      <FormGrid min={180}>
        <FormRow label="Opponent team key" hint="e.g. frc254">
          <input value={teamKey} onChange={(e) => setTeamKey(e.target.value)} placeholder="frc254" required />
        </FormRow>
        <FormRow label="Event key (optional)" hint="Limit to matches scouted at one event">
          <input value={eventKey} onChange={(e) => setEventKey(e.target.value)} placeholder="2026casj" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !teamKey.trim()}>
          Generate
        </button>
      </div>
    </Panel>
  );
}

function ReportList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.reports.length === 0) {
    return (
      <EmptyState
        badge="No counter-books yet"
        badgeTone="setup"
        title="Generate your first opponent counter-book"
        description="Scout a team's matches, then generate a counter-book above to see their tendencies and how to beat them."
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {view.reports.map((report) => (
        <ReportCard key={report.id} report={report} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function ReportCard({
  report,
  busy,
  mutate,
}: {
  report: CounterBookReport;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{report.title}</h2>
          <small className="app-muted">
            {report.matchesScouted} scouted match(es)
            {report.eventKey ? ` · ${report.eventKey}` : ""} · {new Date(report.createdAt).toLocaleDateString()}
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
      <p style={{ marginTop: 8 }}>{report.summary}</p>
      <p>{report.counterPlan}</p>
      {report.tendencies.length > 0 ? (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <strong className="app-muted">Tendencies</strong>
          <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {report.tendencies.slice(0, 8).map((t) => (
              <li key={t.field} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{counterBookFieldLabel(t.field)}</span>
                <small className="app-muted">
                  avg {t.average} · {t.sampleSize} samples · variability {pct(t.variability)}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {report.failureTriggers.length > 0 ? (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <strong className="app-muted">Failure triggers</strong>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {report.failureTriggers.map((f) => (
              <li key={f.field}>
                <small className="app-muted">{f.detail}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
