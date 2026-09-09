"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  ProgressMeter,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { knowledgeGapSubjectLabel } from "../../lib/knowledge-gap";
import type { KnowledgeGapView } from "../../lib/knowledge-gap/compute-knowledge-gap";
import type { KnowledgeGapItem, KnowledgeGapStatus, KnowledgeGapSubjectKind } from "../../lib/knowledge-gap/types";
import {
  KNOWLEDGE_GAP_RELATED_INCLUDE,
  classifyKnowledgeGapShell,
  formatKnowledgeGapMetric,
  knowledgeGapNextActions,
  knowledgeGapRelatedLinks,
  knowledgeGapSetupSteps,
  knowledgeGapShellCopy,
  shouldShowKnowledgeGapSummaryTiles,
  type KnowledgeGapNextAction,
  type KnowledgeGapShellKind,
} from "../../lib/knowledge-gap/knowledge-gap-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./knowledge-gap.css";

const STATUS_TONE: Record<KnowledgeGapStatus, BadgeTone> = {
  open: "setup",
  drafted: "good",
  dismissed: "neutral",
};

const STATUS_LABEL: Record<KnowledgeGapStatus, string> = {
  open: "Undocumented",
  drafted: "Stub drafted",
  dismissed: "Dismissed",
};

const SUBJECT_TONE: Record<KnowledgeGapSubjectKind, BadgeTone> = {
  subsystem: "neutral",
  decision: "setup",
  event: "good",
};

