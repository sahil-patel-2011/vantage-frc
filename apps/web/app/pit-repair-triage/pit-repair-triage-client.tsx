"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { OfflineBanner } from "../../components/offline-banner";
import {
  TRIAGE_STATUSES,
  mainBreakerTripCue,
  canBusDropoutCue,
  needsReinspectionBeforeQueue,
  reinspectionCue,
  triageDecisionLabel,
} from "../../lib/pit-repair-triage";
import type { PitRepairTriageView } from "../../lib/pit-repair-triage/compute-pit-repair-triage";
import type { TriageDecision, TriageStatus } from "../../lib/pit-repair-triage/types";
import {
  PIT_REPAIR_TRIAGE_RELATED_INCLUDE,
  classifyPitRepairTriageShell,
  formatPitRepairTriageMetric,
  pitRepairTriageNextActions,
  pitRepairTriageRelatedLinks,
  pitRepairTriageSetupSteps,
  pitRepairTriageShellCopy,
  shouldShowPitRepairTriageSummaryTiles,
  type PitRepairTriageNextAction,
  type PitRepairTriageShellKind,
} from "../../lib/pit-repair-triage/pit-repair-triage-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./pit-repair-triage.css";

function isPitRepairTriageView(value: unknown): value is PitRepairTriageView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistPitRepairSnapshot(
  orgHint: string,
  seasonHint: string,
  data: PitRepairTriageView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim()
      ? data.orgId
      : orgHint;
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("pit-repair", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("pit-repair", "_", data, seasonHint || seasonKey);
  } catch {
    // Live triage already painted; IndexedDB is best-effort.
  }
}

const DECISION_TONE: Record<TriageDecision, BadgeTone> = {
  fix: "good",
  swap: "setup",
  monitor: "neutral",
};

