"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import { fieldBudgetPhaseLabel } from "../../lib/scout-field-budget";
import type { ScoutFieldBudgetView } from "../../lib/scout-field-budget/compute-scout-field-budget";
import type { FieldBudgetLintResult, FieldBudgetSeverity } from "../../lib/scout-field-budget/types";
import {
  SCOUT_FIELD_BUDGET_RELATED_INCLUDE,
  classifyScoutFieldBudgetShell,
  formatScoutFieldBudgetMetric,
  scoutFieldBudgetNextActions,
  scoutFieldBudgetRelatedLinks,
  scoutFieldBudgetSetupSteps,
  scoutFieldBudgetShellCopy,
  shouldShowScoutFieldBudgetSummaryTiles,
  type ScoutFieldBudgetNextAction,
  type ScoutFieldBudgetShellKind,
} from "../../lib/scout-field-budget/scout-field-budget-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./scout-field-budget.css";

const severityBadgeTone: Record<FieldBudgetSeverity, BadgeTone | undefined> = {
  critical: "danger",
  warning: "setup",
  ok: "good",
};

type LiveView = Extract<ScoutFieldBudgetView, { status: "live" }>;

function isScoutFieldBudgetView(value: unknown): value is ScoutFieldBudgetView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistScoutFieldBudgetSnapshot(
  orgHint: string,
  data: ScoutFieldBudgetView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("scout-field-budget", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("scout-field-budget", "_", data);
  } catch {
    // Live Field-Count Budget already painted; IndexedDB is best-effort.
  }
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutFieldBudgetRelatedLinks(orgId, {
    include: [...SCOUT_FIELD_BUDGET_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related sfb-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: ScoutFieldBudgetNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions sfb-next-actions" aria-label="Next actions">
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

function BudgetShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: ScoutFieldBudgetShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = scoutFieldBudgetNextActions({ orgId, shell });
  const copy = scoutFieldBudgetShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "scout-field-budget", orgId);
  const setup = shell === "setup" ? scoutFieldBudgetSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page sfb-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Field-Count Budget"}
          </>
        }
        title="Scouting Field-Count Budget"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading field-count budget">
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
            <Button as="a" variant="primary" href="#scout-field-budget-lint">Lint a schema</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function ScoutFieldBudgetClient() {
  const [view, setView] = useState<ScoutFieldBudgetView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ScoutFieldBudgetView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<ScoutFieldBudgetView>(
          "scout-field-budget",
          urlOrg || "_",
        );
        if (!viewRef.current && cached?.data && isScoutFieldBudgetView(cached.data)) {
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
      try {
        const response = await fetch(
          `/api/scout-field-budget${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as ScoutFieldBudgetView | { error?: string };
        if (!response.ok || !isScoutFieldBudgetView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Field-Count Budget. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistScoutFieldBudgetSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Field-Count Budget. Showing the last copy on this device.");
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
  const snapshotCount = view?.status === "live" ? view.summary.totalSnapshots : 0;
  const overBudgetCount = view?.status === "live" ? view.summary.overBudgetCount : 0;

  const shell = classifyScoutFieldBudgetShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    snapshotCount,
  });
  const shellCopy = scoutFieldBudgetShellCopy(shell);
  const nextActions = scoutFieldBudgetNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    snapshotCount,
    overBudgetCount,
  });
  const competitionHref = hubWorkbenchHref("competition", "scout-field-budget", orgId);
  const showTiles = shouldShowScoutFieldBudgetSummaryTiles(snapshotCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/scout-field-budget", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ScoutFieldBudgetView | { error?: string };
        if (!response.ok || !isScoutFieldBudgetView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistScoutFieldBudgetSnapshot(orgId, data);
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
      <BudgetShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Field-Count Budget" fromCache={fromCache} cachedAt={cachedAt} />
      </BudgetShell>
    );
  }
  if (shell === "error") {
    return (
      <BudgetShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Field-Count Budget" fromCache={fromCache} cachedAt={cachedAt} />
      </BudgetShell>
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <BudgetShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Field-Count Budget" fromCache={fromCache} cachedAt={cachedAt} />
      </BudgetShell>
    );
  }

  return (
    <main className="module-page sfb-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Field-Count Budget"}
          </>
        }
        title="Scouting Field-Count Budget"
        description="Log a scouting schema's per-phase field count and lint it against a realistic per-match budget."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      <OfflineBanner feature="Field-Count Budget" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="sfb-panel">
          <h2>Budget at a glance</h2>
          <div className="sfb-stats">
            <StatTile label="Schemas linted" value={formatScoutFieldBudgetMetric(view.summary.totalSnapshots, loaded)} />
            <StatTile label="Over budget" value={formatScoutFieldBudgetMetric(view.summary.overBudgetCount, loaded)} />
            <StatTile label="Within budget" value={formatScoutFieldBudgetMetric(view.summary.okCount, loaded)} />
            <StatTile
              label="Avg live-match fields"
              value={formatScoutFieldBudgetMetric(view.summary.averageLiveFields, loaded)}
            />
          </div>
          <div>
            <strong className="app-muted">Per-phase budgets</strong>
            <ul className="sfb-budget-list">
              {Object.entries(view.budgets).map(([phase, budget]) => (
                <li key={phase}>
                  {fieldBudgetPhaseLabel(phase as Parameters<typeof fieldBudgetPhaseLabel>[0])}: {budget} fields
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      ) : null}

      <SnapshotForm busy={busy} mutate={mutate} />
      {view.summary.totalSnapshots > 0 ? (
        <SnapshotList view={view} busy={busy} mutate={mutate} />
      ) : (
        <EmptyState
          soft
          badge="No schemas linted yet"
          badgeTone="setup"
          title="Log your first schema snapshot"
          description="Record how many fields each match phase asks for."
        />
      )}
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function SnapshotList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel id="scout-field-budget-list" className="sfb-panel">
      <h2>Linted schemas</h2>
      <ul className="sfb-lint-list">
        {view.lints.map((lint) => (
          <LintRow key={lint.snapshotId} lint={lint} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function LintRow({
  lint,
  busy,
  mutate,
}: {
  lint: FieldBudgetLintResult;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <li className="sfb-lint-row">
      <div className="sfb-lint-header">
        <div>
          <Badge tone={severityBadgeTone[lint.severity]}>{lint.severity.toUpperCase()}</Badge>
          <strong className="sfb-lint-name">{lint.schemaName}</strong>
          <small className="app-muted sfb-block">
            {lint.liveFields} live-match fields (budget {lint.liveBudget}) · {lint.totalFields} total fields
          </small>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${lint.schemaName}"?`)) {
              mutate({ action: "delete-snapshot", snapshotId: lint.snapshotId });
            }
          }}
        >
          Delete
        </button>
      </div>
      <ul className="sfb-phase-list">
        {lint.phases.map((phase) => (
          <li key={phase.phase} className="sfb-phase-row">
            <span>{fieldBudgetPhaseLabel(phase.phase)}</span>
            <small className={phase.overBudget ? "sfb-over" : "app-muted"}>
              {phase.count} / {phase.budget}
              {phase.overBudget ? ` (+${phase.overBy})` : ""}
            </small>
          </li>
        ))}
      </ul>
      {lint.recommendations.length > 0 ? (
        <ul className="sfb-recs">
          {lint.recommendations.map((rec) => (
            <li key={rec}>
              <small className="app-muted">{rec}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SnapshotForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      schemaName: "",
      autoFields: "",
      teleopFields: "",
      endgameFields: "",
      pitFields: "",
      postMatchFields: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="scout-field-budget-lint"
      as="form"
      className="sfb-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.schemaName.trim()) return;
        mutate({
          action: "log-snapshot",
          schemaName: form.schemaName,
          autoFields: Number(form.autoFields) || 0,
          teleopFields: Number(form.teleopFields) || 0,
          endgameFields: Number(form.endgameFields) || 0,
          pitFields: Number(form.pitFields) || 0,
          postMatchFields: Number(form.postMatchFields) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Lint a schema</h2>
      <FormGrid min={160}>
        <FormRow label="Schema name">
          <input value={form.schemaName} onChange={set("schemaName")} placeholder="2026 Reefscape v2" required />
        </FormRow>
        <FormRow label="Auto fields">
          <input type="number" min={0} value={form.autoFields} onChange={set("autoFields")} />
        </FormRow>
        <FormRow label="Teleop fields">
          <input type="number" min={0} value={form.teleopFields} onChange={set("teleopFields")} />
        </FormRow>
        <FormRow label="Endgame fields">
          <input type="number" min={0} value={form.endgameFields} onChange={set("endgameFields")} />
        </FormRow>
        <FormRow label="Pit fields">
          <input type="number" min={0} value={form.pitFields} onChange={set("pitFields")} />
        </FormRow>
        <FormRow label="Post-match fields">
          <input type="number" min={0} value={form.postMatchFields} onChange={set("postMatchFields")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.schemaName.trim()}>
          Lint schema
        </Button>
      </div>
    </Panel>
  );
}
