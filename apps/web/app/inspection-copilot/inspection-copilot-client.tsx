"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, Panel, ToolPage, useConfirm } from "../../components/ui";
import { inspectionFlagSeverityLabel, stale120PerimeterCue, stale16ExtensionCue, staleBumperThicknessCue, staleBumperZoneCue } from "../../lib/inspection-copilot";
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
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";
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
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
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
}: {
  description: string;
  orgId?: string | null;
  shell: Exclude<InspectionCopilotShellKind, "ready">;
  error?: string;
  onRetry?: () => void;
}) {
  const actions = inspectionCopilotNextActions({ orgId, shell });
  const copy = inspectionCopilotShellCopy(shell);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const fmeaHref = hubHref("/build", "fmea", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);
  const nextActions = <InspectionNextActionsPanel actions={actions} />;

  return (
    <ToolPage
      hub="build"
      hubTab="inspection-copilot"
      toolLabel="Inspection Copilot"
      title="Inspection-Readiness Copilot"
      description={description}
      className="inspection-copilot-page"
      orgId={orgId}
      state={shell}
      error={{ message: error }}
      onRetry={onRetry}
      actions={<InspectionRelatedStrip orgId={orgId} />}
      loading={
        <>
          <EmptyState soft badge={copy.badge} title={copy.title} description={copy.description} aria-busy />
          {nextActions}
        </>
      }
      setup={
        <>
          <EmptyState soft badge="Setup required" badgeTone="setup" title={copy.title} description={description}>
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          </EmptyState>
          {nextActions}
        </>
      }
      empty={
        <>
          <EmptyState soft badge="No checks yet" badgeTone="setup" title={copy.title} description={copy.description}>
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
          {nextActions}
        </>
      }
    />
  );
}