type LiveView = Extract<KnowledgeGapView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = knowledgeGapRelatedLinks(orgId, {
    include: [...KNOWLEDGE_GAP_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related kg-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: KnowledgeGapNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions kg-next-actions" aria-label="Next actions">
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

function GapShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: KnowledgeGapShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = knowledgeGapNextActions({ orgId, shell });
  const copy = knowledgeGapShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "knowledge-gap", orgId);
  const steps = shell === "setup" ? knowledgeGapSetupSteps(orgId) : [];

  return (
    <main className="module-page kg-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Knowledge-gap detective"}
          </>
        }
        title="Knowledge-gap detective"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading knowledge-gap scan">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href="#knowledge-gap-scan">
                Run scan
              </a>
              <a className="app-button secondary" href={hubHref("/team", "knowledge", orgId)}>
                Open Knowledge
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="kg-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="kg-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted kg-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function KnowledgeGapClient() {
  const [view, setView] = useState<KnowledgeGapView | null>(null);
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
    void fetch(`/api/knowledge-gap${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as KnowledgeGapView | { error?: string };
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
  const hasScan = view?.status === "live" ? view.scan != null : false;
  const itemCount = view?.status === "live" ? view.items.length : 0;
  const openCount =
    view?.status === "live" ? view.items.filter((item) => item.status === "open").length : 0;

  const shell = classifyKnowledgeGapShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    hasScan,
    itemCount,
  });
  const shellCopy = knowledgeGapShellCopy(shell);
  const nextActions = knowledgeGapNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    hasScan,
    itemCount,
  });
  const teamHref = hubWorkbenchHref("team", "knowledge-gap", orgId);
  const showTiles = shouldShowKnowledgeGapSummaryTiles(itemCount, hasScan);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/knowledge-gap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as KnowledgeGapView | { error?: string };
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
    return <GapShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <GapShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <GapShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page kg-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Knowledge-gap detective"}
          </>
        }
        title="Knowledge-gap detective"
        description="Lists undocumented work from the real wiki vs Work (to-dos, build tasks, milestones) — never invented gaps. Cross-check Knowledge and Work."
      >
        <div className="kg-header-actions">
          <RelatedStrip orgId={orgId} />
          {view.seasons.length > 0 ? (
            <label className="app-muted kg-filter">
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
          <a className="app-button secondary" href={hubHref("/team", "knowledge", orgId)}>
            Open wiki
          </a>
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="kg-panel">
          <div className="kg-stats">
            <StatTile label="Open gaps" value={formatKnowledgeGapMetric(openCount, loaded)} />
            <StatTile label="Tracked work" value={formatKnowledgeGapMetric(itemCount, loaded)} />
            <StatTile
              label="Coverage"
              value={
                view.scan
                  ? `${Math.round(view.scan.coverageScore * 100)}%`
                  : "—"
              }
            />
          </div>
        </Panel>
      ) : null}

      <ScanPanel view={view} busy={busy} mutate={mutate} season={season ?? view.seasonYear} />
      {view.scan == null ? (
        <EmptyState
          soft
          badge="No scan yet"
          badgeTone="setup"
          title="Run your first scan"
          description="Diffs real work items against your knowledge wiki."
        />
      ) : view.items.length === 0 ? (
        <EmptyWorkState
          tracked={view.scan.subsystemCount + view.scan.decisionCount + view.scan.eventCount}
        />
      ) : (
        <GapList items={view.items} busy={busy} mutate={mutate} />
      )}
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function EmptyWorkState({ tracked }: { tracked: number }) {
  if (tracked === 0) {
    return (
      <EmptyState
        soft
        badge="No work items"
        badgeTone="setup"
        title="Nothing to scan yet"
        description="No work items to check — add to-dos, build tasks, or milestones before gaps can appear. Never invented."
      />
    );
  }
  return (
    <EmptyState
      soft
      badge="Fully documented"
      badgeTone="good"
      title="No gaps found for this season"
      description="Every tracked work item has wiki coverage."
    />
  );
}

function ScanPanel({
  view,
  busy,
  mutate,
  season,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  season: number;
}) {
  const scan = view.scan;
  return (
    <Panel id="knowledge-gap-scan" className="kg-panel">
      <header className="kg-scan-header">
        <div>
          <h2>Coverage — {season}</h2>
          {scan ? (
            <small className="app-muted">
              {scan.decisionCount} to-do(s) · {scan.subsystemCount} build task(s) · {scan.eventCount} milestone(s)
              · {scan.pageCount} wiki page(s) · scanned {new Date(scan.createdAt).toLocaleString()}
            </small>
          ) : (
            <small className="app-muted">No scan has been run for {season} yet.</small>
          )}
        </div>
        <div className="kg-scan-actions">
          {scan ? (
            <div className="kg-progress">
              <ProgressMeter
                value={Math.round(scan.coverageScore * 100)}
                target={100}
                unit="%"
                label="Coverage"
              />
            </div>
          ) : null}
          <button type="button" className="app-button" disabled={busy} onClick={() => mutate({ action: "run-scan" })}>
            {scan ? "Re-scan" : "Run scan"}
          </button>
        </div>
      </header>
      {scan ? <p className="app-muted kg-tip">{scan.summary}</p> : null}
    </Panel>
  );
}

function GapList({
  items,
  busy,
  mutate,
}: {
  items: KnowledgeGapItem[];
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel id="knowledge-gap-items" className="kg-panel">
      <h2>Undocumented work</h2>
      <ul className="kg-item-list">
        {items.map((item) => (
          <li key={item.id} className="app-card soft-panel kg-item-card">
            <header className="kg-item-header">
              <div>
                <Badge tone={SUBJECT_TONE[item.subjectKind]}>{knowledgeGapSubjectLabel(item.subjectKind)}</Badge>{" "}
                <Badge tone={STATUS_TONE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                <strong className="kg-item-name">{item.subjectRef}</strong>
                <small className="app-muted">Season {item.seasonYear}</small>
              </div>
              {item.status === "open" ? (
                <div className="kg-item-actions">
                  {item.href ? (
                    <a className="app-button secondary" href={item.href}>
                      Open work
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    onClick={() => mutate({ action: "draft-stub-page", itemId: item.id })}
                  >
                    Draft stub page
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "dismiss-item", itemId: item.id })}
                  >
                    Dismiss
                  </button>
                </div>
              ) : item.status === "drafted" && item.draftPageId ? (
                <a
                  className="app-button secondary"
                  href={`/knowledge?pageId=${encodeURIComponent(item.draftPageId)}`}
                >
                  Open stub
                </a>
              ) : null}
            </header>
            <p className="app-muted kg-tip">{item.reason}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