const STATUS_LABEL: Record<TriageStatus, string> = {
  open: "Open",
  staged: "Staged",
  resolved: "Resolved",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<PitRepairTriageView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = pitRepairTriageRelatedLinks(orgId, {
    include: [...PIT_REPAIR_TRIAGE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related prt-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: PitRepairTriageNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions prt-next-actions" aria-label="Next actions">
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

function TriageShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: PitRepairTriageShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = pitRepairTriageNextActions({ orgId, shell });
  const copy = pitRepairTriageShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "pit-repair-triage", orgId);
  const setup = shell === "setup" ? pitRepairTriageSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page prt-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Pit repair triage"}
          </>
        }
        title="Pit repair triage"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading pit-repair triage">
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
            <Button as="a" variant="primary" href="#pit-repair-triage-log">Log a pit failure</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function PitRepairTriageClient() {
  const [view, setView] = useState<PitRepairTriageView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PitRepairTriageView | null>(null);
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
        const cached = await getFeatureSnapshot<PitRepairTriageView>(
          "pit-repair",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isPitRepairTriageView(cached.data)) {
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
          `/api/pit-repair-triage${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as PitRepairTriageView | { error?: string };
        if (!response.ok || !isPitRepairTriageView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh pit repair. Showing the last copy on this device.");
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
        await persistPitRepairSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh pit repair. Showing the last copy on this device.");
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
  const reportCount = view?.status === "live" ? view.reports.length : 0;
  const fmeaCount = view?.status === "live" ? view.fmeaHistory.length : 0;
  const spareCount = view?.status === "live" ? view.spareCandidates.length : 0;
  const openCount =
    view?.status === "live"
      ? view.reports.filter((r) => r.status === "open" || r.status === "staged").length
      : 0;

  const shell = classifyPitRepairTriageShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    reportCount,
  });
  const shellCopy = pitRepairTriageShellCopy(shell);
  const reinspectReports =
    view?.status === "live"
      ? view.reports.filter((report) => needsReinspectionBeforeQueue(report))
      : [];
  const nextActions = pitRepairTriageNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    reportCount,
    openCount,
    reinspectReports,
  });
  const competitionHref = hubWorkbenchHref("competition", "pit-repair-triage", orgId);
  const showTiles = shouldShowPitRepairTriageSummaryTiles(reportCount, fmeaCount, spareCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/pit-repair-triage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as PitRepairTriageView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistPitRepairSnapshot(orgId, season != null ? String(season) : "", data);
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
      <TriageShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Pit repair triage" fromCache={fromCache} cachedAt={cachedAt} />
      </TriageShell>
    );
  }
  if (shell === "error") {
    return (
      <TriageShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Pit repair triage" fromCache={fromCache} cachedAt={cachedAt} />
      </TriageShell>
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <TriageShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Pit repair triage" fromCache={fromCache} cachedAt={cachedAt} />
      </TriageShell>
    );
  }

  return (
    <main className="module-page prt-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Pit repair triage"}
          </>
        }
        title="Pit repair triage"
        description="Log a pit failure against real Failure log history and spare stock. Cross-check Command and Spare Kit."
      >
        <div className="prt-header-actions">
          <RelatedStrip orgId={orgId} />
          {view.seasons.length > 0 ? (
            <label className="app-muted prt-filter">
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

      <OfflineBanner feature="Pit repair triage" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="prt-panel">
          <div className="prt-stats">
            <StatTile label="Reports" value={formatPitRepairTriageMetric(reportCount, loaded)} />
            <StatTile label="Open / staged" value={formatPitRepairTriageMetric(openCount, loaded)} />
            <StatTile label="Failure log history" value={formatPitRepairTriageMetric(fmeaCount, loaded)} />
            <StatTile label="Spares in stock" value={formatPitRepairTriageMetric(spareCount, loaded)} />
          </div>
        </Panel>
      ) : null}

      <LogFailureForm busy={busy} mutate={mutate} view={view} />
      {view.reports.length > 0 ? (
        <ReportsList view={view} busy={busy} mutate={mutate} />
      ) : (
        <EmptyState
          soft
          badge="No reports yet"
          badgeTone="setup"
          title="Log your first pit failure"
          description="Fix-vs-swap uses real Failure log history and spare stock."
        />
      )}
      <ReferencePanels view={view} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

type UsedPartDraft = { itemId: string; quantity: number };

/**
 * Close the loop: resolving a repair that consumed a part decrements the unified parts ledger
 * (sourceRef = this repair), so forecasts and the next triage read real remaining stock.
 */
function ResolveWithPartsForm({
  report,
  candidates,
  busy,
  onResolve,
  onCancel,
}: {
  report: LiveView["reports"][number];
  candidates: LiveView["spareCandidates"];
  busy: boolean;
  onResolve: (usedParts: UsedPartDraft[]) => void;
  onCancel: () => void;
}) {
  const matched = candidates.find((item) => item.id === report.matchedInventoryItemId);
  const [chosen, setChosen] = useState<UsedPartDraft[]>(() =>
    // A swap decision with a matched spare almost certainly consumed it — pre-fill 1, editable.
    matched && report.decision === "swap" ? [{ itemId: matched.id, quantity: 1 }] : [],
  );
  const [pickItemId, setPickItemId] = useState("");
  const [pickQty, setPickQty] = useState("1");

  const nameOf = (itemId: string) => candidates.find((item) => item.id === itemId)?.name ?? "Unknown part";
  const addPart = () => {
    const quantity = Number(pickQty);
    if (!pickItemId || !Number.isFinite(quantity) || quantity <= 0) return;
    setChosen((prev) => {
      const existing = prev.find((part) => part.itemId === pickItemId);
      if (existing) {
        return prev.map((part) =>
          part.itemId === pickItemId ? { ...part, quantity: part.quantity + quantity } : part,
        );
      }
      return [...prev, { itemId: pickItemId, quantity }];
    });
    setPickItemId("");
    setPickQty("1");
  };

  return (
    <div className="prt-resolve-form" role="group" aria-label="Used parts">
      <p className="prt-tip">
        <strong>Used parts</strong> — picked parts are decremented from stock through the ledger, tagged to
        this repair. Real counts only; skip if nothing was consumed.
      </p>
      {chosen.length > 0 ? (
        <ul className="prt-used-list">
          {chosen.map((part) => (
            <li key={part.itemId}>
              <span>
                {nameOf(part.itemId)} × {part.quantity}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setChosen((prev) => prev.filter((p) => p.itemId !== part.itemId))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {candidates.length > 0 ? (
        <div className="prt-resolve-picker">
          <select value={pickItemId} onChange={(event) => setPickItemId(event.target.value)} aria-label="Part">
            <option value="">Add a part…</option>
            {candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.quantity} in stock)
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            step={1}
            value={pickQty}
            onChange={(event) => setPickQty(event.target.value)}
            aria-label="Quantity used"
          />
          <Button variant="secondary" type="button" disabled={busy || !pickItemId} onClick={addPart}>
            Add
          </Button>
        </div>
      ) : (
        <p className="app-muted prt-tip">No parts currently in stock — resolve without decrementing.</p>
      )}
      <div className="prt-status-actions">
        <Button variant="primary" type="button" disabled={busy} onClick={() => onResolve(chosen)}>
          {chosen.length > 0 ? `Resolve & log ${chosen.length} part(s)` : "Resolve without parts"}
        </Button>
        <Button variant="secondary" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ReportsList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  return (
    <Panel id="pit-repair-triage-reports" className="prt-panel">
      <h2>Triage reports</h2>
      <ul className="prt-report-list">
        {view.reports.map((report) => {
          const inspectCue = reinspectionCue(report);
          const breakerCue = mainBreakerTripCue(report);
          const canCue = canBusDropoutCue(report);
          return (
          <li key={report.id} className="app-card soft-panel prt-report-card">
            <header className="prt-report-header">
              <div>
                <Badge tone={DECISION_TONE[report.decision]}>{triageDecisionLabel(report.decision)}</Badge>
                <strong className="prt-report-title">{report.title}</strong>
                <small className="app-muted">
                  {report.subsystemName} · {STATUS_LABEL[report.status]} · confidence {pct(report.confidence)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${report.title}"?`)) {
                    mutate({ action: "delete-report", reportId: report.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            {report.symptomNote ? <p className="prt-tip">{report.symptomNote}</p> : null}
            {report.photoUrl ? (
              <a href={report.photoUrl} target="_blank" rel="noreferrer">
                View photo
              </a>
            ) : null}
            <small className="app-muted">{report.rationale}</small>
            <small className="app-muted">
              {report.minutesUntilNextMatch} min to next match · {report.priorFailureCount} prior logged failure(s) ·{" "}
              {report.sparesAvailable} spare(s) matched
              {report.prestageRecommended ? " · pre-stage recommended" : ""}
            </small>
            {inspectCue ? (
              <p className="prt-reinspect" role="status">
                {inspectCue}
              </p>
            ) : null}
            {breakerCue ? (
              <p className="prt-reinspect" role="status">
                {breakerCue}
              </p>
            ) : null}
            {canCue ? (
              <p className="prt-reinspect" role="status">
                {canCue}
              </p>
            ) : null}
            {report.status !== "resolved" && resolvingId !== report.id ? (
              <div className="prt-status-actions">
                {TRIAGE_STATUSES.filter((status) => status !== report.status).map((status) => (
                  <Button variant="secondary" key={status} type="button" disabled={busy} onClick={() => { if (status === "resolved") { setResolvingId(report.id); } else { mutate({ action: "update-status", reportId: report.id, status }); } }}>
                    Mark {STATUS_LABEL[status].toLowerCase()}
                  </Button>
                ))}
              </div>
            ) : null}
            {report.status !== "resolved" && resolvingId === report.id ? (
              <ResolveWithPartsForm
                report={report}
                candidates={view.spareCandidates}
                busy={busy}
                onCancel={() => setResolvingId(null)}
                onResolve={(usedParts) => {
                  setResolvingId(null);
                  mutate({
                    action: "update-status",
                    reportId: report.id,
                    status: "resolved",
                    usedParts: usedParts.length > 0 ? usedParts : undefined,
                  });
                }}
              />
            ) : null}
          </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ReferencePanels({ view }: { view: LiveView }) {
  return (
    <section className="app-card soft-panel prt-reference" aria-label="Failure log and spares reference">
      <div>
        <h2>Failure log history</h2>
        {view.fmeaHistory.length === 0 ? (
          <p className="app-muted">No failures logged this season yet.</p>
        ) : (
          <ul className="prt-ref-list">
            {view.fmeaHistory.map((entry) => (
              <li key={entry.id} className="prt-ref-row">
                <span>
                  {entry.subsystemName} — {entry.title}
                </span>
                <small className="app-muted">
                  sev {entry.severity} · {entry.occurredAt}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2>Spares in stock</h2>
        {view.spareCandidates.length === 0 ? (
          <p className="app-muted">No spares currently in stock.</p>
        ) : (
          <ul className="prt-ref-list">
            {view.spareCandidates.map((item) => (
              <li key={item.id} className="prt-ref-row">
                <span>{item.name}</span>
                <small className="app-muted">
                  {item.quantity} in stock{item.subsystem ? ` · ${item.subsystem}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LogFailureForm({
  busy,
  mutate,
  view,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  view: LiveView;
}) {
  const empty = useMemo(
    () => ({
      subsystemName: "",
      title: "",
      symptomNote: "",
      photoUrl: "",
      minutesUntilNextMatch: "",
      relatedFmeaFailureId: "",
      matchedInventoryItemId: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="pit-repair-triage-log"
      as="form"
      className="prt-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.subsystemName.trim() || !form.title.trim()) return;
        mutate({
          action: "log-failure",
          subsystemName: form.subsystemName,
          title: form.title,
          symptomNote: form.symptomNote || undefined,
          photoUrl: form.photoUrl || undefined,
          minutesUntilNextMatch: Number(form.minutesUntilNextMatch) || 0,
          relatedFmeaFailureId: form.relatedFmeaFailureId || undefined,
          matchedInventoryItemId: form.matchedInventoryItemId || undefined,
        });
        setForm(empty);
      }}
    >
      <h2>Log a pit failure</h2>
      <p className="app-muted">Grounded in the failure log and spare stock.</p>
      <FormGrid min={180}>
        <FormRow label="Subsystem">
          <input value={form.subsystemName} onChange={set("subsystemName")} placeholder="Intake" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Roller jammed under load" required />
        </FormRow>
        <FormRow label="Minutes until next match">
          <input type="number" min={0} value={form.minutesUntilNextMatch} onChange={set("minutesUntilNextMatch")} />
        </FormRow>
        <FormRow label="Related logged failure (optional)">
          <select value={form.relatedFmeaFailureId} onChange={set("relatedFmeaFailureId")}>
            <option value="">None</option>
            {view.fmeaHistory.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.subsystemName} — {entry.title}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Matched spare (optional)">
          <select value={form.matchedInventoryItemId} onChange={set("matchedInventoryItemId")}>
            <option value="">None</option>
            {view.spareCandidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.quantity} in stock)
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Photo URL (optional)">
          <input value={form.photoUrl} onChange={set("photoUrl")} placeholder="https://…" />
        </FormRow>
      </FormGrid>
      <FormRow label="Symptom note (optional)">
        <textarea value={form.symptomNote} onChange={set("symptomNote")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.subsystemName.trim() || !form.title.trim()}>
          Triage failure
        </Button>
      </div>
    </Panel>
  );
}
