"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { STANDARD_BREAKER_AMPS, WIRE_GAUGES, diagnosticSeverityLabel } from "../../lib/wiring-diagnoser";
import {
  currentSeasonYear,
  type WiringDiagnoserView,
} from "../../lib/wiring-diagnoser/compute-wiring-diagnoser";
import type {
  DiagnosticSeverity,
  ExpectedCircuit,
  ObservedCircuit,
  WireGauge,
  WiringMapDevice,
} from "../../lib/wiring-diagnoser/types";

const SEVERITY_TONE: Record<DiagnosticSeverity, string> = {
  critical: "demo",
  warning: "setup",
  info: "good",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<WiringDiagnoserView, { status: "live" }>;

type ExpectedDraft = {
  channel: string;
  deviceName: string;
  wireGauge: WireGauge;
  breakerAmps: string;
  expectedCurrentDrawAmps: string;
};

type ObservedDraft = {
  channel: string;
  deviceName: string;
  wireGauge: WireGauge;
  breakerAmps: string;
};

const emptyExpectedRow = (): ExpectedDraft => ({
  channel: "",
  deviceName: "",
  wireGauge: "18",
  breakerAmps: String(STANDARD_BREAKER_AMPS[3] ?? 15),
  expectedCurrentDrawAmps: "",
});

const emptyObservedRow = (): ObservedDraft => ({
  channel: "",
  deviceName: "",
  wireGauge: "18",
  breakerAmps: String(STANDARD_BREAKER_AMPS[3] ?? 15),
});

export default function WiringDiagnoserClient() {
  const [view, setView] = useState<WiringDiagnoserView | null>(null);
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
    void fetch(`/api/wiring-diagnoser${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as WiringDiagnoserView | { error?: string };
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/wiring-diagnoser", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as WiringDiagnoserView | { error?: string };
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Wiring Diagnoser"}
          </>
        }
        title="Wiring / Power Fault Diagnoser"
        description="Compare a board photo against your stored wiring diagram and power budget to flag miswires, undersized breakers, and over-spec channels before they cost you a match."
      >
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the wiring diagnoser"
          description="A network or server issue prevented loading. Try again."
        >
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
          <NewCheckForm busy={busy} mutate={mutate} wiringMap={view.wiringMap} />
          {view.checks.length > 0 ? (
            <ChecksList view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No checks yet"
              badgeTone="setup"
              title="Run your first wiring check"
              description="Enter the channels from your wiring diagram (expected) and what you see on the board (observed) to get a grounded fault diagnosis."
            />
          )}
        </div>
      )}
    </main>
  );
}

function ChecksList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Wiring checks</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.checks.map((check) => (
          <li key={check.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${check.flags.length === 0 ? "good" : "demo"}`}>
                  {check.flags.length === 0 ? "Clean" : `${check.flags.length} flag(s)`}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{check.boardName}</strong>
                <small className="app-muted">
                  {check.expectedCircuits.length} circuit(s) · risk {pct(check.riskScore)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${check.boardName}" check?`)) {
                    mutate({ action: "delete-check", checkId: check.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            <p style={{ margin: 0 }}>{check.summary}</p>
            {check.photoUrl ? (
              <a href={check.photoUrl} target="_blank" rel="noreferrer">
                View board photo
              </a>
            ) : null}
            {check.flags.length > 0 ? (
              <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
                {check.flags.map((flag, index) => (
                  <li key={`${check.id}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>
                      <span className={`app-badge ${SEVERITY_TONE[flag.severity]}`}>
                        {diagnosticSeverityLabel(flag.severity)}
                      </span>{" "}
                      {flag.message}
                    </span>
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

function NewCheckForm({
  busy,
  mutate,
  wiringMap,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  wiringMap: WiringMapDevice[];
}) {
  const [boardName, setBoardName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [expected, setExpected] = useState<ExpectedDraft[]>([emptyExpectedRow()]);
  const [observed, setObserved] = useState<ObservedDraft[]>([emptyObservedRow()]);

  const prefillFromWiringMap = () => {
    if (wiringMap.length === 0) return;
    setExpected(
      wiringMap.map((device) => ({
        ...emptyExpectedRow(),
        channel: String(device.channel),
        deviceName: device.deviceName,
        breakerAmps: device.breakerAmps != null ? String(device.breakerAmps) : emptyExpectedRow().breakerAmps,
      })),
    );
  };

  const setExpectedField = (index: number, key: keyof ExpectedDraft) => (event: { target: { value: string } }) =>
    setExpected((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: event.target.value } : row)));

  const setObservedField = (index: number, key: keyof ObservedDraft) => (event: { target: { value: string } }) =>
    setObserved((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: event.target.value } : row)));

  const canSubmit = useMemo(
    () => boardName.trim().length > 0 && expected.some((row) => row.deviceName.trim() && row.channel !== ""),
    [boardName, expected],
  );

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        mutate({
          action: "log-check",
          boardName,
          photoUrl: photoUrl || undefined,
          expectedCircuits: expected
            .filter((row) => row.deviceName.trim() && row.channel !== "")
            .map((row) => ({
              channel: Number(row.channel) || 0,
              deviceName: row.deviceName,
              wireGauge: row.wireGauge,
              breakerAmps: Number(row.breakerAmps) || 0,
              expectedCurrentDrawAmps: Number(row.expectedCurrentDrawAmps) || 0,
            })),
          observedCircuits: observed
            .filter((row) => row.deviceName.trim() && row.channel !== "")
            .map((row) => ({
              channel: Number(row.channel) || 0,
              deviceName: row.deviceName,
              wireGauge: row.wireGauge,
              breakerAmps: Number(row.breakerAmps) || 0,
            })),
        });
        setBoardName("");
        setPhotoUrl("");
        setExpected([emptyExpectedRow()]);
        setObserved([emptyObservedRow()]);
      }}
      style={{ display: "grid", gap: 12 }}
    >
      <h2 style={{ margin: 0 }}>Run a wiring check</h2>
      <FormGrid min={200}>
        <FormRow label="Board name">
          <input value={boardName} onChange={(e) => setBoardName(e.target.value)} placeholder="Drivetrain PDH" required />
        </FormRow>
        <FormRow label="Board photo URL (optional)">
          <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://…" />
        </FormRow>
      </FormGrid>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong className="app-muted">Expected circuits (wiring diagram + power budget)</strong>
          {wiringMap.length > 0 ? (
            <button type="button" className="text-button" onClick={prefillFromWiringMap}>
              Prefill from wiring map ({wiringMap.length})
            </button>
          ) : null}
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {expected.map((row, index) => (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr 90px 110px 110px auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                type="number"
                min={0}
                placeholder="Ch."
                value={row.channel}
                onChange={setExpectedField(index, "channel")}
              />
              <input
                placeholder="Device (e.g. Front Left Drive)"
                value={row.deviceName}
                onChange={setExpectedField(index, "deviceName")}
              />
              <select value={row.wireGauge} onChange={setExpectedField(index, "wireGauge")}>
                {WIRE_GAUGES.map((gauge) => (
                  <option key={gauge} value={gauge}>
                    {gauge} AWG
                  </option>
                ))}
              </select>
              <select value={row.breakerAmps} onChange={setExpectedField(index, "breakerAmps")}>
                {STANDARD_BREAKER_AMPS.map((amps) => (
                  <option key={amps} value={amps}>
                    {amps}A breaker
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                placeholder="Draw (A)"
                value={row.expectedCurrentDrawAmps}
                onChange={setExpectedField(index, "expectedCurrentDrawAmps")}
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setExpected((prev) => prev.filter((_, i) => i !== index))}
                disabled={expected.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="app-button secondary"
          style={{ marginTop: 8 }}
          onClick={() => setExpected((prev) => [...prev, emptyExpectedRow()])}
        >
          Add expected circuit
        </button>
      </div>

      <div>
        <strong className="app-muted">Observed circuits (from the board photo)</strong>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {observed.map((row, index) => (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr 90px 110px auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                type="number"
                min={0}
                placeholder="Ch."
                value={row.channel}
                onChange={setObservedField(index, "channel")}
              />
              <input
                placeholder="Device actually wired"
                value={row.deviceName}
                onChange={setObservedField(index, "deviceName")}
              />
              <select value={row.wireGauge} onChange={setObservedField(index, "wireGauge")}>
                {WIRE_GAUGES.map((gauge) => (
                  <option key={gauge} value={gauge}>
                    {gauge} AWG
                  </option>
                ))}
              </select>
              <select value={row.breakerAmps} onChange={setObservedField(index, "breakerAmps")}>
                {STANDARD_BREAKER_AMPS.map((amps) => (
                  <option key={amps} value={amps}>
                    {amps}A breaker
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                onClick={() => setObserved((prev) => prev.filter((_, i) => i !== index))}
                disabled={observed.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="app-button secondary"
          style={{ marginTop: 8 }}
          onClick={() => setObserved((prev) => [...prev, emptyObservedRow()])}
        >
          Add observed circuit
        </button>
      </div>

      <div>
        <button type="submit" className="app-button" disabled={busy || !canSubmit}>
          Diagnose wiring
        </button>
      </div>
    </Panel>
  );
}
