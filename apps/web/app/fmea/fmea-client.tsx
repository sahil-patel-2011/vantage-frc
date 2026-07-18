"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { TeamHubRelated } from "../../components/team-hub-related";
import { fmeaContextLabel, fmeaLevelLabel, fmeaStatusLabel } from "../../lib/fmea";
import { FMEA_CONTEXTS, FMEA_STATUSES, type FmeaView } from "../../lib/fmea/compute-fmea";
import type { FmeaContext, FmeaEvaluation, FmeaLevel, FmeaStatus } from "../../lib/fmea/types";
import { hubHref } from "../../lib/nav/hubs";

type LiveView = Extract<FmeaView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const LEVEL_COLOR: Record<FmeaLevel, string> = {
  low: "#2f9e57",
  moderate: "#c9a900",
  high: "#d9822b",
  critical: "#c02626",
};

const SCALES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function FmeaClient() {
  const [view, setView] = useState<FmeaView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
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

  const orgQuery = orgId ? `?orgId=${orgId}` : "";

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / FMEA"
        title="Failure Log (FMEA)"
        description={
          <>
            Capture every in-match and pit failure against a subsystem. Score occurrence, severity, and
            detection, record root cause and fix — so the weakest system is queryable, not tribal knowledge.
          </>
        }
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {view?.status === "live" && view.seasons.length > 0 ? (
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
          <a className="app-button secondary" href={`/subsystems${orgQuery}`}>
            Subsystems
          </a>
          <a className="app-button secondary" href={`/inspection${orgQuery}`}>
            Inspection
          </a>
          <a className="app-button secondary" href={hubHref("/team", "knowledge", orgId)}>
            Knowledge
          </a>
          <a className="app-button secondary" href={hubHref("/team", "batteries", orgId)}>
            Batteries
          </a>
        </div>
      </PageHeader>
      {orgId ? <TeamHubRelated orgId={orgId} active="fmea" /> : null}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState title="Could not load the failure log" description="A network or server issue prevented loading. Try again.">
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <BatteryReliabilitySignals view={view} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
            <SubsystemHotspots view={view} orgQuery={orgQuery} />
            <TopFailures view={view} />
          </div>
          <AddFailureForm view={view} busy={busy} mutate={mutate} />
          <FailureList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}


function BatteryReliabilitySignals({ view }: { view: LiveView }) {
  if (!view.batterySignals?.length) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Battery reliability → FMEA</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Derived from logged pack measurements — not invented. Promote into the failure log when you confirm a mode.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
        {view.batterySignals.map((signal) => (
          <li key={signal.id} style={{ borderTop: "1px solid var(--app-border, #e5e7eb)", paddingTop: 10 }}>
            <strong>{signal.title}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              L{signal.likelihood} × I{signal.impact} · {signal.category}
            </span>
            <span style={{ display: "block" }}>{signal.detail}</span>
            <a href={signal.href}>Open Batteries</a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Active failures", value: String(s.active) },
    { label: "Critical + high", value: String(s.byLevel.critical + s.byLevel.high) },
    { label: "Top RPN", value: String(s.highestRpn) },
    { label: "Needs fix", value: String(s.needsFix.length) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {(["critical", "high", "moderate", "low"] as FmeaLevel[]).map((level) => (
          <span
            key={level}
            className="app-badge"
            style={{ background: LEVEL_COLOR[level], color: "#fff" }}
            title={`${s.byLevel[level]} active`}
          >
            {fmeaLevelLabel(level)}: {s.byLevel[level]}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function SubsystemHotspots({ view, orgQuery }: { view: LiveView; orgQuery: string }) {
  if (view.summary.bySubsystem.length === 0) {
    return (
      <Panel>
        <h2 style={{ marginTop: 0 }}>Failure-prone subsystems</h2>
        <p className="app-muted">No failures logged yet. Link entries to subsystems to see the ranking.</p>
        <a href={`/subsystems${orgQuery}`}>Open subsystems →</a>
      </Panel>
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Failure-prone subsystems</h2>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
        {view.summary.bySubsystem.slice(0, 8).map((row) => (
          <li key={`${row.subsystemId ?? row.subsystemName}`}>
            <strong>{row.subsystemName}</strong>{" "}
            <span className="app-badge" style={{ background: LEVEL_COLOR[row.level], color: "#fff" }}>
              {row.count}× · avg RPN {row.avgRpn}
            </span>
            {row.openCount > 0 ? (
              <small className="app-muted"> · {row.openCount} open</small>
            ) : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function TopFailures({ view }: { view: LiveView }) {
  if (view.summary.topFailures.length === 0) {
    return (
      <Panel>
        <h2 style={{ marginTop: 0 }}>Highest RPN</h2>
        <p className="app-muted">No active failures — keep logging when something breaks.</p>
      </Panel>
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Highest RPN</h2>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.summary.topFailures.map((evaluation) => (
          <li key={evaluation.failure.id}>
            <strong>{evaluation.failure.title}</strong>{" "}
            <span className="app-badge" style={{ background: LEVEL_COLOR[evaluation.level], color: "#fff" }}>
              {evaluation.rpn}
            </span>
            <small className="app-muted">
              {" "}
              · {evaluation.failure.subsystemName} · {fmeaContextLabel(evaluation.failure.context)}
            </small>
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
    }),
    [],
  );
  const [form, setForm] = useState(empty);

  const previewRpn =
    (Number(form.occurrence) || 1) * (Number(form.severity) || 1) * (Number(form.detection) || 1);

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Log a failure</h2>
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
        </FormGrid>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button type="submit" className="app-button" disabled={busy}>
            {busy ? "Saving…" : "Add failure"}
          </button>
          <span className="app-muted">
            Preview RPN: <strong>{previewRpn}</strong>
          </span>
        </div>
      </form>
    </Panel>
  );
}

function FailureList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.evaluations.length === 0) {
    return (
      <EmptyState
        title="No failures logged"
        description="When something breaks in the pit or on the field, log it here with O/S/D scores so the team can see patterns across events."
      />
    );
  }

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Season log</h2>
      <div style={{ display: "grid", gap: 12 }}>
        {view.evaluations.map((evaluation) => (
          <FailureCard key={evaluation.failure.id} evaluation={evaluation} busy={busy} mutate={mutate} />
        ))}
      </div>
    </Panel>
  );
}

function FailureCard({
  evaluation,
  busy,
  mutate,
}: {
  evaluation: FmeaEvaluation;
  busy: boolean;
  mutate: Mutate;
}) {
  const f = evaluation.failure;
  return (
    <article
      style={{
        borderTop: "1px solid color-mix(in srgb, var(--app-border, #d7dde8) 80%, transparent)",
        paddingTop: 12,
        display: "grid",
        gap: 8,
      }}
    >
      <header style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ fontSize: "1.05rem" }}>{f.title}</strong>
        <span className="app-badge" style={{ background: LEVEL_COLOR[evaluation.level], color: "#fff" }}>
          RPN {evaluation.rpn}
        </span>
        <span className="app-muted">
          O{f.occurrence} · S{f.severity} · D{f.detection}
        </span>
        <span className="app-muted">
          · {f.subsystemName} · {fmeaContextLabel(f.context)}
        </span>
      </header>
      {f.failureMode ? <p style={{ margin: 0 }}>{f.failureMode}</p> : null}
      {f.rootCause ? (
        <p style={{ margin: 0 }}>
          <span className="app-muted">Root cause: </span>
          {f.rootCause}
        </p>
      ) : null}
      {f.fix ? (
        <p style={{ margin: 0 }}>
          <span className="app-muted">Fix: </span>
          {f.fix}
        </p>
      ) : evaluation.needsFix ? (
        <p style={{ margin: 0, color: "#c02626" }}>No fix recorded yet.</p>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
    </article>
  );
}
