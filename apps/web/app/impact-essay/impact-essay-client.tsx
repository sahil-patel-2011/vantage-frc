"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { AWARD_LABEL, IMPACT_ESSAY_AWARDS, awardLabel } from "../../lib/impact-essay";
import type { ImpactEssayView } from "../../lib/impact-essay/compute-impact-essay";
import {
  IMPACT_ESSAY_RELATED_INCLUDE,
  classifyImpactEssayShell,
  formatImpactEssayHours,
  formatImpactEssayMetric,
  impactEssayNextActions,
  impactEssayRelatedLinks,
  impactEssayShellCopy,
  shouldShowImpactEssaySummaryTiles,
  type ImpactEssayNextAction,
  type ImpactEssayShellKind,
} from "../../lib/impact-essay/impact-essay-related";
import type { ImpactEssayAward } from "../../lib/impact-essay/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./impact-essay.css";

type LiveView = Extract<ImpactEssayView, { status: "live" }>;

function ImpactEssayRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = impactEssayRelatedLinks(orgId, {
    include: [...IMPACT_ESSAY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related impact-essay-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function ImpactEssayNextActionsPanel({ actions }: { actions: ImpactEssayNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions impact-essay-next-actions"
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ImpactEssayShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ImpactEssayShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = impactEssayNextActions({ orgId, shell });
  const copy = impactEssayShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "impact-essay", orgId);
  const impactHref = hubHref("/business", "impact", orgId);
  const awardsHref = hubHref("/business", "evidence", orgId);
  const writerHref = hubHref("/ai", "writer", orgId);

  return (
    <main className="module-page impact-essay-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Impact Essay"}
          </>
        }
        title="FIRST Impact Essay Generator"
        description={description}
      >
        <ImpactEssayRelatedStrip orgId={orgId} />
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
                ? "No grounded records"
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
            <a className="app-button" href={impactHref}>
              Open Community Impact
            </a>
            <a className="app-button secondary" href={awardsHref}>
              Open Awards
            </a>
            <a className="app-button secondary" href={writerHref}>
              Open Writer
            </a>
          </>
        ) : null}
      </EmptyState>
      <ImpactEssayNextActionsPanel actions={actions} />
    </main>
  );
}

