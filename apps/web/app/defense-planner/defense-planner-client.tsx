"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  StatRowSkeleton,
  StatTile,
  TableSkeleton,
  type BadgeTone,
} from "../../components/ui";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import {
  DRIVETRAIN_TYPES,
  defenseRecommendationLabel,
  drivetrainLabel,
} from "../../lib/defense-planner";
import type { DefensePlannerView } from "../../lib/defense-planner/compute-defense-planner";
import {
  DEFENSE_PLANNER_RELATED_INCLUDE,
  classifyDefensePlannerShell,
  defensePlannerNextActions,
  defensePlannerRelatedLinks,
  defensePlannerSetupSteps,
  defensePlannerShellCopy,
  formatDefensePlannerMetric,
  shouldShowDefensePlannerSummaryTiles,
  type DefensePlannerNextAction,
  type DefensePlannerShellKind,
} from "../../lib/defense-planner/defense-planner-related";
import type { DrivetrainType } from "../../lib/defense-planner/types";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./defense-planner.css";

function recommendationTone(recommendation: string): BadgeTone {
  if (recommendation === "play_defense") return "good";
  if (recommendation === "stay_offense") return "setup";
  return "danger";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<DefensePlannerView, { status: "live" }>;

function DefenseRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = defensePlannerRelatedLinks(orgId, {
    include: [...DEFENSE_PLANNER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related defense-planner-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function DefenseNextActionsPanel({ actions }: { actions: DefensePlannerNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions defense-planner-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Strategy, Scouting, and Counter-book — never DEMO defense metrics.</p>
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

function DefenseShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: DefensePlannerShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = defensePlannerNextActions({ orgId, shell });
  const copy = defensePlannerShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "defense-planner", orgId);
  const steps = shell === "setup" ? defensePlannerSetupSteps(orgId) : [];

  return (
    <main className="module-page defense-planner-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Defense planner"}
          </>
        }
        title="Defense planner"
        description={description}
      >
        <DefenseRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading defense planner">
          <StatRowSkeleton count={3} />
          <TableSkeleton rows={3} cols={3} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : shell === "empty" ? "No matchups yet" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href="#defense-planner-matchup">
                Log a matchup
              </a>
              <a className="app-button secondary" href={hubHref("/competition", "scouting", orgId)}>
                Open Scouting
              </a>
              <a className="app-button secondary" href={hubHref("/competition", "strategy", orgId)}>
                Open Strategy
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="defense-planner-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Strategy and Scouting — never DEMO defense metrics.</p>
          </header>
          <ul className="defense-planner-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted defense-planner-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <DefenseNextActionsPanel actions={actions} />
    </main>
  );
}

export default function DefensePlannerClient() {
  const [view, setView] = useState<DefensePlannerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Honest badge for the latest matchup render: "AI" only when a model wrote the rationale.
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/defense-planner${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DefensePlannerView | { error?: string };
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
  const matchupCount = view?.status === "live" ? view.matchups.length : 0;
  const hasProfile = view?.status === "live" ? Boolean(view.robotProfile) : false;

  const shell = classifyDefensePlannerShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    matchupCount,
  });
  const shellCopy = defensePlannerShellCopy(shell);
  const nextActions = defensePlannerNextActions({
    orgId,
    shell,
    matchupCount,
    hasProfile,
  });
  const relatedLinks = defensePlannerRelatedLinks(orgId, {
    include: [...DEFENSE_PLANNER_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "defense-planner", orgId);
  const showTiles = shouldShowDefensePlannerSummaryTiles({ matchupCount, hasProfile });

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/defense-planner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as DefensePlannerView | { error?: string };
        if (!response.ok || !("status" in data)) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return;
          }
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
    return <DefenseShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <DefenseShell
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
      <DefenseShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <DefenseShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page defense-planner-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Defense planner"}
          </>
        }
        title="Defense planner"
        description="Weigh our mass and drivetrain against scouted opponent cycles to decide whether — and whom — to play defense. Cross-check Strategy, Scouting, and Counter-book — never DEMO defense metrics."
      >
        <div className="defense-planner-header-actions">
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
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RenderAttribution receipt={renderReceipt} feature="defense_planner" />

      <DefenseNextActionsPanel actions={nextActions} />

      {showTiles ? (
        <Panel className="defense-planner-panel" aria-label="Defense planner counts">
          <div className="defense-planner-stats">
            <StatTile label="Matchups" value={formatDefensePlannerMetric(matchupCount, true)} />
            <StatTile label="Profile" value={hasProfile ? "Set" : "—"} />
            <StatTile label="Season" value={String(view.seasonYear)} />
          </div>
        </Panel>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No matchups yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
          className="product-hub-setup"
        >
          <a className="app-button" href={hasProfile ? "#defense-planner-matchup" : "#defense-planner-profile"}>
            {hasProfile ? "Log a matchup" : "Save robot profile"}
          </a>
          <a className="app-button secondary" href={hubHref("/competition", "scouting", orgId)}>
            Open Scouting
          </a>
          <a className="app-button secondary" href={hubHref("/competition", "strategy", orgId)}>
            Open Strategy
          </a>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <RobotProfileForm view={view} busy={busy} mutate={mutate} />
        <LogMatchupForm busy={busy} mutate={mutate} cutoffCode={cutoffCode} orgId={orgId} />
        <MatchupsPanel view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function RobotProfileForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const profile = view.robotProfile;
  const [massLbs, setMassLbs] = useState(profile ? String(profile.massLbs) : "");
  const [drivetrain, setDrivetrain] = useState<DrivetrainType>(profile?.drivetrain ?? "west_coast");
  const [topSpeedFps, setTopSpeedFps] = useState(profile?.topSpeedFps != null ? String(profile.topSpeedFps) : "");
  const [notes, setNotes] = useState(profile?.notes ?? "");

  return (
    <Panel
      id="defense-planner-profile"
      as="form"
      className="defense-planner-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const mass = Number(massLbs);
        if (!Number.isFinite(mass) || mass <= 0) return;
        mutate({
          action: "save-robot-profile",
          massLbs: mass,
          drivetrain,
          topSpeedFps: topSpeedFps ? Number(topSpeedFps) : undefined,
          notes,
        });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Our robot profile — {view.seasonYear}</h2>
      {!profile ? (
        <small className="app-muted">
          Set our mass and drivetrain to unlock matchup recommendations — never DEMO containment.
        </small>
      ) : null}
      <FormGrid min={160}>
        <FormRow label="Mass (lbs)">
          <input
            type="number"
            min={1}
            step="0.1"
            value={massLbs}
            onChange={(event) => setMassLbs(event.target.value)}
            required
          />
        </FormRow>
        <FormRow label="Drivetrain">
          <select value={drivetrain} onChange={(event) => setDrivetrain(event.target.value as DrivetrainType)}>
            {DRIVETRAIN_TYPES.map((type) => (
              <option key={type} value={type}>
                {drivetrainLabel(type)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Top speed (ft/s, optional)">
          <input type="number" min={0} step="0.1" value={topSpeedFps} onChange={(event) => setTopSpeedFps(event.target.value)} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !massLbs}>
          Save profile
        </button>
      </div>
    </Panel>
  );
}

function LogMatchupForm({
  busy,
  mutate,
  cutoffCode,
  orgId,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  cutoffCode: string | null;
  orgId: string | null;
}) {
  const empty = useMemo(
    () => ({
      opponentTeamNumber: "",
      opponentTeamName: "",
      eventKey: "",
      opponentMassLbs: "",
      opponentDrivetrain: "west_coast" as DrivetrainType,
      opponentCycleTimeSec: "",
      opponentCyclePath: "",
      opponentAvgPointsPerCycle: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="defense-planner-matchup"
      as="form"
      className="defense-planner-panel"
      onSubmit={(event) => {
        event.preventDefault();
        const opponentTeamNumber = Number(form.opponentTeamNumber);
        const opponentMassLbs = Number(form.opponentMassLbs);
        const opponentCycleTimeSec = Number(form.opponentCycleTimeSec);
        const opponentAvgPointsPerCycle = Number(form.opponentAvgPointsPerCycle);
        if (
          !Number.isFinite(opponentTeamNumber) ||
          opponentTeamNumber <= 0 ||
          !Number.isFinite(opponentMassLbs) ||
          opponentMassLbs <= 0 ||
          !Number.isFinite(opponentCycleTimeSec) ||
          opponentCycleTimeSec <= 0 ||
          !Number.isFinite(opponentAvgPointsPerCycle) ||
          opponentAvgPointsPerCycle < 0
        ) {
          return;
        }
        mutate({
          action: "log-matchup",
          opponentTeamNumber,
          opponentTeamName: form.opponentTeamName || undefined,
          eventKey: form.eventKey || undefined,
          opponentMassLbs,
          opponentDrivetrain: form.opponentDrivetrain,
          opponentCycleTimeSec,
          opponentCyclePath: form.opponentCyclePath || undefined,
          opponentAvgPointsPerCycle,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Scout the next opponent</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Metered local recommendation — UsageCutoffBanner appears when budgets hard-stop. Never DEMO defense metrics.
      </p>
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input type="number" min={1} value={form.opponentTeamNumber} onChange={set("opponentTeamNumber")} required />
        </FormRow>
        <FormRow label="Team name (optional)">
          <input value={form.opponentTeamName} onChange={set("opponentTeamName")} />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026txho" />
        </FormRow>
        <FormRow label="Their mass (lbs)">
          <input type="number" min={1} step="0.1" value={form.opponentMassLbs} onChange={set("opponentMassLbs")} required />
        </FormRow>
        <FormRow label="Their drivetrain">
          <select value={form.opponentDrivetrain} onChange={set("opponentDrivetrain")}>
            {DRIVETRAIN_TYPES.map((type) => (
              <option key={type} value={type}>
                {drivetrainLabel(type)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Their cycle time (sec)">
          <input type="number" min={0.1} step="0.1" value={form.opponentCycleTimeSec} onChange={set("opponentCycleTimeSec")} required />
        </FormRow>
        <FormRow label="Their avg pts/cycle">
          <input type="number" min={0} step="0.1" value={form.opponentAvgPointsPerCycle} onChange={set("opponentAvgPointsPerCycle")} required />
        </FormRow>
      </FormGrid>
      <FormRow label="Scouted cycle path (optional)">
        <input
          value={form.opponentCyclePath}
          onChange={set("opponentCyclePath")}
          placeholder="e.g. loading zone -> mid field -> speaker"
        />
      </FormRow>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={
            busy ||
            !form.opponentTeamNumber ||
            !form.opponentMassLbs ||
            !form.opponentCycleTimeSec ||
            !form.opponentAvgPointsPerCycle
          }
        >
          Compute recommendation
        </button>
      </div>
    </Panel>
  );
}

function MatchupsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.matchups.length === 0) {
    return null;
  }
  return (
    <Panel className="defense-planner-panel" id="defense-planner-list">
      <h2 style={{ marginTop: 0 }}>Matchups — {view.seasonYear}</h2>
      <p className="app-muted">Real logged matchups only — never DEMO recommendations.</p>
      <ul className="defense-planner-list">
        {view.matchups.map((matchup) => (
          <li key={matchup.id} className="app-card soft-panel defense-planner-row">
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <strong>
                  Team {matchup.opponentTeamNumber}
                  {matchup.opponentTeamName ? ` — ${matchup.opponentTeamName}` : ""}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {drivetrainLabel(matchup.opponentDrivetrain)} · {matchup.opponentMassLbs} lb ·{" "}
                  {matchup.opponentCycleTimeSec}s cycles · {matchup.opponentAvgPointsPerCycle} pts/cycle
                  {matchup.eventKey ? ` · ${matchup.eventKey}` : ""}
                </small>
              </div>
              <div style={{ textAlign: "right" }}>
                <Badge tone={recommendationTone(matchup.recommendation)}>
                  {defenseRecommendationLabel(matchup.recommendation)}
                </Badge>
                <small className="app-muted" style={{ display: "block" }}>
                  {pct(matchup.confidence)} confidence
                </small>
              </div>
            </header>
            {matchup.opponentCyclePath ? (
              <small className="app-muted">Cycle path: {matchup.opponentCyclePath}</small>
            ) : null}
            <p style={{ margin: 0 }}>{matchup.rationale}</p>
            {matchup.notes ? <small className="app-muted">Notes: {matchup.notes}</small> : null}
            <div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete the matchup vs Team ${matchup.opponentTeamNumber}?`)) {
                    mutate({ action: "delete-matchup", matchupId: matchup.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
