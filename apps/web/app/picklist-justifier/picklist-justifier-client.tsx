"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import type { PicklistJustifierView } from "../../lib/picklist-justifier/compute-picklist-justifier";
import { picklistTierLabel } from "../../lib/picklist-justifier";
import {
  PICKLIST_JUSTIFIER_RELATED_INCLUDE,
  classifyPicklistJustifierShell,
  formatPicklistJustifierMetric,
  picklistJustifierNextActions,
  picklistJustifierRelatedLinks,
  picklistJustifierShellCopy,
  shouldShowPicklistJustifierSummaryTiles,
  type PicklistJustifierNextAction,
  type PicklistJustifierShellKind,
} from "../../lib/picklist-justifier/picklist-justifier-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./picklist-justifier.css";

function isPicklistJustifierView(value: unknown): value is PicklistJustifierView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistPicklistJustifierSnapshot(
  orgHint: string,
  listHint: string,
  data: PicklistJustifierView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  const listKey =
    data.status === "live" && data.selectedPickListId ? data.selectedPickListId : listHint;
  try {
    await putFeatureSnapshot("picklist-justifier", cacheOrg, data, listKey);
    await putFeatureSnapshot("picklist-justifier", cacheOrg, data);
    if (!orgHint) {
      await putFeatureSnapshot("picklist-justifier", "_", data, listKey);
      await putFeatureSnapshot("picklist-justifier", "_", data);
    }
  } catch {
    // Live justifier already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<PicklistJustifierView, { status: "live" }>;

function JustifierRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = picklistJustifierRelatedLinks(orgId, {
    include: [...PICKLIST_JUSTIFIER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related picklist-justifier-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function JustifierNextActionsPanel({ actions }: { actions: PicklistJustifierNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions picklist-justifier-next-actions"
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

function JustifierShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: PicklistJustifierShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = picklistJustifierNextActions({ orgId, shell });
  const copy = picklistJustifierShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "picklist-justifier", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);

  return (
    <main className="module-page picklist-justifier-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Pick-list Justifier"}
          </>
        }
        title="Pick-list Auto-Justifier"
        description={description}
      >
        <JustifierRelatedStrip orgId={orgId} />
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
                ? "No pick lists yet"
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
          <Button as="a" variant="primary" href={strategyHref}>Open Strategy</Button>
        ) : null}
      </EmptyState>
      <JustifierNextActionsPanel actions={actions} />
    </main>
  );
}

export default function PicklistJustifierClient() {
  const [view, setView] = useState<PicklistJustifierView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PicklistJustifierView | null>(null);
  viewRef.current = view;

  const load = useCallback((pickListIdOverride?: string) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const listHint = pickListIdOverride?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<PicklistJustifierView>(
          "picklist-justifier",
          urlOrg || "_",
          listHint,
        );
        if (!viewRef.current && cached?.data && isPicklistJustifierView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (listHint) query.set("pickListId", listHint);
      try {
        const response = await fetch(
          `/api/picklist-justifier${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as PicklistJustifierView | { error?: string };
        if (!response.ok || !isPicklistJustifierView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Pick-list Justifier. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistPicklistJustifierSnapshot(urlOrg, listHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Pick-list Justifier. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const pickListCount = view?.status === "live" ? view.pickLists.length : 0;
  const slotCount = view?.status === "live" ? view.entries.length : 0;
  const contradictionCount = view?.status === "live" ? view.contradictionCount : 0;

  const shell = classifyPicklistJustifierShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    pickListCount,
  });
  const shellCopy = picklistJustifierShellCopy(shell);
  const nextActions = picklistJustifierNextActions({
    orgId,
    shell,
    pickListCount,
    slotCount,
    contradictionCount,
  });
  const relatedLinks = picklistJustifierRelatedLinks(orgId, {
    include: [...PICKLIST_JUSTIFIER_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "picklist-justifier", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const draftHref = withOrgHref("/strategy/draft", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/picklist-justifier", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as PicklistJustifierView | { error?: string };
        if (!response.ok || !isPicklistJustifierView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistPicklistJustifierSnapshot(orgId, "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <JustifierShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Pick-list Justifier" fromCache={fromCache} cachedAt={cachedAt} />
      </JustifierShell>
    );
  }

  if (shell === "error") {
    return (
      <JustifierShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Pick-list Justifier" fromCache={fromCache} cachedAt={cachedAt} />
      </JustifierShell>
    );
  }

  if (shell === "setup") {
    return (
      <JustifierShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Pick-list Justifier" fromCache={fromCache} cachedAt={cachedAt} />
      </JustifierShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <JustifierShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Pick-list Justifier" fromCache={fromCache} cachedAt={cachedAt} />
      </JustifierShell>
    );
  }

  return (
    <main className="module-page picklist-justifier-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Pick-list Justifier"}
          </>
        }
        title="Pick-list Auto-Justifier"
        description="Source-cited rationale for every pick-list slot, and a contradiction guard that flags picks leaning on scouting your own TBA match record disagrees with. Cross-check Strategy, Collaborative Pick List, and Scouting."
      >
        <div className="picklist-justifier-header-actions">
          {view.pickLists.length > 0 ? (
            <label className="app-muted picklist-justifier-select">
              Pick list
              <select
                value={view.selectedPickListId ?? ""}
                onChange={(event) => load(event.target.value)}
              >
                {view.pickLists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.name} ({pl.eventKey}) · {pl.entryCount} teams
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
      <OfflineBanner feature="Pick-list Justifier" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <JustifierNextActionsPanel actions={nextActions} />

      {shouldShowPicklistJustifierSummaryTiles(pickListCount) ? (
        <section className="picklist-justifier-stats" aria-label="Pick-list Justifier counts">
          <div>
            <strong>{formatPicklistJustifierMetric(pickListCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Pick lists
            </span>
          </div>
          <div>
            <strong>{formatPicklistJustifierMetric(slotCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Slots
            </span>
          </div>
          {contradictionCount > 0 ? (
            <div>
              <strong>{formatPicklistJustifierMetric(contradictionCount, true)}</strong>
              <span className="app-muted" style={{ display: "block" }}>
                Contradictions
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No pick lists yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href={strategyHref}>
            Open Strategy
          </Button>
        </EmptyState>
      ) : (
        <div className="picklist-justifier-layout">
          <SummaryPanel view={view} busy={busy} mutate={mutate} />
          <EntriesList view={view} />
          <Panel className="picklist-justifier-tip" aria-label="Pick-list Justifier tip">
            <span className="eyebrow">Grounding path</span>
            <p className="app-muted" style={{ marginTop: 8 }}>
              Adjust ranks in <a href={strategyHref}>Strategy</a>, deepen{" "}
              <a href={scoutingHref}>Scouting</a>, then carry justified picks to the{" "}
              <a href={draftHref}>Alliance board</a>
            </p>
          </Panel>
        </div>
      )}
    </main>
  );
}

function SummaryPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel id="picklist-justifier-summary" className="picklist-justifier-panel" aria-label="Pick-list justifier summary">
      <header className="picklist-justifier-card-header">
        <div>
          <h2 style={{ margin: 0 }}>{view.eventKey ?? "No event"}</h2>
          <small className="app-muted">
            {view.entries.length} slot{view.entries.length === 1 ? "" : "s"}
            {view.contradictionCount > 0 ? (
              <span className="app-badge demo" style={{ marginLeft: 8 }}>
                {view.contradictionCount} contradiction{view.contradictionCount === 1 ? "" : "s"} flagged
              </span>
            ) : null}
          </small>
        </div>
        <Button variant="primary" type="button" disabled={busy || !view.selectedPickListId} onClick={() => view.selectedPickListId && mutate({ action: "generate", pickListId: view.selectedPickListId })}>
          {busy ? "Generating…" : "Generate justifications"}
        </Button>
      </header>
    </Panel>
  );
}

function EntriesList({ view }: { view: LiveView }) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        soft
        badge="No slots yet"
        badgeTone="setup"
        title="This pick list has no ranked teams"
        description="Add teams to the pick list under Strategy, then come back to generate justifications."
      />
    );
  }
  return (
    <Panel id="picklist-justifier-entries" className="picklist-justifier-panel">
      <ul className="picklist-justifier-list">
        {view.entries.map((entry) => (
          <li key={entry.id} className="app-card soft-panel picklist-justifier-card">
            <div className="picklist-justifier-card-header">
              <div>
                <strong>
                  #{entry.rank} · {entry.teamNumber ? `Team ${entry.teamNumber}` : entry.teamKey}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {picklistTierLabel(entry.tier)}
                  {entry.notes ? ` · ${entry.notes}` : ""}
                </small>
              </div>
              {entry.contradiction?.flagged ? (
                <span className="app-badge demo">Contradiction flagged</span>
              ) : entry.rationale ? (
                <span className="app-badge good">Justified</span>
              ) : (
                <span className="app-badge setup">Not generated yet</span>
              )}
            </div>

            {entry.rationale ? (
              <p style={{ margin: 0 }}>{entry.rationale}</p>
            ) : (
              <p className="app-muted" style={{ margin: 0 }}>
                No rationale generated yet. {entry.tbaAvailable ? "TBA data is available." : "No TBA data yet for this team at this event."}{" "}
                {entry.scoutEntryCount > 0
                  ? `${entry.scoutEntryCount} scout entr${entry.scoutEntryCount === 1 ? "y" : "ies"} logged.`
                  : "No scouting logged yet."}
              </p>
            )}

            {entry.contradiction?.flagged && entry.contradiction.reason ? (
              <p className="telemetry-status" role="alert" style={{ margin: 0 }}>
                {entry.contradiction.reason}
              </p>
            ) : null}

            {entry.sources.length > 0 ? (
              <ul className="picklist-justifier-sources">
                {entry.sources.map((source, index) => (
                  <li key={`${entry.id}-${index}`}>
                    <small className="app-muted">
                      <strong>{source.label}</strong>: {source.detail}
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
