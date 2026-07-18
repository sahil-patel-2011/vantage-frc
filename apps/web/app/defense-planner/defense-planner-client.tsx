"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import {
  DRIVETRAIN_TYPES,
  defenseRecommendationLabel,
  drivetrainLabel,
} from "../../lib/defense-planner";
import type { DefensePlannerView } from "../../lib/defense-planner/compute-defense-planner";
import type { DrivetrainType } from "../../lib/defense-planner/types";

function recommendationTone(recommendation: string): string {
  if (recommendation === "play_defense") return "good";
  if (recommendation === "stay_offense") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<DefensePlannerView, { status: "live" }>;

export default function DefensePlannerClient() {
  const [view, setView] = useState<DefensePlannerView | null>(null);
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/defense-planner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as DefensePlannerView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Defense Planner"}
          </>
        }
        title="Defense Planner"
        description="For the next opponent: weigh our mass and drivetrain against their scouted cycle path to decide whether — and whom — to play defense."
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
          title="Could not load the Defense Planner"
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
          <RobotProfilePanel view={view} busy={busy} mutate={mutate} />
          <LogMatchupForm busy={busy} mutate={mutate} />
          <MatchupsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function RobotProfilePanel({
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
      as="form"
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
          Set our mass and drivetrain to unlock matchup recommendations.
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
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
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
      as="form"
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
    return (
      <EmptyState
        badge="No matchups yet"
        badgeTone="setup"
        title="Log your first opponent matchup"
        description="Enter the scouted mass, drivetrain, and cycle path for the next opponent to get a defense recommendation."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Matchups — {view.seasonYear}</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.matchups.map((matchup) => (
          <li key={matchup.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
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
                <span className={`app-badge ${recommendationTone(matchup.recommendation)}`}>
                  {defenseRecommendationLabel(matchup.recommendation)}
                </span>
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
