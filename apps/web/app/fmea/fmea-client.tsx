"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { BuildHubRelated } from "../../components/build-hub-related";
import { TeamHubRelated } from "../../components/team-hub-related";
import { fmeaContextLabel, fmeaLevelLabel, fmeaStatusLabel } from "../../lib/fmea";
import { FMEA_CONTEXTS, FMEA_STATUSES, type FmeaView } from "../../lib/fmea/compute-fmea";
import {
  FMEA_BUILD_RELATED_INCLUDE,
  FMEA_TEAM_RELATED_INCLUDE,
  fmeaNextActions,
  fmeaRelatedLinks,
  formatOsdFactors,
  formatRpnDisplay,
} from "../../lib/fmea/fmea-related";
import type { FmeaContext, FmeaEvaluation, FmeaLevel, FmeaStatus } from "../../lib/fmea/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./fmea.css";

type LiveView = Extract<FmeaView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

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
  const primary = fmeaRelatedLinks(orgId, { include: ["knowledge", "cad", "prototype", "inventory"] });
  return (
    <div className="fmea-related">
      <nav className="product-hub-related fmea-hub-related" aria-label="Related reliability tools">
        {primary.map((link) => (
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <TeamHubRelated orgId={orgId} active="fmea" include={[...FMEA_TEAM_RELATED_INCLUDE]} />
      <BuildHubRelated orgId={orgId} active="fmea" include={[...FMEA_BUILD_RELATED_INCLUDE]} />
    </div>
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

export default function FmeaClient({ embedded = false }: { embedded?: boolean } = {}) {
  const pathEmbed = useHubEmbed();
  const embed = pathEmbed ?? (embedded ? "team" : null);
  const [view, setView] = useState<FmeaView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const crumbs = embed === "build" ? "Build / FMEA" : "Team / FMEA";

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/fmea${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as FmeaView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/fmea", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as FmeaView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  if (fetchFailed || view == null) {
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
      <main className="module-page fmea-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Failure Log (FMEA)"
          description="Capture in-match and pit failures with real O×S×D scores — never demo RPN."
        />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading failure log…"}
          description={failure ? failure.description : "Checking your workspace."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure?.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page fmea-page">
        <PageHeader
          breadcrumbs={crumbs}
          title="Failure Log (FMEA)"
          description="Capture every in-match and pit failure against a subsystem. Score occurrence, severity, and detection from real events only."
        />
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="fmea-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        </EmptyState>
        <NextActions
          orgId={view.orgId}
          failureCount={0}
          activeCount={0}
          needsFixCount={0}
          highestRpn={0}
        />
      </main>
    );
  }

  const hasFailures = view.evaluations.length > 0;
  const topTitle = view.summary.topFailures[0]?.failure.title ?? null;

  return (
    <main className="module-page fmea-page">
      <PageHeader
        breadcrumbs={crumbs}
        title="Failure Log (FMEA)"
        description={
          <>
            Capture every in-match and pit failure against a subsystem. Score occurrence, severity, and
            detection, record root cause and fix. Risk priority is calculated from the scores you enter.
          </>
        }
      >
        <div className="fmea-header-actions">
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
          <a className="app-button secondary" href={hubHref("/team", "knowledge", orgId)}>
            Knowledge
          </a>
          <a className="app-button secondary" href={hubHref("/build", "cad", orgId)}>
            CAD
          </a>
          <a className="app-button secondary" href={hubHref("/build", "prototype", orgId)}>
            Prototypes
          </a>
          <a className="app-button secondary" href={withOrgHref("/inspection", orgId)}>
            Inspection
          </a>
        </div>
      </PageHeader>

      {orgId && !embed ? <FmeaRelated orgId={orgId} /> : null}

      {error ? (
        <p className="fmea-alert" role="alert">
          {error}
        </p>
      ) : null}

      <NextActions
        orgId={orgId}
        failureCount={view.summary.total}
        activeCount={view.summary.active}
        needsFixCount={view.summary.needsFix.length}
        highestRpn={view.summary.highestRpn}
        topTitle={topTitle}
      />

      <SummaryTiles view={view} />
      <BatteryReliabilitySignals view={view} />

      {!hasFailures ? (
        <EmptyState
          soft
          title="No failures logged yet"
          description="When something breaks in the pit or on the field, log it with O/S/D scores. Highest RPN stays blank until then — nothing is invented."
        >
          <div className="fmea-risk-links">
            <a href={hubHref("/team", "knowledge", orgId)}>Knowledge →</a>
            <a href={hubHref("/build", "cad", orgId)}>CAD →</a>
            <a href={hubHref("/build", "prototype", orgId)}>Prototypes →</a>
          </div>
        </EmptyState>
      ) : (
        <div className="fmea-layout">
          <SubsystemHotspots view={view} orgId={orgId} />
          <TopFailures view={view} />
        </div>
      )}

      <AddFailureForm view={view} busy={busy} mutate={mutate} />
      {hasFailures ? <FailureList view={view} busy={busy} mutate={mutate} orgId={orgId} /> : null}
    </main>
  );
}

function BatteryReliabilitySignals({ view }: { view: LiveView }) {
  if (!view.batterySignals?.length) return null;
  return (
    <Panel className="fmea-panel">
      <h2>Battery reliability → FMEA</h2>
      <p>Derived from logged pack measurements — not invented. Promote into the failure log when you confirm a mode.</p>
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

  const previewRpn =
    (Number(form.occurrence) || 1) * (Number(form.severity) || 1) * (Number(form.detection) || 1);

  return (
    <Panel className="fmea-panel">
      <h2>Log a failure</h2>
      <p>Preview RPN updates from the O/S/D you pick — it is not saved until you add the entry.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.title.trim()) return;
          mutate({
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
          setForm(empty);
        }}
      >
        <FormGrid>
          <FormRow label="Title">
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
                placeholder="Intake — or add subsystems first"
              />
            )}
          </FormRow>
          {!form.subsystemId ? (
            <FormRow label="Subsystem name">
              <input
                required
                value={form.subsystemName}
                onChange={(e) => setForm({ ...form, subsystemName: e.target.value })}
                placeholder="Intake"
              />
            </FormRow>
          ) : null}
          <FormRow label="Where">
            <select
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
          <FormRow label="Failure mode">
            <input
              value={form.failureMode}
              onChange={(e) => setForm({ ...form, failureMode: e.target.value })}
              placeholder="Belt skips teeth under load"
            />
          </FormRow>
          <FormRow label={`Occurrence (${form.occurrence})`}>
            <select value={form.occurrence} onChange={(e) => setForm({ ...form, occurrence: e.target.value })}>
              {SCALES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label={`Severity (${form.severity})`}>
            <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {SCALES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label={`Detection (${form.detection})`}>
            <select value={form.detection} onChange={(e) => setForm({ ...form, detection: e.target.value })}>
              {SCALES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Root cause">
            <input
              value={form.rootCause}
              onChange={(e) => setForm({ ...form, rootCause: e.target.value })}
              placeholder="Idler tensioner loosened after match 4"
            />
          </FormRow>
          <FormRow label="5 whys">
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
        </FormGrid>
        <div className="fmea-form-actions">
          <button type="submit" className="app-button" disabled={busy}>
            {busy ? "Saving…" : "Add failure"}
          </button>
          <span className="fmea-preview">
            Preview RPN: <strong>{previewRpn}</strong>{" "}
            <span className="app-muted">({formatOsdFactors({
              occurrence: Number(form.occurrence) || 1,
              severity: Number(form.severity) || 1,
              detection: Number(form.detection) || 1,
            })})</span>
          </span>
        </div>
      </form>
    </Panel>
  );
}

function FailureList({
  view,
  busy,
  mutate,
  orgId,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
  orgId: string | null;
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
            orgId={orgId}
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
  orgId,
}: {
  evaluation: FmeaEvaluation;
  busy: boolean;
  mutate: Mutate;
  orgId: string | null;
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
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Delete this failure entry?")) {
              mutate({ action: "delete-failure", failureId: f.id });
            }
          }}
        >
          Delete
        </button>
        {f.recordedByName ? <small className="app-muted">Logged by {f.recordedByName}</small> : null}
      </div>

      <div className="fmea-risk-links">
        <a href={hubHref("/team", "knowledge", orgId)}>Document in Knowledge</a>
        <a href={hubHref("/build", "cad", orgId)}>Review in CAD</a>
        <a href={hubHref("/build", "prototype", orgId)}>Prototype the fix</a>
        <a href={withOrgHref("/inventory", orgId)}>Open Inventory</a>
      </div>
    </article>
  );
}