export default function ImpactEssayClient() {
  const [view, setView] = useState<ImpactEssayView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [award, setAward] = useState<ImpactEssayAward>("impact");

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/impact-essay${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ImpactEssayView | { error?: string };
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
  const hasGroundedData = view?.status === "live" ? view.facts.hasGroundedData : false;
  const draftCount = view?.status === "live" ? view.drafts.length : 0;
  const outreachCount = view?.status === "live" ? view.facts.outreachActivities.length : 0;
  const peopleReached = view?.status === "live" ? view.facts.totalPeopleReached : 0;
  const outreachHours = view?.status === "live" ? view.facts.totalOutreachHours : 0;
  const buildHours = view?.status === "live" ? view.facts.buildHours.totalHours : 0;
  const sponsorCount = view?.status === "live" ? view.facts.sponsors.length : 0;
  const eventCount = view?.status === "live" ? view.facts.events.length : 0;

  const shell = classifyImpactEssayShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    hasGroundedData,
  });
  const shellCopy = impactEssayShellCopy(shell);
  const nextActions = impactEssayNextActions({
    orgId,
    shell,
    hasGroundedData,
    draftCount,
    outreachCount,
  });
  const relatedLinks = impactEssayRelatedLinks(orgId, {
    include: [...IMPACT_ESSAY_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "impact-essay", orgId);
  const impactHref = hubHref("/business", "impact", orgId);
  const awardsHref = hubHref("/business", "evidence", orgId);
  const writerHref = hubHref("/ai", "writer", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/impact-essay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ImpactEssayView | { error?: string; code?: string };
        if (!response.ok || !("status" in data)) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return;
          }
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
    return <ImpactEssayShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <ImpactEssayShell
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
      <ImpactEssayShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
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
        ) : null}
      </ImpactEssayShell>
    );
  }

  if (view?.status !== "live") {
    return <ImpactEssayShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page impact-essay-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Impact Essay"}
          </>
        }
        title="FIRST Impact Essay Generator"
        description="Draft the Impact and Engineering Inspiration essays strictly from your logged outreach, hours, sponsors, and events — every claim cites a real record. Cross-check Community Impact, Awards, and Writer."
      >
        <div className="impact-essay-header-actions">
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
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <ImpactEssayNextActionsPanel actions={nextActions} />

      {shouldShowImpactEssaySummaryTiles(hasGroundedData) ? (
        <section className="impact-essay-stats" aria-label="Grounded record counts">
          <div>
            <strong>{formatImpactEssayMetric(outreachCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Outreach activities
            </span>
          </div>
          <div>
            <strong>{formatImpactEssayMetric(peopleReached, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              People reached
            </span>
          </div>
          <div>
            <strong>{formatImpactEssayHours(outreachHours, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Outreach hours
            </span>
          </div>
          <div>
            <strong>{formatImpactEssayHours(buildHours, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Build/shop hours
            </span>
          </div>
          <div>
            <strong>{formatImpactEssayMetric(sponsorCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Active sponsors
            </span>
          </div>
          <div>
            <strong>{formatImpactEssayMetric(eventCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Team events
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No grounded records"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={impactHref}>
            Open Community Impact
          </a>
          <a className="app-button secondary" href={awardsHref}>
            Open Awards
          </a>
          <a className="app-button secondary" href={writerHref}>
            Open Writer
          </a>
        </EmptyState>
      ) : null}

      <div className="impact-essay-layout">
        <GenerateForm busy={busy} award={award} setAward={setAward} mutate={mutate} hasData={hasGroundedData} />
        <DraftsList view={view} busy={busy} mutate={mutate} />
        <Panel className="impact-essay-tip" aria-label="Impact Essay tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep outreach facts in <a href={impactHref}>Community Impact</a>, upload packets in{" "}
            <a href={awardsHref}>Awards</a>, and pair language in <a href={writerHref}>Writer</a>.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function GenerateForm({
  busy,
  award,
  setAward,
  mutate,
  hasData,
}: {
  busy: boolean;
  award: ImpactEssayAward;
  setAward: (award: ImpactEssayAward) => void;
  mutate: (payload: Record<string, unknown>) => void;
  hasData: boolean;
}) {
  return (
    <Panel
      id="impact-essay-generate"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ action: "generate-draft", award });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Generate a draft</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Composition cites only outreach, hours, sponsors, and events your team logged for this season.
      </p>
      <label className="app-muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Award
        <select value={award} onChange={(event) => setAward(event.target.value as ImpactEssayAward)}>
          {IMPACT_ESSAY_AWARDS.map((value) => (
            <option key={value} value={value}>
              {AWARD_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="submit" className="app-button" disabled={busy || !hasData}>
          Generate essay draft
        </button>
        {!hasData ? (
          <span className="app-muted" style={{ marginLeft: 10 }}>
            Log at least one real record to enable generation.
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function DraftsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.drafts.length === 0) {
    return (
      <EmptyState
        soft
        badge="No drafts yet"
        badgeTone="setup"
        title="No essay drafts generated for this season"
        description="Generate a draft above once you have logged outreach, hours, sponsor, or event records."
      />
    );
  }
  return (
    <Panel id="impact-essay-drafts">
      <h2 style={{ marginTop: 0 }}>Drafts</h2>
      <ul className="impact-essay-drafts">
        {view.drafts.map((draft) => (
          <li key={draft.id} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{awardLabel(draft.award)}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {draft.createdAt} · {draft.wordCount} words · {draft.citations.length} cited record(s)
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Delete this draft?")) {
                    mutate({ action: "delete-draft", draftId: draft.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{draft.essayText}</p>
            {draft.citations.length > 0 ? (
              <div>
                <strong className="app-muted">Citations</strong>
                <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {draft.citations.map((citation, index) => (
                    <li key={`${draft.id}-${citation.id}-${index}`}>
                      <small className="app-muted">{citation.label}</small>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
