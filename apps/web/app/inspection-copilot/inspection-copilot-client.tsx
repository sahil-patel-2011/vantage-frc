"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { inspectionFlagSeverityLabel } from "../../lib/inspection-copilot";
import type { InspectionCopilotView } from "../../lib/inspection-copilot/compute-inspection-copilot";
import {
  INSPECTION_COPILOT_RELATED_INCLUDE,
  classifyInspectionCopilotShell,
  formatInspectionCopilotMetric,
  formatInspectionRiskPct,
  inspectionCopilotNextActions,
  inspectionCopilotRelatedLinks,
  inspectionCopilotShellCopy,
  type InspectionCopilotNextAction,
  type InspectionCopilotShellKind,
} from "../../lib/inspection-copilot/inspection-copilot-related";
import type { InspectionFlagSeverity } from "../../lib/inspection-copilot/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./inspection-copilot.css";

const SEVERITY_TONE: Record<InspectionFlagSeverity, string> = {
  critical: "danger",
  warning: "demo",
  info: "good",
};

type LiveView = Extract<InspectionCopilotView, { status: "live" }>;

type WeightItemDraft = { name: string; weightLbs: string };

const emptyWeightRow = (): WeightItemDraft => ({ name: "", weightLbs: "" });

function InspectionRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = inspectionCopilotRelatedLinks(orgId, {
    include: [...INSPECTION_COPILOT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related inspection-copilot-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function InspectionNextActionsPanel({ actions }: { actions: InspectionCopilotNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions inspection-copilot-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Batteries, FMEA, and Subsystems — never DEMO risk scores.</p>
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

function InspectionShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: InspectionCopilotShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = inspectionCopilotNextActions({ orgId, shell });
  const copy = inspectionCopilotShellCopy(shell);
  const buildHref = hubHref("/build", "fmea", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const fmeaHref = hubHref("/build", "fmea", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);

  return (
    <main className="module-page inspection-copilot-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Inspection Copilot"}
          </>
        }
        title="Inspection-Readiness Copilot"
        description={description}
      >
        <InspectionRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No checks yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href="#inspection-copilot-form">
              Run a check
            </a>
            <a className="app-button secondary" href={batteriesHref}>
              Open Batteries
            </a>
            <a className="app-button secondary" href={fmeaHref}>
              Open FMEA
            </a>
            <a className="app-button secondary" href={subsystemsHref}>
              Open Subsystems
            </a>
          </>
        ) : null}
      </EmptyState>
      <InspectionNextActionsPanel actions={actions} />
    </main>
  );
}

export default function InspectionCopilotClient() {
  const [view, setView] = useState<InspectionCopilotView | null>(null);
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const checkCount = view?.status === "live" ? view.checks.length : 0;
  const flaggedCount =
    view?.status === "live" ? view.checks.filter((check) => check.flags.length > 0).length : 0;
  const criticalCount =
    view?.status === "live"
      ? view.checks.reduce(
          (sum, check) => sum + check.flags.filter((flag) => flag.severity === "critical").length,
          0,
        )
      : 0;
  const latestRisk =
    view?.status === "live" && view.checks[0] ? view.checks[0].riskScore : null;

  const shell = classifyInspectionCopilotShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    checkCount,
  });
  const shellCopy = inspectionCopilotShellCopy(shell);
  const nextActions = inspectionCopilotNextActions({
    orgId,
    shell,
    checkCount,
    flaggedCount,
    criticalCount,
  });
  const relatedLinks = inspectionCopilotRelatedLinks(orgId, {
    include: [...INSPECTION_COPILOT_RELATED_INCLUDE],
  });
  const buildHref = hubHref("/build", "fmea", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const fmeaHref = hubHref("/build", "fmea", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);

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

  if (shell === "loading") {
    return (
      <InspectionShell description={shellCopy.description} orgId={null} shell="loading" />
    );
  }

  if (shell === "error") {
    return (
      <InspectionShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <InspectionShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <InspectionShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page inspection-copilot-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Inspection Copilot"}
          </>
        }
        title="Inspection-Readiness Copilot"
        description="Compare declared weight, frame/bumper, and wiring limits against measured robot values before you travel. Cross-check Batteries, FMEA, and Subsystems — never DEMO risk scores."
      >
        <div className="inspection-copilot-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted inspection-copilot-season">
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
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <InspectionNextActionsPanel actions={nextActions} />

      <SummaryTiles
        checkCount={checkCount}
        flaggedCount={flaggedCount}
        criticalCount={criticalCount}
        latestRisk={latestRisk}
        loaded
      />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No checks yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#inspection-copilot-form">
            Run a check
          </a>
          <a className="app-button secondary" href={batteriesHref}>
            Open Batteries
          </a>
          <a className="app-button secondary" href={fmeaHref}>
            Open FMEA
          </a>
          <a className="app-button secondary" href={subsystemsHref}>
            Open Subsystems
          </a>
        </EmptyState>
      ) : null}

      <div className="inspection-copilot-layout">
        <NewCheckForm busy={busy} mutate={mutate} />
        {shell === "ready" ? (
          <>
            <ChecksList view={view} busy={busy} mutate={mutate} />
            <Panel className="inspection-copilot-tip" aria-label="Readiness tip">
              <span className="eyebrow">Before travel</span>
              <p className="app-muted" style={{ marginTop: 8 }}>
                Resolve critical flags from logged measurements first. Keep{" "}
                <a href={batteriesHref}>Batteries</a>, <a href={fmeaHref}>FMEA</a>, and{" "}
                <a href={subsystemsHref}>Subsystems</a> aligned with weigh-in rows — never invent DEMO
                risk scores.
              </p>
            </Panel>
          </>
        ) : null}
      </div>
    </main>
  );
}

