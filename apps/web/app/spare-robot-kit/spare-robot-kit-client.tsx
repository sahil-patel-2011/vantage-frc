"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { CHECKLIST_STATUSES, priorityLabel } from "../../lib/spare-robot-kit";
import type { SpareRobotKitView } from "../../lib/spare-robot-kit/compute-spare-robot-kit";
import type { ChecklistStatus, KitPriority } from "../../lib/spare-robot-kit/types";
import {
  SPARE_ROBOT_KIT_RELATED_INCLUDE,
  classifySpareRobotKitShell,
  formatSpareRobotKitMetric,
  spareRobotKitNextActions,
  spareRobotKitRelatedLinks,
  spareRobotKitSetupSteps,
  spareRobotKitShellCopy,
  shouldShowSpareRobotKitSummaryTiles,
  type SpareRobotKitNextAction,
  type SpareRobotKitShellKind,
} from "../../lib/spare-robot-kit/spare-robot-kit-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./spare-robot-kit.css";

const PRIORITY_TONE: Record<KitPriority, BadgeTone | undefined> = {
  critical: "danger",
  recommended: "setup",
  optional: "good",
};

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  draft: "Draft",
  finalized: "Finalized",
};

type LiveView = Extract<SpareRobotKitView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = spareRobotKitRelatedLinks(orgId, {
    include: [...SPARE_ROBOT_KIT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related srk-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: SpareRobotKitNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions srk-next-actions" aria-label="Next actions">
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

function KitShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: SpareRobotKitShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = spareRobotKitNextActions({ orgId, shell });
  const copy = spareRobotKitShellCopy(shell);
  const buildHref = hubWorkbenchHref("build", "spare-robot-kit", orgId);
  const steps = shell === "setup" ? spareRobotKitSetupSteps(orgId) : [];

  return (
    <main className="module-page srk-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Spare Robot Kit"}
          </>
        }
        title="Spare Robot Kit Checklist"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading spare robot kit checklist">
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
              Choose your team
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/build", "fmea", orgId)}>
                Open FMEA
              </a>
              <a className="app-button secondary" href={withOrgHref("/inventory", orgId)}>
                Open Inventory
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="srk-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="srk-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted srk-tip">{step.detail}</p>
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

export default function SpareRobotKitClient() {
  const [view, setView] = useState<SpareRobotKitView | null>(null);
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
    void fetch(`/api/spare-robot-kit${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SpareRobotKitView | { error?: string };
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
  const candidateCount = view?.status === "live" ? view.candidateItems.length : 0;
  const checklistCount = view?.status === "live" ? view.checklists.length : 0;

  const shell = classifySpareRobotKitShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    candidateCount,
    checklistCount,
  });
  const shellCopy = spareRobotKitShellCopy(shell);
  const nextActions = spareRobotKitNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    candidateCount,
    checklistCount,
  });
  const buildHref = hubWorkbenchHref("build", "spare-robot-kit", orgId);
  const showTiles = shouldShowSpareRobotKitSummaryTiles(candidateCount, checklistCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/spare-robot-kit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SpareRobotKitView | { error?: string };
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
    return <KitShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <KitShell
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
      <KitShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page srk-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Spare Robot Kit"}
          </>
        }
        title="Spare Robot Kit Checklist"
        description="Generates a competition spare-parts kit by cross-referencing inventory spare bins against FMEA repeat-failure history."
      >
        <div className="srk-header-actions">
          <RelatedStrip orgId={orgId} />
          {view.seasons.length > 0 ? (
            <label className="app-muted srk-filter">
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="srk-panel">
          <div className="srk-stats">
            <StatTile label="Kit candidates" value={formatSpareRobotKitMetric(candidateCount, loaded)} />
            <StatTile label="Checklists" value={formatSpareRobotKitMetric(checklistCount, loaded)} />
          </div>
        </Panel>
      ) : null}

      <CandidatesPanel view={view} busy={busy} mutate={mutate} />
      {view.checklists.length > 0 ? <ChecklistsList view={view} busy={busy} mutate={mutate} /> : null}
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function CandidatesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState("");

  if (view.candidateItems.length === 0) {
    return (
      <EmptyState
        soft
        badge="No kit candidates yet"
        badgeTone="setup"
        title="No spares are currently matched to FMEA history"
        description="Once spare-category inventory items are tagged with a subsystem that has logged FMEA failures, Vantage will surface what to pack."
      />
    );
  }

  return (
    <Panel id="spare-robot-kit-candidates" className="srk-panel">
      <header className="srk-candidates-header">
        <h2>Kit candidates</h2>
        <div className="srk-generate">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={`Spare robot kit — ${view.seasonYear}`}
          />
          <button
            type="button"
            className="app-button"
            disabled={busy}
            onClick={() => {
              mutate({ action: "generate-checklist", title: title.trim() || undefined });
              setTitle("");
            }}
          >
            Generate checklist
          </button>
        </div>
      </header>
      <ul className="srk-candidate-list">
        {view.candidateItems.map((item) => (
          <li key={item.itemId} className="app-card soft-panel srk-candidate-card">
            <header className="srk-candidate-header">
              <div>
                <Badge tone={PRIORITY_TONE[item.priority]}>{priorityLabel(item.priority)}</Badge>
                <strong className="srk-item-name">{item.itemName}</strong>
                <small className="app-muted">
                  {item.subsystem ?? "Unmatched subsystem"} · {item.quantityOnHand} on hand · {item.failureCount}{" "}
                  FMEA failure(s) this season
                </small>
              </div>
            </header>
            <small className="app-muted">{item.rationale}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ChecklistsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel id="spare-robot-kit-checklists" className="srk-panel">
      <h2>Checklists</h2>
      <ul className="srk-checklist-list">
        {view.checklists.map((checklist) => {
          const packedCount = checklist.items.filter((item) => item.packed).length;
          return (
            <li key={checklist.id} className="app-card soft-panel srk-checklist-card">
              <header className="srk-checklist-header">
                <div>
                  <strong>{checklist.title}</strong>
                  <small className="app-muted srk-block">
                    {STATUS_LABEL[checklist.status]} · {packedCount}/{checklist.items.length} packed
                  </small>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${checklist.title}"?`)) {
                      mutate({ action: "delete-checklist", checklistId: checklist.id });
                    }
                  }}
                >
                  Delete
                </button>
              </header>
              <small className="app-muted">{checklist.rationale}</small>
              <ul className="srk-pack-list">
                {checklist.items.map((item) => (
                  <li key={item.itemId} className="srk-pack-row">
                    <label className="srk-pack-label">
                      <input
                        type="checkbox"
                        checked={item.packed}
                        disabled={busy}
                        onChange={() =>
                          mutate({ action: "toggle-packed", checklistId: checklist.id, itemId: item.itemId })
                        }
                      />
                      {item.itemName} × {item.recommendedQty}
                    </label>
                    <small className="app-muted">{priorityLabel(item.priority)}</small>
                  </li>
                ))}
              </ul>
              {checklist.status !== "finalized" ? (
                <div className="srk-status-actions">
                  {CHECKLIST_STATUSES.filter((status) => status !== checklist.status).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className="app-button secondary"
                      disabled={busy}
                      onClick={() => mutate({ action: "update-status", checklistId: checklist.id, status })}
                    >
                      Mark {STATUS_LABEL[status].toLowerCase()}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
