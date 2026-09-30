"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { canDeleteFmeaFailure, fmeaContextLabel, fmeaLevelLabel, fmeaStatusLabel } from "../../lib/fmea";
import { FMEA_CONTEXTS, FMEA_STATUSES, type FmeaView } from "../../lib/fmea/compute-fmea";
import {
  fmeaNextActions,
  fmeaRelatedLinks,
  formatOsdFactors,
  formatRpnDisplay,
} from "../../lib/fmea/fmea-related";
import type { FmeaContext, FmeaEvaluation, FmeaLevel, FmeaStatus } from "../../lib/fmea/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./fmea.css";

function isFmeaView(value: unknown): value is FmeaView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistFmeaSnapshot(orgHint: string, seasonHint: string, data: FmeaView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("fmea", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("fmea", "_", data, seasonHint || seasonKey);
  } catch {
    // Live failure log already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<FmeaView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => Promise<boolean>;

const SCALES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function useHubEmbed(): "team" | "build" | null {
  const [embed, setEmbed] = useState<"team" | "build" | null>(null);
  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith("/team")) setEmbed("team");
    else if (path.startsWith("/build")) setEmbed("build");
    else setEmbed(null);
  }, []);
  return embed;
}

function FmeaRelated({ orgId }: { orgId: string }) {
  const links = fmeaRelatedLinks(orgId, { include: ["knowledge", "cad", "prototype", "inventory"] });
  return (
    <details className="fmea-disclosure fmea-related">
      <summary data-disclosure>Related work</summary>
      <nav aria-label="Related reliability tools" className="fmea-related-links">
        {links.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
        <a href={withOrgHref("/inspection", orgId)}>Inspection</a>
      </nav>
    </details>
  );
}

function NextActions({
  orgId,
  failureCount,
  activeCount,
  needsFixCount,
  highestRpn,
  topTitle,
}: {
  orgId?: string | null;
  failureCount: number;
  activeCount: number;
  needsFixCount: number;
  highestRpn: number;
  topTitle?: string | null;
}) {
  const actions = fmeaNextActions({
    orgId,
    failureCount,
    activeCount,
    needsFixCount,
    highestRpn,
    topTitle,
  });
  return (
    <section className="fmea-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Prioritized from logged failures — RPN stays blank until you score real O×S×D.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function FmeaClient({ embedded = false }: { embedded?: boolean } = {}) {
  const pathEmbed = useHubEmbed();
  const embed = pathEmbed ?? (embedded ? "team" : null);
  const Root = embed ? "section" : "main";
  const [view, setView] = useState<FmeaView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationPending = useRef(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<FmeaView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;
  const crumbs = embed === "build" ? "Build / FMEA" : "Team / FMEA";

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery)
          ? String(seasonQuery)
          : String(new Date().getFullYear());
      let hadCache = Boolean(viewRef.current);
      try {
        const cached =
          (await getFeatureSnapshot<FmeaView>("fmea", urlOrg || "_", seasonHint)) ??
          (await getFeatureSnapshot<FmeaView>("fmea", urlOrg || "_"));
        if (!viewRef.current && cached?.data && isFmeaView(cached.data)) {
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
      setLoadError("");
      setErrorStatus(null);
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(`/api/fmea${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as FmeaView | { error?: string };
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          return;
        }
        if (!response.ok || !isFmeaView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh FMEA. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
            setErrorStatus(response.status);
            setLoadError("error" in data && data.error ? data.error : "");
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistFmeaSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh FMEA. Showing the last copy on this device.");
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

  const mutate = useCallback<Mutate>(
    async (payload) => {
      if (!orgId || mutationPending.current) return false;
      mutationPending.current = true;
      setBusy(true);
      setError("");
      return fetch("/api/fmea", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data = (await response.json()) as FmeaView | { error?: string };
          if (!response.ok || !("status" in data) || data.status !== "live") {
            setError("error" in data && data.error ? data.error : "Could not save this entry. Try again.");
            return false;
          }
          setView(data);
          setSeason(data.seasonYear);
          void persistFmeaSnapshot(orgId, season != null ? String(season) : "", data);
          return true;
        })
        .catch(() => {
          setError("Could not save. Your entry is still here — try again.");
          return false;
        })
        .finally(() => { mutationPending.current = false; setBusy(false); });
    },
    [orgId, season],
  );

  if (!view) {
    // Retry cannot fix an expired session, so the failure decides its own action.
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <Root className="module-page fmea-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Failure Log (FMEA)"
          description="Capture in-match and pit failures with real O×S×D scores."
        />
        <OfflineBanner feature="FMEA" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading failure log…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </Root>
    );
  }

  if (view.status === "setup_required") {
    return (
      <Root className="module-page fmea-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Failure Log (FMEA)"
          description="Capture every in-match and pit failure against a subsystem. Score occurrence, severity, and detection from real events only."
        />
        <OfflineBanner feature="FMEA" fromCache={fromCache} cachedAt={cachedAt} />
        {error ? (
          <p className="fmea-alert" role="alert">
            {error}
          </p>
        ) : null}
        <EmptyState soft badge="Needs setup" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      </Root>
    );
  }

  const hasFailures = view.evaluations.length > 0;
  const topTitle = view.summary.topFailures[0]?.failure.title ?? null;

  return (
    <Root className="module-page fmea-page">
      <PageHeader
        breadcrumbs={crumbs}
        title="Failure Log (FMEA)"
        description={
          <>
            Track what broke, prioritize repairs, and record the fix.
          </>
        }
      >
        <div className="fmea-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                disabled={busy}
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
      <OfflineBanner feature="FMEA" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="fmea-alert" role="alert">
          {error}
        </p>
      ) : null}

      {hasFailures ? <NextActions
        orgId={orgId}
        failureCount={view.summary.total}
        activeCount={view.summary.active}
        needsFixCount={view.summary.needsFix.length}
        highestRpn={view.summary.highestRpn}
        topTitle={topTitle}
      /> : null}

      {hasFailures ? <SummaryTiles view={view} /> : null}
      <BatteryReliabilitySignals view={view} />

      {hasFailures ? (
        <div className="fmea-layout">
          <SubsystemHotspots view={view} orgId={orgId} />
          <TopFailures view={view} />
        </div>
      ) : (
        <div className="fmea-empty">
          <h2>No failures logged yet</h2>
          <p>Log the first issue below. Repairs and risks will appear here.</p>
        </div>
      )}

      <AddFailureForm key={`${orgId}:${view.seasonYear}`} view={view} busy={busy} mutate={mutate} />
      {hasFailures ? <FailureList view={view} busy={busy} mutate={mutate} /> : null}
      {orgId ? <FmeaRelated orgId={orgId} /> : null}
    </Root>
  );
}

function BatteryReliabilitySignals({ view }: { view: LiveView }) {
  if (!view.batterySignals?.length) return null;
  return (
    <Panel className="fmea-panel">
      <h2>Battery reliability → FMEA</h2>
      <p>Derived from your logged pack measurements. Promote one into the failure log when you confirm a mode.</p>
      <ul className="fmea-battery-signals">
        {view.batterySignals.map((signal) => (
          <li key={signal.id}>
            <strong>{signal.title}</strong>
            <span className="meta">
              L{signal.likelihood} × I{signal.impact} · {signal.category}
            </span>
            <span>{signal.detail}</span>
            <a href={signal.href}>Open Batteries</a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const hasActive = s.active > 0;
  const tiles = [
    { label: "Active failures", value: String(s.active), tone: s.active > 0 ? "warn" : "" },
    {
      label: "Critical + high",
      value: String(s.byLevel.critical + s.byLevel.high),
      tone: s.byLevel.critical + s.byLevel.high > 0 ? "critical" : "",
    },
    { label: "Top RPN", value: formatRpnDisplay(s.highestRpn, hasActive), tone: "" },
    { label: "Needs fix", value: String(s.needsFix.length), tone: s.needsFix.length > 0 ? "warn" : "" },
  ];
  return (
    <Panel>
      <section className="fmea-summary" aria-label="Season risk summary">
        {tiles.map((tile) => (
          <article key={tile.label} className={`fmea-summary-tile${tile.tone ? ` ${tile.tone}` : ""}`}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </article>
        ))}
      </section>
      {hasActive ? (
        <div className="fmea-level-row">
          {(["critical", "high", "moderate", "low"] as FmeaLevel[]).map((level) => (
            <span key={level} className={`fmea-badge ${level}`} title={`${s.byLevel[level]} active`}>
              {fmeaLevelLabel(level)}: {s.byLevel[level]}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function SubsystemHotspots({ view, orgId }: { view: LiveView; orgId: string | null }) {
  if (view.summary.bySubsystem.length === 0) {
    return (
      <Panel className="fmea-panel">
        <h2>Failure-prone subsystems</h2>
        <p>No failures logged yet. Link entries to subsystems to see the ranking.</p>
        <a href={withOrgHref("/subsystems", orgId)}>Open subsystems →</a>
      </Panel>
    );
  }
  return (
    <Panel className="fmea-panel">
      <h2>Failure-prone subsystems</h2>
      <ol className="fmea-hotspots">
        {view.summary.bySubsystem.slice(0, 8).map((row) => (
          <li key={`${row.subsystemId ?? row.subsystemName}`}>
            <div className="who">
              <strong>{row.subsystemName}</strong>
              <span className={`fmea-badge ${row.level}`}>
                {row.count}× · avg RPN {row.avgRpn}
              </span>
            </div>
            <div className="meta">
              max RPN {row.maxRpn}
              {row.openCount > 0 ? ` · ${row.openCount} open` : ""}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function TopFailures({ view }: { view: LiveView }) {
  if (view.summary.topFailures.length === 0) {
    return (
      <Panel className="fmea-panel">
        <h2>Highest RPN</h2>
        <p>No active failures — keep logging when something breaks. No demo RPN is shown.</p>
      </Panel>
    );
  }
  return (
    <Panel className="fmea-panel">
      <h2>Highest RPN</h2>
      <ol className="fmea-top-list">
        {view.summary.topFailures.map((evaluation) => (
          <li key={evaluation.failure.id}>
            <div className="who">
              <strong>{evaluation.failure.title}</strong>
              <span className={`fmea-badge ${evaluation.level}`}>RPN {evaluation.rpn}</span>
            </div>
            <div className="meta">
              {evaluation.failure.subsystemName} · {fmeaContextLabel(evaluation.failure.context)} ·{" "}
              {formatOsdFactors(evaluation.failure)}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function AddFailureForm({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      title: "",
      subsystemId: "",
      subsystemName: "",
      failureMode: "",
      context: "pit" as FmeaContext,
      occurrence: "3",
      severity: "5",
      detection: "4",
      rootCause: "",
      fiveWhys: "",
      fix: "",
      inspectionItemId: "",
      inventoryItemId: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const [saved, setSaved] = useState(false);

  const previewRpn =
    (Number(form.occurrence) || 1) * (Number(form.severity) || 1) * (Number(form.detection) || 1);

  return (
    <Panel className="fmea-panel fmea-capture">
      <h2>Log a failure</h2>
      <form aria-label="Log a failure" onChange={() => setSaved(false)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!form.title.trim()) return;
          setSaved(false);
          const success = await mutate({
            action: "create-failure",
            title: form.title,
            subsystemId: form.subsystemId || null,
            subsystemName: form.subsystemName,
            failureMode: form.failureMode,
            context: form.context,
            occurrence: Number(form.occurrence),
            severity: Number(form.severity),
            detection: Number(form.detection),
            rootCause: form.rootCause || null,
            fiveWhys: form.fiveWhys || null,
            fix: form.fix || null,
            inspectionItemId: form.inspectionItemId || null,
            inventoryItemId: form.inventoryItemId || null,
          });
          if (success) { setForm(empty); setSaved(true); }
        }}
      >
        <fieldset disabled={busy} className="fmea-fields">
        <div className="fmea-capture-basics">
          <FormRow label="What happened?" wide>
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Intake belt jumped during Q12"
            />
          </FormRow>
          <FormRow label="Subsystem">
            {view.subsystems.length > 0 ? (
              <select
                aria-label="Subsystem"
                value={form.subsystemId}
                onChange={(e) => {
                  const id = e.target.value;
                  const match = view.subsystems.find((s) => s.id === id);
                  setForm({
                    ...form,
                    subsystemId: id,
                    subsystemName: match?.name ?? form.subsystemName,
                  });
                }}
              >
                <option value="">Custom name…</option>
                {view.subsystems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.robotLabel !== "competition" ? ` (${s.robotLabel})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required
                value={form.subsystemName}
                onChange={(e) => setForm({ ...form, subsystemName: e.target.value })}
                placeholder="e.g. Intake"
              />
            )}
          </FormRow>
          <FormRow label="Where">
            <select
              aria-label="Where"
              value={form.context}
              onChange={(e) => setForm({ ...form, context: e.target.value as FmeaContext })}
            >
              {FMEA_CONTEXTS.map((c) => (
                <option key={c} value={c}>
                  {fmeaContextLabel(c)}
                </option>
              ))}
            </select>
          </FormRow>
          {view.subsystems.length > 0 && !form.subsystemId ? (
            <FormRow label="Subsystem name" wide>
              <input
                required
                value={form.subsystemName}
                onChange={(e) => setForm({ ...form, subsystemName: e.target.value })}
                placeholder="Intake"
              />
            </FormRow>
          ) : null}
        </div>
        <fieldset className="fmea-scoring">
          <legend>Risk assessment</legend>
          <div className="fmea-score-grid">
          <FormRow label="Occurrence" hint="1 rare · 10 frequent">
            <select value={form.occurrence} onChange={(e) => setForm({ ...form, occurrence: e.target.value })}>
              {SCALES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Severity" hint="1 minor · 10 severe">
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SCALES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Detection" hint="1 easy to spot · 10 hard">
            <select value={form.detection} onChange={(e) => setForm({ ...form, detection: e.target.value })}>
              {SCALES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormRow>
          </div>
        </fieldset>
        <details className="fmea-disclosure fmea-analysis">
          <summary data-disclosure>Analysis and repair <span>Optional</span></summary>
          <div className="fmea-analysis-grid">
          <FormRow label="Failure mode">
            <input
              value={form.failureMode}
              onChange={(e) => setForm({ ...form, failureMode: e.target.value })}
              placeholder="Belt skips teeth under load"
            />
          </FormRow>
          <FormRow label="Root cause">
            <input
              value={form.rootCause}
              onChange={(e) => setForm({ ...form, rootCause: e.target.value })}
              placeholder="Idler tensioner loosened after match 4"
            />
          </FormRow>
          <FormRow label="5 whys" wide>
            <textarea
              value={form.fiveWhys}
              onChange={(e) => setForm({ ...form, fiveWhys: e.target.value })}
              rows={3}
              placeholder="Why? … Why? …"
            />
          </FormRow>
          <FormRow label="Fix">
            <input
              value={form.fix}
              onChange={(e) => setForm({ ...form, fix: e.target.value })}
              placeholder="Loctite tensioner bolt + mark torque"
            />
          </FormRow>
          {view.inspectionItems.length > 0 ? (
            <FormRow label="Linked inspection item">
              <select
                value={form.inspectionItemId}
                onChange={(e) => setForm({ ...form, inspectionItemId: e.target.value })}
              >
                <option value="">None</option>
                {view.inspectionItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    [{item.status}] {item.category}: {item.requirement}
                  </option>
                ))}
              </select>
            </FormRow>
          ) : null}
          {(view.inventoryItems?.length ?? 0) > 0 ? (
            <FormRow label="Spare / inventory item">
              <select
                value={form.inventoryItemId}
                onChange={(e) => setForm({ ...form, inventoryItemId: e.target.value })}
              >
                <option value="">None — match by subsystem name</option>
                {view.inventoryItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.subsystem ? ` · ${item.subsystem}` : ""}
                  </option>
                ))}
              </select>
            </FormRow>
          ) : null}
          </div>
        </details>
        </fieldset>
        <div className="fmea-form-actions">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save failure"}
          </Button>
          <span className="fmea-preview">
            Risk score: <strong>{previewRpn}</strong>{" "}
            <span className="app-muted">({formatOsdFactors({
              occurrence: Number(form.occurrence) || 1,
              severity: Number(form.severity) || 1,
              detection: Number(form.detection) || 1,
            })})</span>
          </span>
        </div>
        <p className="fmea-save-status" role="status">{saved ? "Failure saved." : ""}</p>
      </form>
    </Panel>
  );
}

