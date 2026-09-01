"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { ALLIANCE_SIM_ROLE_DEFS, allianceSimRoleLabel } from "../../lib/alliance-sim";
import type { AllianceSimView } from "../../lib/alliance-sim/compute-alliance-sim";
import type { AllianceSimRole } from "../../lib/alliance-sim/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<AllianceSimView, { status: "live" }>;

export default function AllianceSimClient() {
  const [view, setView] = useState<AllianceSimView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((scenarioOverride?: string | null) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const scenarioQuery = scenarioOverride !== undefined ? scenarioOverride : params.get("scenarioId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (scenarioQuery) query.set("scenarioId", scenarioQuery);
    void fetch(`/api/alliance-sim${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as AllianceSimView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setLoadStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
          setFetchFailed(true);
          return;
        }
        setLoadStatus(null);
        setLoadError("");
        setView(data);
      })
      .catch(() => {
        setLoadStatus(null);
        setLoadError("");
        setFetchFailed(true);
      });
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
        const response = await fetch("/api/alliance-sim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as AllianceSimView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Alliance Sim"}
          </>
        }
        title="Alliance Sim"
        description="Simulate a prospective playoff alliance: declare each robot's physical roles, find the optimal assignment, flag conflicts, and estimate win probability from real coverage."
      >
        {view?.status === "live" && view.scenarios.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Scenario
            <select
              value={view.selectedScenarioId ?? ""}
              onChange={(event) => load(event.target.value || null)}
            >
              {view.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name}
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
        (() => {
          const kind = classifyLoadFailure({
            status: loadStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
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
          <ScenarioPanel view={view} busy={busy} mutate={mutate} />
          {view.selectedScenarioId ? (
            <>
              <RobotForm busy={busy} mutate={mutate} />
              {view.robots.length > 0 ? (
                <>
                  <ResultPanel view={view} />
                  <RobotList view={view} busy={busy} mutate={mutate} />
                </>
              ) : (
                <EmptyState
                  badge="No robots yet"
                  badgeTone="setup"
                  title="Add alliance robots to this scenario"
                  description="Declare each robot's capable physical roles and strength to see role assignment, conflicts, and win probability."
                />
              )}
            </>
          ) : null}
        </div>
      )}
    </main>
  );
}

function ScenarioPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({ name: "", eventName: "", seasonYear: String(new Date().getUTCFullYear()) });

  return (
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Scenarios</h2>
          <small className="app-muted">
            {view.scenarios.length} scenario(s){view.selectedScenarioId ? ` · viewing "${view.scenarios.find((s) => s.id === view.selectedScenarioId)?.name ?? ""}"` : ""}
          </small>
        </div>
        {view.selectedScenarioId ? (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              const scenario = view.scenarios.find((s) => s.id === view.selectedScenarioId);
              if (scenario && window.confirm(`Delete scenario "${scenario.name}"?`)) {
                mutate({ action: "delete-scenario", scenarioId: scenario.id });
              }
            }}
          >
            Delete scenario
          </button>
        ) : null}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.name.trim()) return;
          mutate({
            action: "create-scenario",
            name: form.name,
            eventName: form.eventName || undefined,
            seasonYear: Number(form.seasonYear) || undefined,
          });
          setForm({ name: "", eventName: "", seasonYear: String(new Date().getUTCFullYear()) });
        }}
        style={{ display: "grid", gap: 8, marginTop: 12 }}
      >
        <FormGrid min={160}>
          <FormRow label="Scenario name">
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Semifinal alliance A"
              required
            />
          </FormRow>
          <FormRow label="Event (optional)">
            <input
              value={form.eventName}
              onChange={(event) => setForm((prev) => ({ ...prev, eventName: event.target.value }))}
            />
          </FormRow>
          <FormRow label="Season">
            <input
              type="number"
              value={form.seasonYear}
              onChange={(event) => setForm((prev) => ({ ...prev, seasonYear: event.target.value }))}
            />
          </FormRow>
        </FormGrid>
        <div>
          <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
            New scenario
          </button>
        </div>
      </form>
    </Panel>
  );
}

function RobotForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ teamNumber: "", teamName: "" }), []);
  const [form, setForm] = useState(empty);
  const [roles, setRoles] = useState<AllianceSimRole[]>([]);
  const [strengths, setStrengths] = useState<Partial<Record<AllianceSimRole, number>>>({});

  const toggleRole = (role: AllianceSimRole) =>
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        const teamNumber = Number(form.teamNumber);
        if (!teamNumber || teamNumber <= 0) return;
        mutate({
          action: "add-robot",
          teamNumber,
          teamName: form.teamName || undefined,
          capableRoles: roles,
          roleStrengths: strengths,
        });
        setForm(empty);
        setRoles([]);
        setStrengths({});
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add alliance robot</h2>
      <FormGrid min={160}>
        <FormRow label="Team number">
          <input
            type="number"
            min={1}
            value={form.teamNumber}
            onChange={(event) => setForm((prev) => ({ ...prev, teamNumber: event.target.value }))}
            required
          />
        </FormRow>
        <FormRow label="Team name (optional)">
          <input
            value={form.teamName}
            onChange={(event) => setForm((prev) => ({ ...prev, teamName: event.target.value }))}
          />
        </FormRow>
      </FormGrid>
      <div>
        <span className="app-muted">Capable physical roles</span>
        <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
          {ALLIANCE_SIM_ROLE_DEFS.map((def) => (
            <div key={def.role} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 180 }}>
                <input type="checkbox" checked={roles.includes(def.role)} onChange={() => toggleRole(def.role)} />
                {def.label}
              </label>
              {roles.includes(def.role) ? (
                <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  Strength
                  <select
                    value={strengths[def.role] ?? 3}
                    onChange={(event) =>
                      setStrengths((prev) => ({ ...prev, [def.role]: Number(event.target.value) }))
                    }
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.teamNumber}>
          Add robot
        </button>
      </div>
    </Panel>
  );
}

function ResultPanel({ view }: { view: LiveView }) {
  const { result } = view;
  return (
    <Panel aria-label="Alliance sim result">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: "0 0 4px" }}>Optimal role assignment</h2>
          <small className="app-muted">
            Coverage {pct(result.coverageRatio)} · Essential roles filled {pct(result.essentialCoverage)}. This is
            role fill, not a match win prediction.
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }} aria-label="Role coverage score">
          {pct(result.coverageRatio)}
        </strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {result.assignments.length === 0 ? (
          <span className="app-muted">No roles could be assigned yet — declare capable roles per robot.</span>
        ) : (
          result.assignments.map((assignment) => (
            <div
              key={`${assignment.role}-${assignment.robotId}`}
              style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
            >
              <span>{allianceSimRoleLabel(assignment.role)}</span>
              <small className="app-muted">
                Team {assignment.teamNumber} · strength {assignment.strength}
              </small>
            </div>
          ))
        )}
      </div>
      {result.conflicts.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <strong className="app-muted">Physical role conflicts</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {result.conflicts.map((conflict) => (
              <li key={conflict.role}>
                {allianceSimRoleLabel(conflict.role)}: {conflict.contenders.length} robot(s) capable, only{" "}
                {conflict.capacity} slot(s) — unassigned:{" "}
                {conflict.unassigned.map((r) => `Team ${r.teamNumber}`).join(", ") || "none"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function RobotList({
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
      <h2 style={{ marginTop: 0 }}>Alliance robots</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.robots.map((robot) => (
          <li key={robot.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>
                Team {robot.teamNumber}
                {robot.teamName ? ` — ${robot.teamName}` : ""}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {robot.capableRoles.length > 0
                  ? robot.capableRoles.map((role) => allianceSimRoleLabel(role)).join(", ")
                  : "No roles declared"}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove Team ${robot.teamNumber}?`)) {
                  mutate({ action: "delete-robot", robotId: robot.id, scenarioId: view.selectedScenarioId });
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
