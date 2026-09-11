"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  ProgressMeter,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
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
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
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

function isKnowledgeGapView(value: unknown): value is KnowledgeGapView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function knowledgeGapCacheOrg(data: KnowledgeGapView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistKnowledgeGapSnapshot(
  orgHint: string,
  seasonHint: string,
  data: KnowledgeGapView,
): Promise<void> {
  const cacheOrg = knowledgeGapCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("knowledge-gap", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("knowledge-gap", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Knowledge-gap detective already painted; IndexedDB is best-effort.
  }
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = knowledgeGapRelatedLinks(orgId, {
    include: [...KNOWLEDGE_GAP_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related kg-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
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
  const setup = shell === "setup" ? knowledgeGapSetupSteps(orgId)[0] : null;

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
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href="#knowledge-gap-scan">Run scan</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function KnowledgeGapClient() {
  const [view, setView] = useState<KnowledgeGapView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<KnowledgeGapView | null>(null);
  viewRef.current = view;

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<KnowledgeGapView>(
          "knowledge-gap",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isKnowledgeGapView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
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
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(
          `/api/knowledge-gap${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as KnowledgeGapView | { error?: string };
        if (!response.ok || !isKnowledgeGapView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Knowledge-gap detective. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistKnowledgeGapSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Knowledge-gap detective. Showing the last copy on this device.");
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as KnowledgeGapView | { error?: string };
        if (!response.ok || !isKnowledgeGapView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistKnowledgeGapSnapshot(orgId, season != null ? String(season) : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return (
      <GapShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Knowledge-gap detective" fromCache={fromCache} cachedAt={cachedAt} />
      </GapShell>
    );
  }
  if (shell === "error") {
    return (
      <GapShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Knowledge-gap detective" fromCache={fromCache} cachedAt={cachedAt} />
      </GapShell>
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <GapShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Knowledge-gap detective" fromCache={fromCache} cachedAt={cachedAt} />
      </GapShell>
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
        description="Finds build work that has no write-up yet, by comparing the wiki against to-dos, build tasks, and milestones."
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
          <Button as="a" variant="secondary" href={hubHref("/team", "knowledge", orgId)}>
            Open wiki
          </Button>
        </div>
      </PageHeader>

      <OfflineBanner feature="Knowledge-gap detective" fromCache={fromCache} cachedAt={cachedAt} />

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
        description="No work items to check — add to-dos, build tasks, or milestones before gaps can appear."
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
          <Button variant="primary" type="button" disabled={busy} onClick={() => mutate({ action: "run-scan" })}>
            {scan ? "Re-scan" : "Run scan"}
          </Button>
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
                    <Button as="a" variant="secondary" href={item.href}>
                      Open work
                    </Button>
                  ) : null}
                  <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "draft-stub-page", itemId: item.id })}>
                    Draft stub page
                  </Button>
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
                <Button as="a" variant="secondary"
                  href={`/knowledge?pageId=${encodeURIComponent(item.draftPageId)}`}
                >
                  Open stub
                </Button>
              ) : null}
            </header>
            <p className="app-muted kg-tip">{item.reason}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
