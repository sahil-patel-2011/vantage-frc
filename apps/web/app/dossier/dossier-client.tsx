"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import type { DossierView } from "../../lib/dossier/compute-dossier";
import {
  DOSSIER_RELATED_INCLUDE,
  classifyDossierShell,
  dossierNextActions,
  dossierRelatedLinks,
  dossierSetupSteps,
  dossierShellCopy,
  formatDossierMetric,
  shouldShowDossierSummaryTiles,
  type DossierNextAction,
  type DossierShellKind,
} from "../../lib/dossier/dossier-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./dossier.css";

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identity",
  season_epa: "Season EPA",
  event: "Event metrics",
  record: "Event record",
  scout: "Org scout",
};

type Me = { orgId?: string | null };

function DossierRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = dossierRelatedLinks(orgId, {
    include: [...DOSSIER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related dossier-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function DossierNextActionsPanel({ actions }: { actions: DossierNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions dossier-next-actions"
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

function DossierShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: DossierShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = dossierNextActions({ orgId, shell });
  const copy = dossierShellCopy(shell);
  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus ?? null,
            message: error ?? null,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error ?? null,
          },
        )
      : null;
  const steps = shell === "setup" ? dossierSetupSteps(orgId) : [];
  const teamDataHref = withOrgHref("/team/data", orgId);

  return (
    <main className="module-page dossier-page dossier-workbench soft-gate">
      <PageHeader
        breadcrumbs="Competition / Dossier"
        title="Season team dossier"
        description="Fact cards only — TBA identity, Statbotics/TBA EPA and records, and org scout notes."
      >
        <DossierRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="dossier-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : failure
              ? failure.kind === "auth"
                ? "Signed out"
                : failure.kind === "forbidden"
                  ? "No access"
                  : "Unavailable"
              : shell === "empty"
                ? "No facts yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : (error ?? copy.description)}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry && failure?.showRetry !== false ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? teamDataHref : "/workspace"}>
            {orgId ? "Sync Team Data" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <a className="app-button" href={teamDataHref}>
            Sync season metrics
          </a>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="dossier-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="dossier-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <DossierNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function DossierClient() {
  const [view, setView] = useState<DossierView | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  const load = useCallback(
    (team?: string, resolvedOrg?: string | null) => {
      setFetchFailed(false);
      setError("");
      setErrorStatus(null);
      setLoading(true);
      const params = new URLSearchParams();
      const activeOrg =
        resolvedOrg ?? orgId ?? new URLSearchParams(window.location.search).get("orgId");
      if (activeOrg) params.set("orgId", activeOrg);
      const teamValue = team ?? new URLSearchParams(window.location.search).get("team");
      if (teamValue) params.set("team", teamValue);
      void fetch(`/api/dossier?${params.toString()}`)
        .then(async (response) => {
          const data = (await response.json()) as DossierView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Could not load dossier");
            setErrorStatus(response.status);
            setFetchFailed(true);
            setView(null);
            return;
          }
          setView(data);
          if (data.orgId) setOrgId(data.orgId);
        })
        .catch(() => {
          setFetchFailed(true);
          setView(null);
        })
        .finally(() => setLoading(false));
    },
    [orgId],
  );

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("orgId");
    const teamFromUrl = new URLSearchParams(window.location.search).get("team");
    if (teamFromUrl) setQuery(teamFromUrl);
    void fetch("/api/me")
      .then(async (r) => (r.ok ? ((await r.json()) as Me) : null))
      .then((data) => {
        const resolved = fromUrl || data?.orgId || null;
        setOrgId(resolved);
        load(teamFromUrl ?? undefined, resolved);
      })
      .catch(() => {
        setOrgId(fromUrl);
        load(teamFromUrl ?? undefined, fromUrl);
      });
    // Initial load only.
     
  }, []);

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!/^\d+$/.test(trimmed)) {
      setError("Enter a numeric FRC team number");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("team", trimmed);
    if (orgId) url.searchParams.set("orgId", orgId);
    window.history.replaceState({}, "", url.toString());
    load(trimmed);
  }

  const cardCount = view?.status === "live" ? view.cards.length : 0;
  const shell = classifyDossierShell({
    loading,
    fetchFailed,
    status: view?.status ?? (!orgId && !loading ? "setup_required" : null),
    orgId: view?.orgId ?? orgId,
    teamNumber: view && "teamNumber" in view ? view.teamNumber : null,
    cardCount,
  });

  // Full Soft-UI shells when the surface cannot cite facts yet.
  if (shell === "loading" || shell === "error" || shell === "setup") {
    return (
      <DossierShell
        orgId={view?.orgId ?? orgId}
        shell={shell}
        error={
          shell === "error"
            ? error || "Could not load team dossier."
            : shell === "setup" && view?.status === "setup_required"
              ? `${view.message} Facts stay blank until real TBA/Statbotics rows exist.`
              : undefined
        }
        errorStatus={errorStatus}
        onRetry={
          shell === "error"
            ? () => {
                load();
              }
            : undefined
        }
      />
    );
  }

  const resolvedOrgId = view?.orgId ?? orgId;
  const strategyHref = hubHref("/competition", "strategy", resolvedOrgId);
  const scoutingHref = hubHref("/competition", "scouting", resolvedOrgId);
  const pickDeskHref = withOrgHref("/strategy?tab=picks", resolvedOrgId);
  const intelHref = withOrgHref("/intel", resolvedOrgId);
  const showTiles = shouldShowDossierSummaryTiles(cardCount);
  const readyActions = dossierNextActions({
    orgId: resolvedOrgId,
    shell: view?.status === "live" ? "ready" : "empty",
    teamNumber: view && "teamNumber" in view ? view.teamNumber : null,
    cardCount,
  });
  const emptyCopy = dossierShellCopy("empty");

  return (
    <main className="module-page dossier-page dossier-workbench">
      <PageHeader
        breadcrumbs="Competition / Dossier"
        title="Season team dossier"
        description="Fact cards only — TBA identity, Statbotics/TBA EPA and records, and org scout notes. Every card carries a citation."
      >
        {/* The strip already is Strategy · Scouting · Pick desk. The row that
            used to sit beside it here was the same three hrefs with the same
            three labels, in the same header. */}
        <div className="dossier-heading">
          <DossierRelatedStrip orgId={resolvedOrgId} />
        </div>
      </PageHeader>

      <DataSourceDegradedBanner health={view?.dataSourceHealth} />

      <Panel as="form" className="dossier-search-panel dossier-panel" onSubmit={onSearch}>
        <FormRow
          label="Team number"
          hint={
            <>
              <a href={intelHref}>Intel</a>
              {" · "}
              <a href={strategyHref}>Strategy</a>
              {" · "}
              <a href={scoutingHref}>Scouting</a>
              {" · "}
              <a href={pickDeskHref}>Pick desk</a>
            </>
          }
        >
          <div className="dossier-search-row">
            <input
              id="dossier-team"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                view && "teamNumber" in view && view.teamNumber
                  ? String(view.teamNumber)
                  : "e.g. 2337"
              }
              inputMode="numeric"
            />
            <button type="submit" className="app-button">
              Load dossier
            </button>
          </div>
        </FormRow>
      </Panel>

      {error ? (
        <p className="edc-banner error" role="alert">
          {error}
        </p>
      ) : null}

      {view?.status === "empty" || (view?.status !== "live" && shell === "empty") ? (
        <>
          <EmptyState
            soft
            className="dossier-empty"
            badge="No facts yet"
            badgeTone="setup"
            title={view?.status === "empty" ? view.message : emptyCopy.title}
            description={
              view?.status === "empty"
                ? `${view.message} Cards stay blank until real rows exist.`
                : emptyCopy.description
            }
          >
            {/* One action: the thing that actually fills this page. Strategy,
                Scouting, and Pick desk are in the strip at the top and again in
                Setup steps and Next actions directly below, each with the
                reason you would go there. */}
            <a className="app-button" href={withOrgHref("/team/data", resolvedOrgId)}>
              Sync season metrics
            </a>
          </EmptyState>
          {view?.status === "empty" || view?.status === "setup_required" ? (
            <Panel className="dossier-panel" aria-label="Setup steps">
              <header>
                <h2>Setup steps</h2>
                <p className="app-muted">Finish these once and this page fills in.</p>
              </header>
              <ol className="dossier-setup-steps">
                {view.steps.map((step) => (
                  <li key={step.id} className={step.done ? "done" : undefined}>
                    <div>
                      <strong>{step.label}</strong>
                      <p className="app-muted">{step.detail}</p>
                    </div>
                    {step.done ? (
                      <em className="app-muted">Done</em>
                    ) : (
                      <a className="app-button secondary" href={step.href}>
                        Open
                      </a>
                    )}
                  </li>
                ))}
              </ol>
              {"referenceAccess" in view && !view.referenceAccess.statbotics.cacheHasMetrics ? (
                <p className="app-muted">
                  Statbotics cache: empty ({view.referenceAccess.statbotics.eventMetricRows} event /{" "}
                  {view.referenceAccess.statbotics.yearMetricRows} year rows). Public API — no key
                  required.
                </p>
              ) : null}
            </Panel>
          ) : null}
          <DossierNextActionsPanel actions={readyActions} />
        </>
      ) : view?.status === "live" ? (
        <>
          {showTiles ? (
            <div className="dossier-kpis" aria-label="Dossier counts">
              <article>
                <strong>{formatDossierMetric(cardCount, true)}</strong>
                <small>cited fact cards</small>
              </article>
              <article>
                <strong>{formatDossierMetric(view.teamNumber, true)}</strong>
                <small>team number</small>
              </article>
              <article>
                <strong>
                  {view.referenceAccess.statbotics.cacheHasMetrics ? "Cached" : "Empty"}
                </strong>
                <small>Statbotics EPA</small>
              </article>
            </div>
          ) : null}
          <LiveDossier view={view} />
          <DossierNextActionsPanel actions={readyActions} />
        </>
      ) : null}
    </main>
  );
}

