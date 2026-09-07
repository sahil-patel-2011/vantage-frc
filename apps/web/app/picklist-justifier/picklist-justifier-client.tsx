"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
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
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./picklist-justifier.css";

type LiveView = Extract<PicklistJustifierView, { status: "live" }>;

function JustifierRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = picklistJustifierRelatedLinks(orgId, {
    include: [...PICKLIST_JUSTIFIER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related picklist-justifier-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
        <p className="app-muted">Strategy and Scouting — never DEMO pick rationales.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
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
  const collabHref = hubHref("/competition", "picklist-collab", orgId);

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
            <a className="app-button" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={collabHref}>
              Open Collaborative Pick List
            </a>
          </>
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
  // Honest badge for the latest render: "AI" only when a model produced it.
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);

  const load = useCallback((pickListIdOverride?: string) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (pickListIdOverride) query.set("pickListId", pickListIdOverride);
    void fetch(`/api/picklist-justifier${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as PicklistJustifierView | { error?: string };
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
  const collabHref = hubHref("/competition", "picklist-collab", orgId);
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
        });
        const data = (await response.json()) as PicklistJustifierView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <JustifierShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <JustifierShell
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
      <JustifierShell
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
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </JustifierShell>
    );
  }

  if (view?.status !== "live") {
    return <JustifierShell description={shellCopy.description} orgId={orgId} shell="setup" />;
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
        description="Source-cited rationale for every pick-list slot, and a contradiction guard that flags picks leaning on scouting your own TBA match record disagrees with. Never DEMO rationales. Cross-check Strategy, Collaborative Pick List, and Scouting."
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

      <RenderAttribution receipt={renderReceipt} feature="picklist-justifier" />

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
          <a className="app-button" href={strategyHref}>
            Open Strategy
          </a>
          <a className="app-button secondary" href={collabHref}>
            Open Collaborative Pick List
          </a>
          <a className="app-button secondary" href={scoutingHref}>
            Open Scouting
          </a>
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
              <a href={draftHref}>Alliance board</a> — never invent DEMO win rates.
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
        <button
          type="button"
          className="app-button"
          disabled={busy || !view.selectedPickListId}
          onClick={() => view.selectedPickListId && mutate({ action: "generate", pickListId: view.selectedPickListId })}
        >
          {busy ? "Generating…" : "Generate justifications"}
        </button>
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
        description="Add teams to the pick list under Strategy, then come back to generate justifications — never DEMO slots."
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
