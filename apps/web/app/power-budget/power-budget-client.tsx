"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { CallYourShot } from "../../lib/learning/call-your-shot";
import { buildPowerBudgetCall } from "../../lib/learning/surfaces";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Load = {
  id: string;
  name: string;
  subsystem: string;
  motorCount: number | null;
  typicalAmps: number | null;
  peakAmps: number | null;
  breakerAmps: number | null;
  notes: string;
  byName: string | null;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      loads: Load[];
      summary: {
        count: number;
        totalTypicalAmps: number;
        totalPeakAmps: number;
        tripRisks: string[];
        brownoutRisk: boolean | null;
        measuredCount: number;
        unmeasuredCount: number;
        sustainedCeiling: number;
        breakerSizeCues: string[];
        mpmMotorCues: string[];
        currentLimitCue: string | null;
        staggerCue: string | null;
      };
    };

const EMPTY = {
  name: "",
  subsystem: "",
  motorCount: "",
  typicalAmps: "",
  peakAmps: "",
  breakerAmps: "",
  notes: "",
};

function isPowerBudgetView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function powerBudgetCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "ready":
      return data.context.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistPowerBudgetSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = powerBudgetCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("power-budget", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("power-budget", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Power budget already painted; IndexedDB is best-effort.
  }
}

function PowerBudgetRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "wiring-map", orgId)}>
        CAN-bus map
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "batteries", orgId)}>
        Batteries
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "subsystems", orgId)}>
        Subsystem specs
      </Button>
    </nav>
  );
}

function PowerBudgetNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add a load",
      detail: "Log typical and peak amps so brownout risk is real, not guessed.",
      href: "#power-budget-load",
      primary: true,
    },
    {
      id: "wiring",
      label: "Open CAN-bus map",
      detail: "Breaker size on a branch should match the device on that port.",
      href: hubHref("/build", "wiring-map", orgId),
      primary: false,
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "A tired pack browns out sooner than the budget says.",
      href: hubHref("/build", "batteries", orgId),
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

export default function PowerBudgetClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("power-budget", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isPowerBudgetView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/power-budget?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isPowerBudgetView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Power budget. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load power budget",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistPowerBudgetSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Power budget. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/power-budget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addLoad(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_load", seasonYear, ...form }, "Load added.");
    if (view?.status === "ready") setForm({ ...EMPTY, subsystem: form.subsystem });
  }

  const robotHref = hubWorkbenchHref("build", "power-budget", orgId);

  if (!view) {
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
      <main className="module-page">
        <PageHeader
          breadcrumbs={
            <>
              <a href={robotHref}>Build</a>
              {" / Power budget"}
            </>
          }
          title="Power budget"
          description="Typical and peak amps you logged for each branch."
        >
          <PowerBudgetRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Power budget" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading power budget…"}
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
          <PageHeader
            breadcrumbs={
              <>
                <a href={robotHref}>Build</a>
                {" / Power budget"}
              </>
            }
            title="Power budget"
            description="Typical and peak amps you logged for each branch."
          >
            <PowerBudgetRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Power budget" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        </main>
      );
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  const s = view.summary;
  const breakerCues = s.breakerSizeCues ?? [];
  const mpmCues = s.mpmMotorCues ?? [];
  const trip = new Set(s.tripRisks);
  const callLoads = view.loads.map((l) => ({
    name: l.name,
    subsystem: l.subsystem,
    typicalAmps: l.typicalAmps,
    peakAmps: l.peakAmps,
    breakerAmps: l.breakerAmps,
    motorCount: l.motorCount,
    notes: l.notes,
  }));
  const callSignature = JSON.stringify(
    callLoads.map((l) => [l.name, l.typicalAmps, l.peakAmps, l.breakerAmps]),
  );
  const callFieldSet = buildPowerBudgetCall({ loads: callLoads });
  const hasWarnings =
    s.brownoutRisk === true ||
    s.unmeasuredCount > 0 ||
    s.tripRisks.length > 0 ||
    breakerCues.length > 0 ||
    mpmCues.length > 0 ||
    Boolean(s.currentLimitCue) ||
    Boolean(s.staggerCue);
  const brownoutLabel =
    s.brownoutRisk === true ? "Yes" : s.brownoutRisk === false ? "No" : "Not enough data";

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Power budget"}
          </>
        }
        title={`Power budget — ${seasonYear}`}
        description="Typical draw is the running average. Peak is the worst-case on a branch."
      >
        <PowerBudgetRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Power budget" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <CallYourShot
        surface="power_budget"
        orgId={view.context.orgId}
        role={view.context.role}
        fieldSet={callFieldSet}
        inputs={{ loads: callLoads, sustainedCeiling: s.sustainedCeiling }}
        inputSummary={`${s.count} load${s.count === 1 ? "" : "s"} logged against a ${s.sustainedCeiling} A sustained ceiling`}
        signature={callSignature}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <StatTile label="Loads" value={s.count} />
          <StatTile label="Total typical draw" value={`${s.totalTypicalAmps} A`} />
          <StatTile label="Total peak draw" value={`${s.totalPeakAmps} A`} />
          <StatTile
            label="Brownout risk"
            value={brownoutLabel}
            footer={s.unmeasuredCount > 0 ? `${s.measuredCount} of ${s.count} loads measured` : undefined}
          />
        </div>
        {hasWarnings ? (
          <Panel>
            <h2>Power warnings</h2>
            {s.brownoutRisk === true ? (
              <p>
                Brownout risk: {s.totalTypicalAmps} A typical draw exceeds the {s.sustainedCeiling} A sustained
                ceiling. Expect voltage sag under load.
              </p>
            ) : null}
            {s.currentLimitCue ? <p>{s.currentLimitCue}</p> : null}
            {s.staggerCue ? <p>{s.staggerCue}</p> : null}
            {s.tripRisks.map((name) => (
              <p key={name}>{name}: peak current exceeds its branch breaker — it will trip.</p>
            ))}
            {breakerCues.map((cue) => (
              <p key={cue}>{cue}</p>
            ))}
            {mpmCues.map((cue) => (
              <p key={cue}>{cue}</p>
            ))}
          </Panel>
        ) : null}
      </CallYourShot>

      <Panel as="form" id="power-budget-load" onSubmit={addLoad}>
        <h2>Add a load</h2>
        <FormGrid min={160}>
          <FormRow label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Drivetrain"
            />
          </FormRow>
          <FormRow label="Subsystem">
            <input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} />
          </FormRow>
          <FormRow label="Motors">
            <input
              type="number"
              min="0"
              value={form.motorCount}
              onChange={(e) => setForm({ ...form, motorCount: e.target.value })}
            />
          </FormRow>
          <FormRow label="Breaker (A)">
            <input
              type="number"
              min="0"
              value={form.breakerAmps}
              onChange={(e) => setForm({ ...form, breakerAmps: e.target.value })}
              placeholder="40"
            />
          </FormRow>
          <FormRow label="Typical (A)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.typicalAmps}
              onChange={(e) => setForm({ ...form, typicalAmps: e.target.value })}
              placeholder="40"
            />
          </FormRow>
          <FormRow label="Peak (A)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.peakAmps}
              onChange={(e) => setForm({ ...form, peakAmps: e.target.value })}
              placeholder="120"
            />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes" wide>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        <Button variant="primary" type="submit">
          Add load
        </Button>
      </Panel>

      <Panel>
        <h2>How to read it</h2>
        <p className="app-muted">
          Typical draw is your running average; keep it under ~{s.sustainedCeiling} A to avoid brownouts on a
          fresh battery. Peak is the worst-case per branch — if it tops the branch breaker, that breaker trips
          and you lose the mechanism mid-match.
        </p>
      </Panel>

      <Panel>
        <h2>Loads</h2>
        {view.loads.length === 0 ? (
          <p className="app-muted">No loads yet — add your drivetrain and mechanisms.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.loads.map((l) => (
              <li key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {l.name}
                    {l.motorCount ? ` · ${l.motorCount} motors` : ""}
                    {trip.has(l.name) ? " · trip risk" : ""}
                  </strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {l.typicalAmps != null ? `${l.typicalAmps}A typical` : "no typical"}
                    {l.peakAmps != null ? ` · ${l.peakAmps}A peak` : ""}
                    {l.breakerAmps != null ? ` · ${l.breakerAmps}A breaker` : ""}
                    {l.subsystem ? ` · ${l.subsystem}` : ""}
                    {l.notes ? ` · ${l.notes}` : ""}
                  </small>
                </div>
                {view.context.role !== "viewer" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void post({ action: "delete_load", id: l.id }, "Load removed.")}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PowerBudgetNextActions orgId={view.context.orgId} />
    </main>
  );
}
