"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { outreachKindLabel } from "../../lib/grant-report";
import type { GrantReportView } from "../../lib/grant-report/compute-grant-report";
import {
  GRANT_REPORT_RELATED_INCLUDE,
  classifyGrantReportShell,
  formatGrantReportMetric,
  grantReportNextActions,
  grantReportRelatedLinks,
  grantReportSetupSteps,
  grantReportShellCopy,
  shouldShowGrantReportSummaryTiles,
  type GrantReportNextAction,
  type GrantReportShellKind,
} from "../../lib/grant-report/grant-report-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./grant-report.css";

type LiveView = Extract<GrantReportView, { status: "live" }>;

function GrantReportRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = grantReportRelatedLinks(orgId, {
    include: [...GRANT_REPORT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related grant-report-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function GrantReportNextActionsPanel({ actions }: { actions: GrantReportNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions grant-report-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Grants and Community Impact — never DEMO grant dollars.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function GrantReportShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: GrantReportShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = grantReportNextActions({ orgId, shell });
  const copy = grantReportShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "grant-report", orgId);
  const steps = shell === "setup" ? grantReportSetupSteps(orgId) : [];

  return (
    <main className="module-page grant-report-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Grant Report"}
          </>
        }
        title="Grant Report"
        description={description}
      >
        <GrantReportRelatedStrip orgId={orgId} />
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
                ? "No awarded grants yet"
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
            <a className="app-button" href={hubHref("/business", "grants", orgId)}>
              Open Grants
            </a>
            <a className="app-button secondary" href={withOrgHref("/team/grants", orgId)}>
              Open Grants workbench
            </a>
            <a className="app-button secondary" href={hubHref("/business", "impact", orgId)}>
              Open Community Impact
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
              <a href={step.href}>Open</a>
            </li>
          ))}
        </ol>
      ) : null}
      <GrantReportNextActionsPanel actions={actions} />
    </main>
  );
}

export default function GrantReportClient() {
  const [view, setView] = useState<GrantReportView | null>(null);
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const eligibleCount = view?.status === "live" ? view.eligibleGrants.length : 0;
  const reportCount = view?.status === "live" ? view.reports.length : 0;

  const shell = classifyGrantReportShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    eligibleCount,
    reportCount,
  });
  const shellCopy = grantReportShellCopy(shell);
  const nextActions = grantReportNextActions({
    orgId,
    shell,
    eligibleCount,
    reportCount,
  });
  const relatedLinks = grantReportRelatedLinks(orgId, {
    include: [...GRANT_REPORT_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "grant-report", orgId);
  const grantsHref = hubHref("/business", "grants", orgId);
  const impactHref = hubHref("/business", "impact", orgId);
  const workbenchHref = withOrgHref("/team/grants", orgId);

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

  if (shell === "loading") {
    return <GrantReportShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <GrantReportShell
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
      <GrantReportShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <GrantReportShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page grant-report-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Grant Report"}
          </>
        }
        title="Grant Report"
        description="Post-grant impact reports generated from your team's own logged outreach and finance records — never DEMO grant dollars. Cross-check Grants and Community Impact."
      >
        <div className="grant-report-header-actions">
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

      <GrantReportNextActionsPanel actions={nextActions} />

      {shouldShowGrantReportSummaryTiles({ eligibleCount, reportCount }) ? (
        <section className="grant-report-stats" aria-label="Awarded grant counts">
          <div>
            <strong>{formatGrantReportMetric(eligibleCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Awarded grants
            </span>
          </div>
          <div>
            <strong>{formatGrantReportMetric(reportCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Generated reports
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No awarded grants yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={grantsHref}>
            Open Grants
          </a>
          <a className="app-button secondary" href={workbenchHref}>
            Open Grants workbench
          </a>
          <a className="app-button secondary" href={impactHref}>
            Open Community Impact
          </a>
        </EmptyState>
      ) : null}

      <div className="grant-report-layout">
        <EligibleGrants view={view} busy={busy} mutate={mutate} />
        <Reports view={view} busy={busy} mutate={mutate} />
        <Panel className="grant-report-tip" aria-label="Grant Report tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Mark awards in <a href={grantsHref}>Grants</a>, draft language in{" "}
            <a href={workbenchHref}>Grants workbench</a>, and ground outreach in{" "}
            <a href={impactHref}>Community Impact</a> — never invent DEMO grant dollars or funder hours.
          </p>
        </Panel>
      </div>
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
        soft
        badge="No awarded grants yet"
        badgeTone="setup"
        title="Mark a grant as awarded to generate a report"
        description="Post-grant reports stay blank until Grants tracks an awarded application — never DEMO grant dollars."
      />
    );
  }
  return (
    <Panel id="grant-report-eligible">
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
        soft
        title="No reports generated yet"
        description="Generate a report for an awarded grant above — never invent DEMO grant dollars."
      />
    );
  }
  return (
    <Panel id="grant-report-list">
      <h2 style={{ marginTop: 0 }}>Generated reports</h2>
      <div style={{ display: "grid", gap: 16 }}>
        {view.reports.map((report) => (
          <article key={report.id} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{report.grantName}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {report.funder ? `${report.funder} · ` : ""}
                  {report.seasonYear} · Awarded ${report.amountAwardedUsd.toLocaleString()} · Season expenses
                  (org-wide, not grant-attributed) ${report.totalSpendUsd.toLocaleString()} ·{" "}
                  {report.outreachCount} outreach message(s)
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
                Outreach:{" "}
                {report.outreachByKind
                  .map((line) => `${line.count} ${outreachKindLabel(line.kind).toLowerCase()}`)
                  .join(", ")}
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
