"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  EmptyState,
  ErrorState,
  FormRow,
  PageHeader,
  Panel,
  StatRowSkeleton,
  StatTile,
  TableSkeleton,
  type BadgeTone, Button } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import {
  codeVersionStatusLabel,
  wiringStatusLabel,
} from "../../lib/readiness-score";
import type { ReadinessScoreView } from "../../lib/readiness-score/compute-readiness-score";
import {
  READINESS_SCORE_RELATED_INCLUDE,
  classifyReadinessScoreShell,
  formatReadinessScoreMetric,
  formatReadinessScorePercent,
  readinessScoreNextActions,
  readinessScoreRelatedLinks,
  readinessScoreSetupSteps,
  readinessScoreShellCopy,
  shouldShowReadinessScoreSummaryTiles,
  type ReadinessScoreNextAction,
  type ReadinessScoreShellKind,
} from "../../lib/readiness-score/readiness-score-related";
import type {
  ReadinessFixCategory,
  ReadinessTier,
} from "../../lib/readiness-score/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./readiness-score.css";

const CATEGORY_LABEL: Record<ReadinessFixCategory, string> = {
  fmea: "Open FMEA",
  wiring: "Wiring",
  code: "Code",
  bringup: "Bring-up checklist",
  weight: "Weight budget",
  power: "Power budget",
};

const COMPONENT_LABEL: Record<string, string> = {
  subsystemHealth: "Subsystem wiring",
  codeReadiness: "Code-version state",
  fmeaClearance: "FMEA clearance",
  weightHeadroom: "Weight headroom",
  powerHeadroom: "Power headroom",
  checklistCompletion: "Bring-up checklist",
};