function LiveDossier({ view }: { view: Extract<DossierView, { status: "live" }> }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof view.cards>();
    for (const card of view.cards) {
      const list = map.get(card.category) ?? [];
      list.push(card);
      map.set(card.category, list);
    }
    return [...map.entries()];
  }, [view.cards]);

  return (
    <section className="dossier-live" aria-label="Season dossier facts">
      <Panel className="dossier-hero-card dossier-panel">
        <header className="dossier-hero">
          <div>
            <span className="app-badge">Team {view.teamNumber}</span>
            <h2>{view.nickname ?? view.name ?? view.teamKey}</h2>
            <p className="app-muted">
              {formatDossierMetric(view.cards.length, true)} cited fact cards · updated{" "}
              {new Date(view.computedAt).toLocaleString()}
            </p>
          </div>
          <div className="strategy-provenance">
            <span className="app-badge">
              Statbotics {view.referenceAccess.statbotics.cacheHasMetrics ? "cached" : "empty"}
            </span>
            <span className="app-badge">
              {view.referenceAccess.tbaConfigured ? "TBA ready" : "TBA missing"}
            </span>
          </div>
        </header>
      </Panel>
      {groups.map(([category, cards]) => (
        <section key={category} className="dossier-group" aria-label={CATEGORY_LABEL[category] ?? category}>
          <h3>{CATEGORY_LABEL[category] ?? category}</h3>
          <ul className="dossier-fact-grid">
            {cards.map((card) => (
              <li key={card.id} className="dossier-fact-card soft-panel">
                <span className="app-badge">{card.citation.source}</span>
                <strong>{card.title}</strong>
                <p>{card.value}</p>
                <small className="app-muted">
                  {card.citation.detail}
                  {card.citation.syncedAt
                    ? ` · synced ${new Date(card.citation.syncedAt).toLocaleDateString()}`
                    : ""}
                  {card.citation.eventKey ? ` · ${card.citation.eventKey}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