function FailureList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  return (
    <Panel className="fmea-panel">
      <h2>Season log</h2>
      <p>Risk rows ranked by RPN from logged O×S×D — empty fields stay blank.</p>
      <div className="fmea-risk-list">
        {view.evaluations.map((evaluation) => (
          <FailureCard
            key={evaluation.failure.id}
            evaluation={evaluation}
            busy={busy}
            mutate={mutate}
            role={view.role}
            userId={view.userId}
          />
        ))}
      </div>
    </Panel>
  );
}

function FailureCard({
  evaluation,
  busy,
  mutate,
  role,
  userId,
}: {
  evaluation: FmeaEvaluation;
  busy: boolean;
  mutate: Mutate;
  role?: string | null;
  userId?: string | null;
}) {
  const f = evaluation.failure;
  const rowClass = [
    "fmea-risk-row",
    evaluation.level,
    evaluation.needsFix ? "needs-fix" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={rowClass}>
      <header className="fmea-risk-top">
        <div className="fmea-risk-title">
          <strong>{f.title}</strong>
          {f.failureMode ? <p className="mode">{f.failureMode}</p> : null}
          <div className="fmea-risk-meta">
            <span className={`fmea-badge ${evaluation.level}`}>{fmeaLevelLabel(evaluation.level)}</span>
            <span>{f.subsystemName}</span>
            {f.inventoryItemName ? <span>{f.inventoryItemName}</span> : null}
            <span>{fmeaContextLabel(f.context)}</span>
            {evaluation.needsFix ? <span className="fmea-badge needs-fix">Needs fix</span> : null}
          </div>
        </div>
        <div className="fmea-risk-scores">
          <span className="fmea-rpn" title="Risk priority number from logged O×S×D">
            <em>RPN</em>
            <strong>{evaluation.rpn}</strong>
          </span>
          <span className="fmea-osd">{formatOsdFactors(f)}</span>
        </div>
      </header>

      <div className="fmea-risk-body">
        {f.fiveWhys ? <details className="fmea-disclosure"><summary data-disclosure>5 whys</summary><p style={{ whiteSpace: "pre-wrap" }}>{f.fiveWhys}</p></details> : null}
        {f.rootCause ? (
          <p>
            <span className="label">Root cause: </span>
            {f.rootCause}
          </p>
        ) : null}
        {f.fix ? (
          <p>
            <span className="label">Fix: </span>
            {f.fix}
          </p>
        ) : evaluation.needsFix ? (
          <p className="warn">No fix recorded yet.</p>
        ) : null}
      </div>

      <div className="fmea-risk-actions">
        <label>
          Status
          <select
            disabled={busy}
            value={f.status}
            onChange={(e) =>
              mutate({ action: "update-failure", failureId: f.id, status: e.target.value as FmeaStatus })
            }
          >
            {FMEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {fmeaStatusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        {canDeleteFmeaFailure({ role, userId, authorId: f.recordedBy }) ? (
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            aria-label={`Delete ${f.title}`}
            onClick={() => {
              if (window.confirm("Delete this failure entry?")) mutate({ action: "delete-failure", failureId: f.id });
            }}
          >
            Delete
          </Button>
        ) : null}
        {f.recordedByName ? <small className="app-muted">Logged by {f.recordedByName}</small> : null}
      </div>

    </article>
  );
}
