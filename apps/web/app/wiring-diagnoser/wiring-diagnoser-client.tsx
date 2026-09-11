"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { STANDARD_BREAKER_AMPS, WIRE_GAUGES, diagnosticSeverityLabel } from "../../lib/wiring-diagnoser";
import type { WiringDiagnoserView } from "../../lib/wiring-diagnoser/compute-wiring-diagnoser";
import type {
  DiagnosticSeverity,
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

function isWiringDiagnoserView(value: unknown): value is WiringDiagnoserView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function wiringDiagnoserCacheOrg(data: WiringDiagnoserView, orgHint: string): string {
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

async function persistWiringDiagnoserSnapshot(
  orgHint: string,
  seasonHint: string,
  data: WiringDiagnoserView,
): Promise<void> {
  const cacheOrg = wiringDiagnoserCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("wiring-diagnoser", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("wiring-diagnoser", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Wiring check already painted; IndexedDB is best-effort.
  }
}

function WiringDiagnoserRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related robot tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "readiness-score", orgId)}>
        Readiness
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "power-budget", orgId)}>
        Power budget
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "wiring-map", orgId)}>
        CAN-bus map
      </Button>
    </nav>
  );
}

function WiringDiagnoserNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "check",
      label: "Run a wiring check",
      detail: "Compare the board you see against the stored diagram before a match.",
      href: "#wiring-diagnoser-form",
      primary: true,
    },
    {
      id: "readiness",
      label: "Open Readiness",
      detail: "Wiring flags feed the ship-readiness index.",
      href: hubHref("/build", "readiness-score", orgId),
      primary: false,
    },
    {
      id: "map",
      label: "Open CAN-bus map",
      detail: "Expected channels come from the stored map.",
      href: hubHref("/build", "wiring-map", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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
  multiWireTerminal: boolean;
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
  multiWireTerminal: false,
});

export default function WiringDiagnoserClient() {
  const [view, setView] = useState<WiringDiagnoserView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadErrorMessage, setLoadErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<WiringDiagnoserView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<WiringDiagnoserView>(
        "wiring-diagnoser",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isWiringDiagnoserView(cached.data)) {
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
    setErrorStatus(null);
    setLoadErrorMessage("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/wiring-diagnoser${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadErrorMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isWiringDiagnoserView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Wiring check. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadErrorMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistWiringDiagnoserSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Wiring check. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isWiringDiagnoserView(data)) {
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
        void persistWiringDiagnoserSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Wiring Diagnoser"}
        </>
      }
      title="Wiring / Power Fault Diagnoser"
      description="Compare a board photo against your stored wiring diagram and power budget to flag miswires, undersized breakers, and over-spec channels before they cost you a match."
    >
      <WiringDiagnoserRelated orgId={orgId} />
      {view?.status === "live" && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
          <select
            value={season ?? view.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
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
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadErrorMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadErrorMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Wiring check" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Wiring check" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Wiring check" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <WiringDiagnoserNextActions orgId={view.orgId} />
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
          >
            <Button as="a" variant="primary" href="#wiring-diagnoser-form">
              Run a wiring check
            </Button>
          </EmptyState>
        )}
      </div>
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
      id="wiring-diagnoser-form"
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
              multiWireTerminal: Boolean(row.multiWireTerminal),
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
        <Button variant="secondary" type="button" style={{ marginTop: 8 }} onClick={() => setExpected((prev) => [...prev, emptyExpectedRow()])}>
          Add expected circuit
        </Button>
      </div>

      <div>
        <strong className="app-muted">Observed circuits (from the board photo)</strong>
        <p className="app-muted" style={{ margin: "4px 0 0" }}>
          Tick two wires in a PD terminal only after you see it — R618 / Q58. Do not assume a stuffed ferrule.
        </p>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {observed.map((row, index) => (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "80px 1fr 90px 110px auto auto",
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
              <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={row.multiWireTerminal}
                  onChange={(e) =>
                    setObserved((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, multiWireTerminal: e.target.checked } : item)),
                    )
                  }
                />
                2 wires in PD terminal
              </label>
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
        <Button variant="secondary" type="button" style={{ marginTop: 8 }} onClick={() => setObserved((prev) => [...prev, emptyObservedRow()])}>
          Add observed circuit
        </Button>
      </div>

      <div>
        <Button variant="primary" type="submit" disabled={busy || !canSubmit}>
          Diagnose wiring
        </Button>
      </div>
    </Panel>
  );
}
