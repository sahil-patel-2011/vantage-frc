"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { inspectionFlagSeverityLabel } from "../../lib/inspection-copilot";
import type { InspectionCopilotView } from "../../lib/inspection-copilot/compute-inspection-copilot";
import type { InspectionFlagSeverity } from "../../lib/inspection-copilot/types";

const SEVERITY_TONE: Record<InspectionFlagSeverity, string> = {
  critical: "demo",
  warning: "setup",
  info: "good",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<InspectionCopilotView, { status: "live" }>;

type WeightItemDraft = { name: string; weightLbs: string };

const emptyWeightRow = (): WeightItemDraft => ({ name: "", weightLbs: "" });

export default function InspectionCopilotClient() {
  const [view, setView] = useState<InspectionCopilotView | null>(null);
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
    void fetch(`/api/inspection-copilot${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as InspectionCopilotView | { error?: string };
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
        const response = await fetch("/api/inspection-copilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as InspectionCopilotView | { error?: string };
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
            {" / Inspection Copilot"}
          </>
        }
        title="Inspection-Readiness Copilot"
        description="Compare your declared weight budget, frame/bumper limits, and wiring/power limits against the measured robot to predict inspection failures before you travel."
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
          title="Could not load the inspection copilot"
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
          <NewCheckForm busy={busy} mutate={mutate} />
          {view.checks.length > 0 ? (
            <ChecksList view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No checks yet"
              badgeTone="setup"
              title="Run your first inspection-readiness check"
              description="Enter your weight budget, frame/bumper limits, and wiring/power limits alongside the measured robot to get a grounded failure prediction."
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
      <h2 style={{ marginTop: 0 }}>Inspection checks</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.checks.map((check) => (
          <li key={check.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${check.flags.length === 0 ? "good" : "demo"}`}>
                  {check.flags.length === 0 ? "Clean" : `${check.flags.length} flag(s)`}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{check.robotName}</strong>
                <small className="app-muted">
                  {check.totalWeightLbs} lbs · risk {pct(check.riskScore)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${check.robotName}" check?`)) {
                    mutate({ action: "delete-check", checkId: check.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            <p style={{ margin: 0 }}>{check.summary}</p>
            {check.flags.length > 0 ? (
              <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
                {check.flags.map((flag, index) => (
                  <li key={`${check.id}-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>
                      <span className={`app-badge ${SEVERITY_TONE[flag.severity]}`}>
                        {inspectionFlagSeverityLabel(flag.severity)}
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
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [robotName, setRobotName] = useState("");
  const [weightLimitLbs, setWeightLimitLbs] = useState("125");
  const [weightItems, setWeightItems] = useState<WeightItemDraft[]>([emptyWeightRow()]);

  const [perimeterLimitIn, setPerimeterLimitIn] = useState("120");
  const [measuredPerimeterIn, setMeasuredPerimeterIn] = useState("");
  const [bumperMinHeightIn, setBumperMinHeightIn] = useState("2.5");
  const [bumperMaxHeightIn, setBumperMaxHeightIn] = useState("7.5");
  const [measuredBumperMinHeightIn, setMeasuredBumperMinHeightIn] = useState("");
  const [measuredBumperMaxHeightIn, setMeasuredBumperMaxHeightIn] = useState("");
  const [bumperMinThicknessIn, setBumperMinThicknessIn] = useState("1");
  const [measuredBumperThicknessIn, setMeasuredBumperThicknessIn] = useState("");

  const [mainBreakerMaxAmps, setMainBreakerMaxAmps] = useState("120");
  const [installedMainBreakerAmps, setInstalledMainBreakerAmps] = useState("120");
  const [batterySecured, setBatterySecured] = useState(false);
  const [wiresLabeled, setWiresLabeled] = useState(false);
  const [radioPowerOk, setRadioPowerOk] = useState(false);
  const [bypassSwitchAccessible, setBypassSwitchAccessible] = useState(false);

  const setWeightField = (index: number, key: keyof WeightItemDraft) => (event: { target: { value: string } }) =>
    setWeightItems((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: event.target.value } : row)));

  const canSubmit = useMemo(
    () => robotName.trim().length > 0 && weightItems.some((row) => row.name.trim() && row.weightLbs !== ""),
    [robotName, weightItems],
  );

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;
        mutate({
          action: "log-check",
          robotName,
          weightBudget: {
            limitLbs: Number(weightLimitLbs) || 0,
            items: weightItems
              .filter((row) => row.name.trim() && row.weightLbs !== "")
              .map((row) => ({ name: row.name, weightLbs: Number(row.weightLbs) || 0 })),
          },
          frameBumper: {
            perimeterLimitIn: Number(perimeterLimitIn) || 0,
            measuredPerimeterIn: Number(measuredPerimeterIn) || 0,
            bumperMinHeightIn: Number(bumperMinHeightIn) || 0,
            bumperMaxHeightIn: Number(bumperMaxHeightIn) || 0,
            measuredBumperMinHeightIn: Number(measuredBumperMinHeightIn) || 0,
            measuredBumperMaxHeightIn: Number(measuredBumperMaxHeightIn) || 0,
            bumperMinThicknessIn: Number(bumperMinThicknessIn) || 0,
            measuredBumperThicknessIn: Number(measuredBumperThicknessIn) || 0,
          },
          wiringPower: {
            mainBreakerMaxAmps: Number(mainBreakerMaxAmps) || 0,
            installedMainBreakerAmps: Number(installedMainBreakerAmps) || 0,
            batterySecured,
            wiresLabeled,
            radioPowerOk,
            bypassSwitchAccessible,
          },
        });
        setRobotName("");
        setWeightItems([emptyWeightRow()]);
        setMeasuredPerimeterIn("");
        setMeasuredBumperMinHeightIn("");
        setMeasuredBumperMaxHeightIn("");
        setMeasuredBumperThicknessIn("");
        setBatterySecured(false);
        setWiresLabeled(false);
        setRadioPowerOk(false);
        setBypassSwitchAccessible(false);
      }}
      style={{ display: "grid", gap: 12 }}
    >
      <h2 style={{ margin: 0 }}>Run an inspection-readiness check</h2>
      <FormGrid min={200}>
        <FormRow label="Robot name">
          <input value={robotName} onChange={(e) => setRobotName(e.target.value)} placeholder="2026 Competition Bot" required />
        </FormRow>
        <FormRow label="Weight limit (lbs)">
          <input type="number" min={0} value={weightLimitLbs} onChange={(e) => setWeightLimitLbs(e.target.value)} />
        </FormRow>
      </FormGrid>

      <div>
        <strong className="app-muted">Weight budget (itemized weigh-in)</strong>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {weightItems.map((row, index) => (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, alignItems: "center" }}>
              <input
                placeholder="Component (e.g. Chassis)"
                value={row.name}
                onChange={setWeightField(index, "name")}
              />
              <input
                type="number"
                min={0}
                placeholder="Weight (lbs)"
                value={row.weightLbs}
                onChange={setWeightField(index, "weightLbs")}
              />
              <button
                type="button"
                className="text-button"
                onClick={() => setWeightItems((prev) => prev.filter((_, i) => i !== index))}
                disabled={weightItems.length <= 1}
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
          onClick={() => setWeightItems((prev) => [...prev, emptyWeightRow()])}
        >
          Add weight item
        </button>
      </div>

      <div>
        <strong className="app-muted">Frame / bumper limits vs measured</strong>
        <FormGrid min={180}>
          <FormRow label="Perimeter limit (in)">
            <input type="number" min={0} value={perimeterLimitIn} onChange={(e) => setPerimeterLimitIn(e.target.value)} />
          </FormRow>
          <FormRow label="Measured perimeter (in)">
            <input type="number" min={0} value={measuredPerimeterIn} onChange={(e) => setMeasuredPerimeterIn(e.target.value)} />
          </FormRow>
          <FormRow label="Bumper min height (in)">
            <input type="number" min={0} value={bumperMinHeightIn} onChange={(e) => setBumperMinHeightIn(e.target.value)} />
          </FormRow>
          <FormRow label="Bumper max height (in)">
            <input type="number" min={0} value={bumperMaxHeightIn} onChange={(e) => setBumperMaxHeightIn(e.target.value)} />
          </FormRow>
          <FormRow label="Measured bumper min height (in)">
            <input
              type="number"
              min={0}
              value={measuredBumperMinHeightIn}
              onChange={(e) => setMeasuredBumperMinHeightIn(e.target.value)}
            />
          </FormRow>
          <FormRow label="Measured bumper max height (in)">
            <input
              type="number"
              min={0}
              value={measuredBumperMaxHeightIn}
              onChange={(e) => setMeasuredBumperMaxHeightIn(e.target.value)}
            />
          </FormRow>
          <FormRow label="Bumper min thickness (in)">
            <input
              type="number"
              min={0}
              value={bumperMinThicknessIn}
              onChange={(e) => setBumperMinThicknessIn(e.target.value)}
            />
          </FormRow>
          <FormRow label="Measured bumper thickness (in)">
            <input
              type="number"
              min={0}
              value={measuredBumperThicknessIn}
              onChange={(e) => setMeasuredBumperThicknessIn(e.target.value)}
            />
          </FormRow>
        </FormGrid>
      </div>

      <div>
        <strong className="app-muted">Wiring / power limits vs installed</strong>
        <FormGrid min={180}>
          <FormRow label="Main breaker max (A)">
            <input type="number" min={0} value={mainBreakerMaxAmps} onChange={(e) => setMainBreakerMaxAmps(e.target.value)} />
          </FormRow>
          <FormRow label="Installed main breaker (A)">
            <input
              type="number"
              min={0}
              value={installedMainBreakerAmps}
              onChange={(e) => setInstalledMainBreakerAmps(e.target.value)}
            />
          </FormRow>
        </FormGrid>
        <fieldset style={{ border: "none", padding: 0, margin: "8px 0 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={batterySecured} onChange={(e) => setBatterySecured(e.target.checked)} />
            Battery secured
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={wiresLabeled} onChange={(e) => setWiresLabeled(e.target.checked)} />
            Wires labeled
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={radioPowerOk} onChange={(e) => setRadioPowerOk(e.target.checked)} />
            Radio power OK
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={bypassSwitchAccessible}
              onChange={(e) => setBypassSwitchAccessible(e.target.checked)}
            />
            Bypass switch accessible
          </label>
        </fieldset>
      </div>

      <div>
        <button type="submit" className="app-button" disabled={busy || !canSubmit}>
          Predict inspection failures
        </button>
      </div>
    </Panel>
  );
}
