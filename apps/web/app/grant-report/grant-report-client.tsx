"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { outreachKindLabel } from "../../lib/grant-report";
import type { GrantReportView } from "../../lib/grant-report/compute-grant-report";

type LiveView = Extract<GrantReportView, { status: "live" }>;

export default function GrantReportClient() {
  const [view, setView] = useState<GrantReportView | null>(null);
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
    void fetch(`/api/grant-report${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as GrantReportView | { error?: string };
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
        const response = await fetch("/api/grant-report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as GrantReportView | { error?: string };
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
            {" / Grant Report"}
          </>
        }
        title="Grant Report"
        description="Post-grant impact reports generated from your team's own logged outreach and finance records — no invented figures."
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
            <nav className="intel-actions" aria-label="Related business tools" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <a className="app-button secondary" href={`/business?orgId=${encodeURIComponent(orgId)}&tab=grants`}>
                Business · Grants
              </a>
              <a className="app-button secondary" href={`/team/grants?orgId=${encodeURIComponent(orgId)}`}>
                Grants workbench
              </a>
              <a className="app-button secondary" href={`/impact?orgId=${encodeURIComponent(orgId)}`}>
                Community Impact
              </a>
            </nav>
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
          title="Could not load Grant Report"
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
          <EligibleGrants view={view} busy={busy} mutate={mutate} />
          <Reports view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function EligibleGrants({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.eligibleGrants.length === 0) {
    return (
      <EmptyState
        badge="No awarded grants yet"
        badgeTone="setup"
        title="Mark a grant as awarded to generate a report"
        description="Post-grant reports are generated from grants tracked as 'awarded' in the Grants tracker, along with any logged outreach and finance records for that season."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Awarded grants</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.eligibleGrants.map((grant) => (
          <li
            key={grant.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{grant.name}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {grant.funder ? `${grant.funder} · ` : ""}
                {grant.seasonYear} · ${grant.amountAwardedUsd.toLocaleString()}
                {grant.decisionAt ? ` · decided ${new Date(grant.decisionAt).toLocaleDateString()}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="app-button"
              disabled={busy}
              onClick={() => mutate({ action: "generate-report", grantApplicationId: grant.id })}
            >
              {grant.hasReport ? "Regenerate report" : "Generate report"}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Reports({
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
        title="No reports generated yet"
        description="Generate a report for an awarded grant above to see it here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Generated reports</h2>
      <div style={{ display: "grid", gap: 16 }}>
        {view.reports.map((report) => (
          <article key={report.id} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{report.grantName}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {report.funder ? `${report.funder} · ` : ""}
                  {report.seasonYear} · Awarded ${report.amountAwardedUsd.toLocaleString()} · Spend $
                  {report.totalSpendUsd.toLocaleString()} · {report.outreachCount} outreach message(s)
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this report?")) {
                    mutate({ action: "delete-report", reportId: report.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            {report.outreachByKind.length > 0 ? (
              <small className="app-muted">
                Outreach: {report.outreachByKind.map((line) => `${line.count} ${outreachKindLabel(line.kind).toLowerCase()}`).join(", ")}
              </small>
            ) : null}
            <div style={{ display: "grid", gap: 6 }}>
              {report.sections.map((section) => (
                <div key={section.id}>
                  <strong>{section.title}</strong>
                  <p style={{ margin: "2px 0 0" }}>{section.body}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}
