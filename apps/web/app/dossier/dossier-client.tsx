"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EmptyState, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
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
import { fetchProductSession } from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./dossier.css";

function isDossierView(value: unknown): value is DossierView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "empty" || status === "live";
}

async function persistDossierSnapshot(
  orgHint: string,
  teamHint: string,
  data: DossierView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim()
      ? data.orgId
      : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("dossier", cacheOrg, data, teamHint);
    if (!orgHint) await putFeatureSnapshot("dossier", "_", data, teamHint);
  } catch {
    // Live dossier already painted; IndexedDB is best-effort.
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  identity: "Identity",
  season_epa: "Season EPA",
  event: "Event metrics",
  record: "Event record",
  scout: "Org scout",
};

function DossierRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = dossierRelatedLinks(orgId, {
    include: [...DOSSIER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related dossier-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
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
  const setup = shell === "setup" ? dossierSetupSteps(orgId)[0] : null;
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
            ? "Needs setup"
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
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {shell === "error" && onRetry && failure?.showRetry !== false ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {!failure?.primary && setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={teamDataHref}>
            Sync season metrics
          </Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <DossierNextActionsPanel actions={actions} /> : null}
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<DossierView | null>(null);
  viewRef.current = view;

  const load = useCallback(
    (team?: string, resolvedOrg?: string | null) => {
      void (async () => {
        const params = new URLSearchParams();
        const activeOrg =
          (resolvedOrg ?? orgId ?? new URLSearchParams(window.location.search).get("orgId") ?? "").trim();
        const teamValue = (team ?? new URLSearchParams(window.location.search).get("team") ?? "").trim();
        let hadCache = Boolean(viewRef.current);
        try {
          const cached = await getFeatureSnapshot<DossierView>(
            "dossier",
            activeOrg || "_",
            teamValue,
          );
          if (!viewRef.current && cached?.data && isDossierView(cached.data)) {
            setView(cached.data);
            if (cached.data.orgId) setOrgId(cached.data.orgId);
            setFromCache(true);
            setCachedAt(cached.cachedAt);
            setLoading(false);
            hadCache = true;
          }
        } catch {
          // IndexedDB missing or blocked; live fetch still runs.
        }
        setFetchFailed(false);
        setError("");
        setErrorStatus(null);
        if (!hadCache) setLoading(true);
        if (activeOrg) params.set("orgId", activeOrg);
        if (teamValue) params.set("team", teamValue);
        try {
          const response = await fetch(`/api/dossier?${params.toString()}`, {
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          });
          const data = (await response.json()) as DossierView | { error?: string };
          if (!response.ok || !isDossierView(data)) {
            if (hadCache || viewRef.current) {
              setFromCache(true);
              setError("Could not refresh the dossier. Showing the last copy on this device.");
              setFetchFailed(false);
            } else {
              setError("error" in data && data.error ? data.error : "Could not load dossier");
              setErrorStatus(response.status);
              setFetchFailed(true);
              setView(null);
            }
            setLoading(false);
            return;
          }
          setView(data);
          if (data.orgId) setOrgId(data.orgId);
          setFromCache(false);
          setCachedAt(null);
          await persistDossierSnapshot(activeOrg, teamValue, data);
        } catch {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh the dossier. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
            setView(null);
          }
        } finally {
          setLoading(false);
        }
      })();
    },
    [orgId],
  );

  useEffect(() => {
    const fromUrl = readOrgIdFromSearch(window.location.search);
    const teamFromUrl = new URLSearchParams(window.location.search).get("team");
    if (teamFromUrl) setQuery(teamFromUrl);
    if (fromUrl) {
      setOrgId(fromUrl);
      load(teamFromUrl ?? undefined, fromUrl);
      return;
    }
    void fetchProductSession().then((data) => {
      const resolved = data?.orgId || null;
      setOrgId(resolved);
      load(teamFromUrl ?? undefined, resolved);
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
      >
        <OfflineBanner feature="Dossier" fromCache={fromCache} cachedAt={cachedAt} />
      </DossierShell>
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

      <OfflineBanner feature="Dossier" fromCache={fromCache} cachedAt={cachedAt} />

      <DataSourceDegradedBanner health={view?.dataSourceHealth} />

      <Panel as="form" className="dossier-search-panel dossier-panel" onSubmit={onSearch}>
        <FormRow
          label="Team number"
          hint={
            <>
              <a href={intelHref}>Research</a>
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
            <Button variant="primary" type="submit">
              Load dossier
            </Button>
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
            <Button as="a" variant="primary" href={withOrgHref("/team/data", resolvedOrgId)}>
              Sync season metrics
            </Button>
          </EmptyState>
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