export default function InspectionCopilotClient() {
  const [view, setView] = useState<InspectionCopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
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
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
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
    <ToolPage
      hub="build"
      hubTab="inspection-copilot"
      toolLabel="Inspection Copilot"
      title="Inspection-Readiness Copilot"
      description="Compare declared weight, frame/bumper, and wiring limits against measured robot values before you travel. Cross-check Batteries, FMEA, and Subsystems — never DEMO risk scores."
      className="inspection-copilot-page"
      orgId={orgId}
      state="ready"
      actions={
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
          <InspectionRelatedStrip orgId={orgId} />
        </div>
      }
    >
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RenderAttribution receipt={renderReceipt} feature="inspection_copilot" />

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
    </ToolPage>
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
  const confirm = useConfirm();
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
                  void confirm({
                    title: "Delete inspection check",
                    body: `The "${check.robotName}" check and its ${check.flags.length} flag${check.flags.length === 1 ? "" : "s"} are removed for good. Readiness counts recompute from the remaining checks.`,
                    confirmLabel: "Delete check",
                    tone: "destructive",
                  }).then((ok) => {
                    if (ok) mutate({ action: "delete-check", checkId: check.id });
                  });
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
  const [weightLimitLbs, setWeightLimitLbs] = useState("115");
  const [weightItems, setWeightItems] = useState<WeightItemDraft[]>([emptyWeightRow()]);

  const [perimeterLimitIn, setPerimeterLimitIn] = useState("110");
  const [measuredPerimeterIn, setMeasuredPerimeterIn] = useState("");
  const [startingHeightLimitIn, setStartingHeightLimitIn] = useState("30");
  const [measuredStartingHeightIn, setMeasuredStartingHeightIn] = useState("");
  const [extensionLimitIn, setExtensionLimitIn] = useState("12");
  const [measuredExtensionIn, setMeasuredExtensionIn] = useState("");
  const [bumperMinHeightIn, setBumperMinHeightIn] = useState("2.75");
  const [bumperMaxHeightIn, setBumperMaxHeightIn] = useState("5.5");
  const [measuredBumperMinHeightIn, setMeasuredBumperMinHeightIn] = useState("");
  const [measuredBumperMaxHeightIn, setMeasuredBumperMaxHeightIn] = useState("");
  const [bumperMinThicknessIn, setBumperMinThicknessIn] = useState("2");
  const [measuredBumperThicknessIn, setMeasuredBumperThicknessIn] = useState("");
  const [bumperEventRecorded, setBumperEventRecorded] = useState(false);
  const [solidCoreFoam, setSolidCoreFoam] = useState(false);
  const [separateColorSets, setSeparateColorSets] = useState(false);
  const [bumperGapsOk, setBumperGapsOk] = useState(false);
  const [bumperNoElectronics, setBumperNoElectronics] = useState(false);
  const [bumperNumbersLegal, setBumperNumbersLegal] = useState(false);
  const [bumperHardPartsOk, setBumperHardPartsOk] = useState(false);
  const [bumperCornersFilled, setBumperCornersFilled] = useState(false);
  const [bumperHardPartsInset, setBumperHardPartsInset] = useState(false);
  const [bumperBackingTall, setBumperBackingTall] = useState(false);
  const [bumperCoverOk, setBumperCoverOk] = useState(false);
  const [bumperCrossSectionOk, setBumperCrossSectionOk] = useState(false);
  const [bumperRemovableOk, setBumperRemovableOk] = useState(false);

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
  const [radioWeidmullerQc, setRadioWeidmullerQc] = useState(false);
  const [radioLedsVisible, setRadioLedsVisible] = useState(false);
  const [rioEthernetPathOk, setRioEthernetPathOk] = useState(false);
  const [rioRadioDedicatedOk, setRioRadioDedicatedOk] = useState(false);
  const [sparkMaxEventRecorded, setSparkMaxEventRecorded] = useState(false);
  const [sparkMaxUsbAvoided, setSparkMaxUsbAvoided] = useState(false);
  const [reliabilityEventRecorded, setReliabilityEventRecorded] = useState(false);
  const [strainReliefOk, setStrainReliefOk] = useState(false);
  const [dynamicCableClear, setDynamicCableClear] = useState(false);
  const [esdIntakeBonded, setEsdIntakeBonded] = useState(false);
  const [esdShielded, setEsdShielded] = useState(false);
  const [canivorePdhBackup, setCanivorePdhBackup] = useState(false);
  const [batteryLeadsTorqued, setBatteryLeadsTorqued] = useState(false);
  const [mainBreakerCovered, setMainBreakerCovered] = useState(false);
  const [rioUsbCameraClear, setRioUsbCameraClear] = useState(false);
  const [pcmRadioSeparated, setPcmRadioSeparated] = useState(false);
  const [pneumaticsEventRecorded, setPneumaticsEventRecorded] = useState(false);
  const [ventPlugAccessible, setVentPlugAccessible] = useState(false);
  const [singleOnboardCompressor, setSingleOnboardCompressor] = useState(false);
  const [reliefValveOnCompressor, setReliefValveOnCompressor] = useState(false);
  const [workingPressure60Psi, setWorkingPressure60Psi] = useState(false);
  const [pressureSwitchOnPcmPh, setPressureSwitchOnPcmPh] = useState(false);
  const [componentsRated, setComponentsRated] = useState(false);
  const [compressorStops120, setCompressorStops120] = useState(false);
  const [compressorPowerOk, setCompressorPowerOk] = useState(false);
  const [tubingOdOk, setTubingOdOk] = useState(false);
  const [relievingRegulatorOk, setRelievingRegulatorOk] = useState(false);
  const [compressorStartsEnabled, setCompressorStartsEnabled] = useState(false);
  const [pneumaticsUnmodified, setPneumaticsUnmodified] = useState(false);
  const [solenoidsLegal, setSolenoidsLegal] = useState(false);
  const [gaugesVisible, setGaugesVisible] = useState(false);
  const [isolationEventRecorded, setIsolationEventRecorded] = useState(false);
  const [frameIsolated120, setFrameIsolated120] = useState(false);
  const [unusedPdPortsTaped, setUnusedPdPortsTaped] = useState(false);
  const [pdhFusesOk, setPdhFusesOk] = useState(false);
  const [pdVisible, setPdVisible] = useState(false);
  const [pdBreakersOk, setPdBreakersOk] = useState(false);
  const [atcAtoFusesOk, setAtcAtoFusesOk] = useState(false);
  const [rslEventRecorded, setRslEventRecorded] = useState(false);
  const [rslVisible36, setRslVisible36] = useState(false);
  const [rslOnRioPort, setRslOnRioPort] = useState(false);

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
            startingHeightLimitIn: Number(startingHeightLimitIn) || 0,
            measuredStartingHeightIn: Number(measuredStartingHeightIn) || 0,
            extensionLimitIn: Number(extensionLimitIn) || 0,
            measuredExtensionIn: Number(measuredExtensionIn) || 0,
            bumperEventRecorded,
            solidCoreFoam,
            separateColorSets,
            bumperGapsOk,
            bumperNoElectronics,
            bumperNumbersLegal,
            bumperHardPartsOk,
            bumperCornersFilled,
            bumperHardPartsInset,
            bumperBackingTall,
            bumperCoverOk,
            bumperCrossSectionOk,
            bumperRemovableOk,
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
            radioWeidmullerQc,
            radioLedsVisible,
            rioEthernetPathOk,
            rioRadioDedicatedOk,
            sparkMaxEventRecorded,
            sparkMaxUsbAvoided,
            reliabilityEventRecorded,
            strainReliefOk,
            dynamicCableClear,
            esdIntakeBonded,
            esdShielded,
            canivorePdhBackup,
            batteryLeadsTorqued,
            mainBreakerCovered,
            rioUsbCameraClear,
            pcmRadioSeparated,
            pneumaticsEventRecorded,
            ventPlugAccessible,
            singleOnboardCompressor,
            reliefValveOnCompressor,
            workingPressure60Psi,
            pressureSwitchOnPcmPh,
            componentsRated,
            compressorStops120,
            compressorPowerOk,
            tubingOdOk,
            relievingRegulatorOk,
            compressorStartsEnabled,
            pneumaticsUnmodified,
            solenoidsLegal,
            gaugesVisible,
            isolationEventRecorded,
            frameIsolated120,
            unusedPdPortsTaped,
            pdhFusesOk,
            pdVisible,
            pdBreakersOk,
            atcAtoFusesOk,
            rslEventRecorded,
            rslVisible36,
            rslOnRioPort,
          },
        });
        setRobotName("");
        setWeightItems([emptyWeightRow()]);
        setMeasuredPerimeterIn("");
        setMeasuredStartingHeightIn("");
        setMeasuredExtensionIn("");
        setMeasuredBumperMinHeightIn("");
        setMeasuredBumperMaxHeightIn("");
        setMeasuredBumperThicknessIn("");
        setBumperEventRecorded(false);
        setSolidCoreFoam(false);
        setSeparateColorSets(false);
        setBumperGapsOk(false);
        setBumperNoElectronics(false);
        setBumperNumbersLegal(false);
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
        setRadioWeidmullerQc(false);
        setSparkMaxEventRecorded(false);
        setSparkMaxUsbAvoided(false);
        setReliabilityEventRecorded(false);
        setStrainReliefOk(false);
        setDynamicCableClear(false);
        setEsdIntakeBonded(false);
        setEsdShielded(false);
        setCanivorePdhBackup(false);
        setBatteryLeadsTorqued(false);
        setMainBreakerCovered(false);
        setRioUsbCameraClear(false);
        setPneumaticsEventRecorded(false);
        setVentPlugAccessible(false);
        setSingleOnboardCompressor(false);
        setReliefValveOnCompressor(false);
        setWorkingPressure60Psi(false);
        setPressureSwitchOnPcmPh(false);
        setIsolationEventRecorded(false);
        setFrameIsolated120(false);
        setUnusedPdPortsTaped(false);
        setPdhFusesOk(false);
        setPdVisible(false);
        setPdBreakersOk(false);
        setAtcAtoFusesOk(false);
        setRslEventRecorded(false);
        setRslVisible36(false);
        setRslOnRioPort(false);
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
        {stale120PerimeterCue(Number(perimeterLimitIn)) ? (
          <p className="app-muted" role="status">{stale120PerimeterCue(Number(perimeterLimitIn))}</p>
        ) : null}
        {staleBumperZoneCue(Number(bumperMaxHeightIn)) ? (
          <p className="app-muted" role="status">{staleBumperZoneCue(Number(bumperMaxHeightIn))}</p>
        ) : null}
        {staleBumperThicknessCue(Number(bumperMinThicknessIn)) ? (
          <p className="app-muted" role="status">{staleBumperThicknessCue(Number(bumperMinThicknessIn))}</p>
        ) : null}
        {stale16ExtensionCue(Number(extensionLimitIn)) ? (
          <p className="app-muted" role="status">{stale16ExtensionCue(Number(extensionLimitIn))}</p>
        ) : null}
        <FormGrid min={180}>
          <FormRow label="Perimeter limit (in)">
            <input type="number" min={0} value={perimeterLimitIn} onChange={(e) => setPerimeterLimitIn(e.target.value)} />
          </FormRow>
          <FormRow label="Measured perimeter (in)">
            <input type="number" min={0} value={measuredPerimeterIn} onChange={(e) => setMeasuredPerimeterIn(e.target.value)} />
          </FormRow>
          <FormRow label="Starting height limit (in)">
            <input
              type="number"
              min={0}
              value={startingHeightLimitIn}
              onChange={(e) => setStartingHeightLimitIn(e.target.value)}
            />
          </FormRow>
          <FormRow label="Measured starting height (in)">
            <input
              type="number"
              min={0}
              value={measuredStartingHeightIn}
              onChange={(e) => setMeasuredStartingHeightIn(e.target.value)}
            />
          </FormRow>
          <FormRow label="In-match extension limit (in)">
            <input
              type="number"
              min={0}
              value={extensionLimitIn}
              onChange={(e) => setExtensionLimitIn(e.target.value)}
            />
          </FormRow>
          <FormRow label="Measured max extension (in)">
            <input
              type="number"
              min={0}
              value={measuredExtensionIn}
              onChange={(e) => setMeasuredExtensionIn(e.target.value)}
            />
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
        <p className="app-muted">
          Chief Delphi: hollow pool noodles and reversible bumpers fail Thursday. Leave this off until you actually walk
          the bumpers — never invent a fail.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={bumperEventRecorded}
              onChange={(e) => setBumperEventRecorded(e.target.checked)}
            />
            We logged bumper construction for this robot
          </label>
          {bumperEventRecorded ? (
            <>
              <label>
                <input type="checkbox" checked={solidCoreFoam} onChange={(e) => setSolidCoreFoam(e.target.checked)} />
                Padding is solid-core foam (not hollow pool noodles)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={separateColorSets}
                  onChange={(e) => setSeparateColorSets(e.target.checked)}
                />
                Separate red and blue sets (not reversible)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperGapsOk}
                  onChange={(e) => setBumperGapsOk(e.target.checked)}
                />
                Gaps under 1.25 in, or one larger gap with ≥ 5 in from each corner (R401)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperNoElectronics}
                  onChange={(e) => setBumperNoElectronics(e.target.checked)}
                />
                No moving or electrical parts in the bumpers (R409)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperNumbersLegal}
                  onChange={(e) => setBumperNumbersLegal(e.target.checked)}
                />
                White Arabic numerals ≥ 3.5 in × 0.25 in stroke on at least 3 sides ~90° apart (R412)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperHardPartsOk}
                  onChange={(e) => setBumperHardPartsOk(e.target.checked)}
                />
                Bumpers do not extend &gt; 4.25 in from the robot perimeter (R403)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperHardPartsInset}
                  onChange={(e) => setBumperHardPartsInset(e.target.checked)}
                />
                Hard parts ≤ 1.5 in from the perimeter; padding ≥ 2 in past hard parts (R404)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperBackingTall}
                  onChange={(e) => setBumperBackingTall(e.target.checked)}
                />
                Backing ≥ 4.25 in tall and supports all padding (R402)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperCornersFilled}
                  onChange={(e) => setBumperCornersFilled(e.target.checked)}
                />
                Corners filled with ≥ 2 in uncompressed padding, measured diagonally (R406)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperCoverOk}
                  onChange={(e) => setBumperCoverOk(e.target.checked)}
                />
                Cloth cover covers all padding (R402)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperCrossSectionOk}
                  onChange={(e) => setBumperCrossSectionOk(e.target.checked)}
                />
                Every vertical cross-section has padding, backing, and cover (wrap only at ends)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={bumperRemovableOk}
                  onChange={(e) => setBumperRemovableOk(e.target.checked)}
                />
                Securely mounted and easily removable for inspection
              </label>
            </>
          ) : null}
        </fieldset>
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
          Chief Delphi: rio and radio must come off the main PD — Mini PD / RPM / VRM stops inspection. TU07: each is
          the only load on its 10A branch. Leave this off until you actually walk the wiring — never invent a fail.
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
              <label>
                <input
                  type="checkbox"
                  checked={radioWeidmullerQc}
                  onChange={(e) => setRadioWeidmullerQc(e.target.checked)}
                />
                Second person QC&apos;d VH-109 Weidmuller power leads (no stray strands / over-strip)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={radioLedsVisible}
                  onChange={(e) => setRadioLedsVisible(e.target.checked)}
                />
                Radio LEDs visible to field staff (not buried in the bellypan)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rioEthernetPathOk}
                  onChange={(e) => setRioEthernetPathOk(e.target.checked)}
                />
                roboRIO ethernet on v1.5 RIO port, or v1.0 via PoE injector / modified cable / AUX DIP off
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rioRadioDedicatedOk}
                  onChange={(e) => setRioRadioDedicatedOk(e.target.checked)}
                />
                RIO and radio each the only load on their 10A PD branch (TU07)
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
        <strong className="app-muted">2026 pit reliability</strong>
        <p className="app-muted">
          FRC pit walk: strain relief, cable pinch, static vs loose wiring, CANivore backup power, torqued leads, breaker
          cover, no RIO USB camera next to a CANivore, PCM/PH away from the radio. Leave this off until you actually walk
          the robot — never invent a fail.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={reliabilityEventRecorded}
              onChange={(e) => setReliabilityEventRecorded(e.target.checked)}
            />
            We logged this robot’s pit-reliability walk
          </label>
          {reliabilityEventRecorded ? (
            <>
              <label>
                <input type="checkbox" checked={strainReliefOk} onChange={(e) => setStrainReliefOk(e.target.checked)} />
                Every connection has strain relief
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={dynamicCableClear}
                  onChange={(e) => setDynamicCableClear(e.target.checked)}
                />
                CAN / signal / power clear of igus pinch and rotating mechanisms
              </label>
              <label>
                <input type="checkbox" checked={esdIntakeBonded} onChange={(e) => setEsdIntakeBonded(e.target.checked)} />
                Intake chassis-bonded (not to power) — check wiring before blaming static
              </label>
              <label>
                <input type="checkbox" checked={esdShielded} onChange={(e) => setEsdShielded(e.target.checked)} />
                Gyros / sensitive electronics foil or copper wrapped
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={canivorePdhBackup}
                  onChange={(e) => setCanivorePdhBackup(e.target.checked)}
                />
                CANivore has a PDH power backup if USB drops
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={batteryLeadsTorqued}
                  onChange={(e) => setBatteryLeadsTorqued(e.target.checked)}
                />
                Battery / main breaker / PD lead bolts torqued
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mainBreakerCovered}
                  onChange={(e) => setMainBreakerCovered(e.target.checked)}
                />
                Main breaker has a cover
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rioUsbCameraClear}
                  onChange={(e) => setRioUsbCameraClear(e.target.checked)}
                />
                No USB camera on the RIO ports next to a CANivore (ESD kills both 5 V rails)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pcmRadioSeparated}
                  onChange={(e) => setPcmRadioSeparated(e.target.checked)}
                />
                PCM/PH kept away from the radio (RF looks like a compressor fault)
              </label>
            </>
          ) : null}
        </fieldset>
      </div>

      <div>
        <strong className="app-muted">Pneumatics (skip if the robot has no air)</strong>
        <p className="app-muted">
          Inspection checklist: hidden vent plugs, extra compressors, 60 psi working pressure, a missing pressure
          switch, paint on tanks, illegal solenoids, and buried gauges fail Thursday. Leave this off until you actually
          walk stored pressure — never invent a fail.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={pneumaticsEventRecorded}
              onChange={(e) => setPneumaticsEventRecorded(e.target.checked)}
            />
            We logged pneumatics for this robot
          </label>
          {pneumaticsEventRecorded ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={ventPlugAccessible}
                  onChange={(e) => setVentPlugAccessible(e.target.checked)}
                />
                Vent plug is easily accessible and vents stored pressure to 0 psi
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={singleOnboardCompressor}
                  onChange={(e) => setSingleOnboardCompressor(e.target.checked)}
                />
                Only one onboard legal compressor
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={reliefValveOnCompressor}
                  onChange={(e) => setReliefValveOnCompressor(e.target.checked)}
                />
                125 psi relief valve on the compressor outlet (not only on the tank)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={workingPressure60Psi}
                  onChange={(e) => setWorkingPressure60Psi(e.target.checked)}
                />
                Working pressure regulated to ≤ 60 psi
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pressureSwitchOnPcmPh}
                  onChange={(e) => setPressureSwitchOnPcmPh(e.target.checked)}
                />
                Pressure switch wired to the PCM/PH (compressor stops at stored-pressure setpoint)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={componentsRated}
                  onChange={(e) => setComponentsRated(e.target.checked)}
                />
                Working parts rated ≥ 70 psi; stored parts rated ≥ 125 psi (R801/R802)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={compressorStops120}
                  onChange={(e) => setCompressorStops120(e.target.checked)}
                />
                Compressor stops at ≤ 120 psi under roboRIO control
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={compressorPowerOk}
                  onChange={(e) => setCompressorPowerOk(e.target.checked)}
                />
                Compressor powered from a PCM/PH or relay (not a motor controller)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={tubingOdOk}
                  onChange={(e) => setTubingOdOk(e.target.checked)}
                />
                Tubing is KOP-equivalent, maximum OD 1/4 in
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={relievingRegulatorOk}
                  onChange={(e) => setRelievingRegulatorOk(e.target.checked)}
                />
                Relieving regulator ≤ 60 psi providing all working pressure
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={compressorStartsEnabled}
                  onChange={(e) => setCompressorStartsEnabled(e.target.checked)}
                />
                Compressor starts when enabled with no stored pressure
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pneumaticsUnmodified}
                  onChange={(e) => setPneumaticsUnmodified(e.target.checked)}
                />
                Tanks/cylinders unmodified — no paint or large labels (small labels ok)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={solenoidsLegal}
                  onChange={(e) => setSolenoidsLegal(e.target.checked)}
                />
                Solenoids ≤ 1/8 in NPT (or 1/4 in QC), PCM/PH or relay, outputs not teed
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={gaugesVisible}
                  onChange={(e) => setGaugesVisible(e.target.checked)}
                />
                Stored and working gauges on both sides of the regulator, readily visible
              </label>
            </>
          ) : null}
        </fieldset>
      </div>

      <div>
        <strong className="app-muted">R611 frame isolation / PDH debris</strong>
        <p className="app-muted">
          Inspectors probe Anderson-to-frame with the battery out and breaker on. Conductive chips in unused PDH sockets
          reboot radios. The PD, breakers, and wiring have to stay visible. ATC/ATO blades in the PD are ≤ 10A. Leave this
          off until you actually meter the chassis — never invent a fail.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={isolationEventRecorded}
              onChange={(e) => setIsolationEventRecorded(e.target.checked)}
            />
            We logged isolation and unused-port tape for this robot
          </label>
          {isolationEventRecorded ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={frameIsolated120}
                  onChange={(e) => setFrameIsolated120(e.target.checked)}
                />
                Frame &gt;120Ω from both Anderson posts (battery out, breaker on)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={unusedPdPortsTaped}
                  onChange={(e) => setUnusedPdPortsTaped(e.target.checked)}
                />
                Unused PDH / RIO / VRM ports taped against conductive debris
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pdhFusesOk}
                  onChange={(e) => setPdhFusesOk(e.target.checked)}
                />
                PDH ATM fuses ≤ 15A except one 20A for a PCM/PH (or a 20A breaker)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={atcAtoFusesOk}
                  onChange={(e) => setAtcAtoFusesOk(e.target.checked)}
                />
                PD ATC/ATO blade fuses ≤ 10A (R620-B)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pdVisible}
                  onChange={(e) => setPdVisible(e.target.checked)}
                />
                Single PD, breakers, and associated wiring easily visible
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pdBreakersOk}
                  onChange={(e) => setPdBreakersOk(e.target.checked)}
                />
                ATO/Maxi breakers are VB3-A, AT2-A, MX5-A/L, REV or CTR ATO, all ≤ 40A
              </label>
            </>
          ) : null}
        </fieldset>
      </div>

      <div>
        <strong className="app-muted">Robot signal light (RSL)</strong>
        <p className="app-muted">
          2026 checklist: visible from 36 in on at least one side, plugged into the roboRIO RSL port, flashing in sync.
          Leave this off until you actually walk the light — never invent a fail.
        </p>
        <fieldset className="inspection-copilot-checks" style={{ border: "none", padding: 0 }}>
          <label>
            <input
              type="checkbox"
              checked={rslEventRecorded}
              onChange={(e) => setRslEventRecorded(e.target.checked)}
            />
            We logged the robot signal light for this robot
          </label>
          {rslEventRecorded ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={rslVisible36}
                  onChange={(e) => setRslVisible36(e.target.checked)}
                />
                Visible from 36 in on at least one side
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rslOnRioPort}
                  onChange={(e) => setRslOnRioPort(e.target.checked)}
                />
                Plugged into the roboRIO RSL port and flashing in sync
              </label>
            </>
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