function SummaryTiles({
  checkCount,
  flaggedCount,
  criticalCount,
  latestRisk,
  loaded,
}: {
  checkCount: number;
  flaggedCount: number;
  criticalCount: number;
  latestRisk: number | null;
  loaded: boolean;
}) {
  const hasChecks = checkCount > 0;
  const tiles = [
    { label: "Checks", value: formatInspectionCopilotMetric(checkCount, loaded) },
    { label: "Flagged", value: formatInspectionCopilotMetric(flaggedCount, loaded) },
    { label: "Critical flags", value: formatInspectionCopilotMetric(criticalCount, loaded) },
    {
      label: "Latest risk",
      value: formatInspectionRiskPct(latestRisk, loaded, hasChecks),
    },
  ];
  return (
    <Panel className="inspection-copilot-coverage" aria-label="Inspection Copilot summary">
      <div className="inspection-copilot-stats">
        <div>
          <span
            className={`app-badge ${
              checkCount === 0 ? "setup" : criticalCount > 0 ? "danger" : flaggedCount > 0 ? "demo" : "good"
            }`}
          >
            {checkCount === 0 ? "EMPTY" : criticalCount > 0 ? "CRITICAL" : flaggedCount > 0 ? "FLAGS" : "CLEAN"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Season readiness</h2>
          <small className="app-muted">Logged measurements only — never DEMO risk scores</small>
        </div>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <small className="app-muted" style={{ display: "block" }}>
              {tile.label}
            </small>
          </div>
        ))}
      </div>
    </Panel>
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
    <Panel id="inspection-copilot-checks" className="inspection-copilot-panel">
      <h2 style={{ marginTop: 0 }}>Inspection checks</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Flags and risk come only from limits and measurements you logged.
      </p>
      <ul className="inspection-copilot-list">
        {view.checks.map((check) => (
          <li key={check.id} className="app-card soft-panel inspection-copilot-card">
            <header className="inspection-copilot-card-head">
              <div>
                <span className={`app-badge ${check.flags.length === 0 ? "good" : "danger"}`}>
                  {check.flags.length === 0
                    ? "Clean"
                    : `${formatInspectionCopilotMetric(check.flags.length, true)} flag(s)`}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{check.robotName}</strong>
                <small className="app-muted">
                  {check.totalWeightLbs} lbs · risk{" "}
                  {formatInspectionRiskPct(check.riskScore, true, true)}
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
              <ul className="factor-table inspection-copilot-flags">
                {check.flags.map((flag, index) => (
                  <li key={`${check.id}-${index}`}>
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
  const [binderRecorded, setBinderRecorded] = useState(false);
  const [bomPrinted, setBomPrinted] = useState(false);
  const [inspectionChecklistPrinted, setInspectionChecklistPrinted] = useState(false);
  const [studentCaptainPresent, setStudentCaptainPresent] = useState(false);
  const [radioEventRecorded, setRadioEventRecorded] = useState(false);
  const [radioOnMainPd, setRadioOnMainPd] = useState(false);
  const [rioOnMainPd10A, setRioOnMainPd10A] = useState(false);
  const [radioProgrammedForEvent, setRadioProgrammedForEvent] = useState(false);
  const [sparkMaxEventRecorded, setSparkMaxEventRecorded] = useState(false);
  const [sparkMaxUsbAvoided, setSparkMaxUsbAvoided] = useState(false);

  const setWeightField = (index: number, key: keyof WeightItemDraft) => (event: { target: { value: string } }) =>
    setWeightItems((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: event.target.value } : row)));

  const canSubmit = useMemo(
    () => robotName.trim().length > 0 && weightItems.some((row) => row.name.trim() && row.weightLbs !== ""),
    [robotName, weightItems],
  );

  return (
    <Panel
      id="inspection-copilot-form"
      as="form"
      className="inspection-copilot-panel"
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
            binderRecorded,
            bomPrinted,
            inspectionChecklistPrinted,
            studentCaptainPresent,
            radioEventRecorded,
            radioOnMainPd,
            rioOnMainPd10A,
            radioProgrammedForEvent,
            sparkMaxEventRecorded,
            sparkMaxUsbAvoided,
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
        setBinderRecorded(false);
        setBomPrinted(false);
        setInspectionChecklistPrinted(false);
        setStudentCaptainPresent(false);
        setRadioEventRecorded(false);
        setRadioOnMainPd(false);
        setRioOnMainPd10A(false);
        setRadioProgrammedForEvent(false);
        setSparkMaxEventRecorded(false);
        setSparkMaxUsbAvoided(false);
      }}
    >
      <h2 style={{ margin: 0 }}>Run an inspection-readiness check</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Enter real manual limits and measured robot values — predictions stay blank until you submit.
      </p>
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
        <div className="inspection-copilot-weight-rows">
          {weightItems.map((row, index) => (
            <div key={index} className="inspection-copilot-weight-row">
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
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input type="checkbox" checked={batterySecured} onChange={(e) => setBatterySecured(e.target.checked)} />
            Battery secured
          </label>
          <label>
            <input type="checkbox" checked={wiresLabeled} onChange={(e) => setWiresLabeled(e.target.checked)} />
            Wires labeled
          </label>
          <label>
            <input type="checkbox" checked={radioPowerOk} onChange={(e) => setRadioPowerOk(e.target.checked)} />
            Radio power path OK (generic)
          </label>
          <label>
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
        <strong className="app-muted">2026 radio / roboRIO power</strong>
        <p className="app-muted">
          Chief Delphi: rio and radio must come off the main PD — Mini PD / RPM / VRM stops inspection. Leave this off
          until you actually walk the wiring — never invent a fail.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={radioEventRecorded}
              onChange={(e) => setRadioEventRecorded(e.target.checked)}
            />
            We logged radio / RIO power for this event
          </label>
          {radioEventRecorded ? (
            <>
              <label>
                <input type="checkbox" checked={radioOnMainPd} onChange={(e) => setRadioOnMainPd(e.target.checked)} />
                Radio on main PD 12V and/or passive PoE injector (not VRM/RPM/Mini)
              </label>
              <label>
                <input type="checkbox" checked={rioOnMainPd10A} onChange={(e) => setRioOnMainPd10A(e.target.checked)} />
                roboRIO on a non-switched 10A PD branch
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={radioProgrammedForEvent}
                  onChange={(e) => setRadioProgrammedForEvent(e.target.checked)}
                />
                Radio programmed for this event
              </label>
            </>
          ) : null}
        </fieldset>
      </div>

      <div>
        <strong className="app-muted">Spark MAX USB-C</strong>
        <p className="app-muted">
          Chief Delphi 2026: a shorted Spark MAX phase can back-feed through USB-C and fry a laptop. Leave this off until
          you actually log the check — never invent a fail.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={sparkMaxEventRecorded}
              onChange={(e) => setSparkMaxEventRecorded(e.target.checked)}
            />
            We logged Spark MAX USB policy for this robot
          </label>
          {sparkMaxEventRecorded ? (
            <label>
              <input
                type="checkbox"
                checked={sparkMaxUsbAvoided}
                onChange={(e) => setSparkMaxUsbAvoided(e.target.checked)}
              />
              Will not plug USB-C into a Spark MAX that is behaving unexpectedly (use CAN)
            </label>
          ) : null}
        </fieldset>
      </div>

      <div>
        <strong className="app-muted">Thursday inspection binder</strong>
        <p className="app-muted">
          CD inspectors fail teams that forget a printed BOM. Leave this off until you actually pack the binder — never
          invent a missing document.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input type="checkbox" checked={binderRecorded} onChange={(e) => setBinderRecorded(e.target.checked)} />
            We logged binder status
          </label>
          {binderRecorded ? (
            <>
              <label>
                <input type="checkbox" checked={bomPrinted} onChange={(e) => setBomPrinted(e.target.checked)} />
                Printed BOM packed (part, qty, price, supplier)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={inspectionChecklistPrinted}
                  onChange={(e) => setInspectionChecklistPrinted(e.target.checked)}
                />
                Printed inspection checklist packed
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={studentCaptainPresent}
                  onChange={(e) => setStudentCaptainPresent(e.target.checked)}
                />
                Student team captain present to sign
              </label>
            </>
          ) : null}
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