function tierTone(tier: ReadinessTier): BadgeTone {
  if (tier === "ready") return "good";
  if (tier === "at_risk") return "setup";
  return "danger";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ReadinessScoreView, { status: "live" }>;

function isReadinessScoreView(value: unknown): value is ReadinessScoreView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function readinessScoreCacheOrg(data: ReadinessScoreView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistReadinessScoreSnapshot(
  orgHint: string,
  seasonHint: string,
  data: ReadinessScoreView,
): Promise<void> {
  const cacheOrg = readinessScoreCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("readiness-score", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("readiness-score", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Readiness Score already painted; IndexedDB is best-effort.
  }
}

function ReadinessRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = readinessScoreRelatedLinks(orgId, {
    include: [...READINESS_SCORE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related readiness-score-related" aria-label="Related build tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function ReadinessNextActionsPanel({ actions }: { actions: ReadinessScoreNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions readiness-score-next-actions"
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

function ReadinessShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  fromCache = false,
  cachedAt = null,
}: {
  description: string;
  orgId?: string | null;
  shell: ReadinessScoreShellKind;
  error?: string;
  onRetry?: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
}) {
  const actions = readinessScoreNextActions({ orgId, shell });
  const copy = readinessScoreShellCopy(shell);
  const buildHref = hubWorkbenchHref("build", "readiness-score", orgId);
  const setup = shell === "setup" ? readinessScoreSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page readiness-score-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Readiness Score"}
          </>
        }
        title="Robot readiness score"
        description={description}
      >
        <ReadinessRelatedStrip orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="Readiness Score" fromCache={fromCache} cachedAt={cachedAt} />
      {shell === "loading" ? (
        <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading readiness score">
          <StatRowSkeleton count={4} />
          <TableSkeleton rows={4} cols={3} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : shell === "empty" ? "No subsystems yet" : copy.badge}
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
            <Button as="a" variant="primary" href={hubHref("/build", "subsystems", orgId)}>Open Subsystems</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <ReadinessNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ReadinessScoreClient() {
  const [view, setView] = useState<ReadinessScoreView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ReadinessScoreView | null>(null);
  viewRef.current = view;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ReadinessScoreView>(
        "readiness-score",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isReadinessScoreView(cached.data)) {
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
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/readiness-score${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        return;
      }
      if (!response.ok || !isReadinessScoreView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Readiness Score. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistReadinessScoreSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Readiness Score. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const subsystemCount = view?.status === "live" ? view.subsystems.length : 0;
  const fixCount = view?.status === "live" ? view.index.fixList.length : 0;

  const shell = classifyReadinessScoreShell({
    loading: view == null && !fetchFailed,
    fetchFailed: fetchFailed && !view,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    subsystemCount,
  });
  const shellCopy = readinessScoreShellCopy(shell);
  const nextActions = readinessScoreNextActions({
    orgId,
    shell,
    subsystemCount,
    fixCount,
  });
  const relatedLinks = readinessScoreRelatedLinks(orgId, {
    include: [...READINESS_SCORE_RELATED_INCLUDE],
  });
  const buildHref = hubWorkbenchHref("build", "readiness-score", orgId);
  const showTiles = shouldShowReadinessScoreSummaryTiles(subsystemCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/readiness-score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isReadinessScoreView(data)) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return;
          }
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistReadinessScoreSnapshot(orgId, String(data.seasonYear), data);
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
      <ReadinessShell
        description={shellCopy.description}
        orgId={null}
        shell="loading"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (shell === "error") {
    return (
      <ReadinessShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => void load()}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (shell === "setup") {
    return (
      <ReadinessShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  if (view?.status !== "live") {
    return (
      <ReadinessShell
        description={shellCopy.description}
        orgId={orgId}
        shell="setup"
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  return (
    <main className="module-page readiness-score-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Readiness Score"}
          </>
        }
        title="Robot readiness score"
        description="One grounded ship-readiness index across subsystem wiring/code state, weight & power headroom, the bring-up checklist, and open FMEA. Cross-check FMEA, Inspection, and Code."
      >
        <div className="readiness-score-header-actions">
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
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Readiness Score" fromCache={fromCache} cachedAt={cachedAt} />

      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {shell === "ready" ? <ReadinessNextActionsPanel actions={nextActions} /> : null}

      {showTiles ? (
        <Panel className="readiness-score-panel" aria-label="Readiness counts">
          <div className="readiness-score-stats">
            <StatTile
              label="Subsystems"
              value={formatReadinessScoreMetric(subsystemCount, true)}
            />
            <StatTile
              label="Ship index"
              value={formatReadinessScorePercent(view.index.score, true)}
            />
            <StatTile
              label="Open FMEA"
              value={formatReadinessScoreMetric(view.index.openFmeaCount, true)}
            />
            <StatTile
              label="Checklist"
              value={`${formatReadinessScoreMetric(view.index.checklistComplete, true)}/${formatReadinessScoreMetric(view.index.checklistTotal, true)}`}
            />
          </div>
        </Panel>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No subsystems yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <Button as="a" variant="primary" href={hubHref("/build", "subsystems", orgId)}>
            Open Subsystems
          </Button>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {subsystemCount > 0 ? <ReadinessPanel view={view} /> : null}
        {subsystemCount > 0 ? <FixList view={view} /> : null}
        <SourcesPanel view={view} cutoffCode={cutoffCode} orgId={orgId} />
        <SubsystemList view={view} />
        <ChecklistPanel view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { index } = view;
  const components = Object.entries(index.components) as Array<[string, number]>;
  return (
    <Panel className="readiness-score-panel" aria-label="Ship readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <Badge tone={tierTone(index.tier)}>{index.tier.replace("_", " ").toUpperCase()}</Badge>
          <h2 style={{ margin: "6px 0 0" }}>Ship-readiness index</h2>
          <small className="app-muted">
            {index.weightUsedLbs} / {index.weightBudgetLbs} lbs · {index.powerUsedAmps} / {index.powerBudgetAmps} A ·{" "}
            {index.checklistComplete}/{index.checklistTotal} checklist · {index.openFmeaCount} open FMEA. Weight and power
            fall back to a 115 lb / 120 A yardstick until you record your own budgets — not a measured weigh-in.
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{formatReadinessScorePercent(index.score, true)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "180px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function FixList({ view }: { view: LiveView }) {
  const { fixList } = view.index;
  if (fixList.length === 0) {
    return (
      <EmptyState
        soft
        badge="Ship ready"
        badgeTone="good"
        title="No open fix-list items"
        description="Wiring is verified, code is deployed & tested, the bring-up checklist is complete, and there's no open FMEA or budget overrun on record."
      />
    );
  }
  return (
    <Panel id="readiness-score-fixes" className="readiness-score-panel">
      <h2 style={{ marginTop: 0 }}>Fix list — ordered by urgency</h2>
      <p className="app-muted">From logged subsystems and open FMEA only.</p>
      <ul className="readiness-score-list">
        {fixList.map((item) => (
          <li key={item.id} className="readiness-score-row">
            <div>
              <strong>{item.label}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {CATEGORY_LABEL[item.category]} · {item.reason}
              </small>
            </div>
            <Badge tone="danger">Severity {item.severity}</Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/*
 * Readiness Score used to own a form that wrote its own copy of every
 * subsystem's weight, current draw, wiring state and code state. That copy
 * drifted from the tools teams actually work in, and the score was computed
 * from the copy — so a fully-recorded robot could read as empty. The score is
 * now a read model, and this panel says where each number is entered instead
 * of offering a second place to enter it.
 */
function SourcesPanel({ view, cutoffCode, orgId }: { view: LiveView; cutoffCode: string | null; orgId: string | null }) {
  return (
    <Panel id="readiness-score-subsystem" className="readiness-score-panel" style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Where these numbers come from</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Readiness reads the build tools directly, so there is nothing to re-enter here. Update a number where it
        is owned and the score follows.
      </p>
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}
      <ul className="readiness-score-list">
        {view.sources.map((source) => (
          <li key={source.id} className="readiness-score-row">
            <span>{source.label}</span>
            <a className="text-button" href={source.href}>
              Open
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}


function SubsystemList({ view }: { view: LiveView }) {
  if (view.subsystems.length === 0) {
    return null;
  }
  return (
    <Panel className="readiness-score-panel">
      <h2 style={{ marginTop: 0 }}>Subsystems</h2>
      <ul className="readiness-score-list">
        {view.subsystems.map((item) => (
          <li key={item.id} className="readiness-score-row">
            <div>
              <strong>{item.name}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.weightLbs} lbs · {item.powerDrawAmps} A · {wiringStatusLabel(item.wiringStatus)} ·{" "}
                {codeVersionStatusLabel(item.codeVersionStatus)} · health {pct(item.healthScore)}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ChecklistPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState("");
  const [subsystemName, setSubsystemName] = useState("");

  return (
    <Panel className="readiness-score-panel">
      <h2 style={{ marginTop: 0 }}>Bring-up checklist</h2>
      {view.checklistItems.length === 0 ? (
        <p className="app-muted">No checklist items logged yet.</p>
      ) : (
        <ul className="readiness-score-list" style={{ marginBottom: 12 }}>
          {view.checklistItems.map((item) => (
            <li key={item.id} className="readiness-score-row">
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={item.isComplete}
                  disabled={busy}
                  onChange={(event) =>
                    mutate({ action: "toggle-checklist-item", itemId: item.id, isComplete: event.target.checked })
                  }
                />
                <span style={{ textDecoration: item.isComplete ? "line-through" : "none" }}>{item.label}</span>
                {item.subsystemName ? <small className="app-muted">— {item.subsystemName}</small> : null}
              </label>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "delete-checklist-item", itemId: item.id })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim()) return;
          mutate({
            action: "add-checklist-item",
            label,
            subsystemName: subsystemName || undefined,
            sequence: view.checklistItems.length,
          });
          setLabel("");
          setSubsystemName("");
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <FormRow label="New checklist item">
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Confirm bumper height" />
        </FormRow>
        <FormRow label="Subsystem (optional)">
          <input value={subsystemName} onChange={(event) => setSubsystemName(event.target.value)} />
        </FormRow>
        <Button variant="secondary" type="submit" disabled={busy || !label.trim()}>
          Add item
        </Button>
      </form>
    </Panel>
  );
}
