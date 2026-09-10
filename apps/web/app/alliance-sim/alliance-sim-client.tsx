"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { ALLIANCE_SIM_ROLE_DEFS, allianceSimRoleLabel } from "../../lib/alliance-sim";
import type { AllianceSimView } from "../../lib/alliance-sim/compute-alliance-sim";
import type { AllianceSimRole } from "../../lib/alliance-sim/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function isAllianceSimView(value: unknown): value is AllianceSimView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistAllianceSimSnapshot(
  orgHint: string,
  scenarioHint: string,
  data: AllianceSimView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  const scenarioKey =
    data.status === "live" && data.selectedScenarioId ? data.selectedScenarioId : scenarioHint;
  try {
    await putFeatureSnapshot("alliance-sim", cacheOrg, data, scenarioKey);
    await putFeatureSnapshot("alliance-sim", cacheOrg, data);
    if (!orgHint) {
      await putFeatureSnapshot("alliance-sim", "_", data, scenarioKey);
      await putFeatureSnapshot("alliance-sim", "_", data);
    }
  } catch {
    // Live simulator already painted; IndexedDB is best-effort.
  }
}

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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<AllianceSimView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((scenarioOverride?: string | null) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const scenarioQuery =
        scenarioOverride !== undefined ? scenarioOverride : params.get("scenarioId");
      const scenarioHint = scenarioQuery?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<AllianceSimView>(
          "alliance-sim",
          urlOrg || "_",
          scenarioHint,
        );
        if (!viewRef.current && cached?.data && isAllianceSimView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (scenarioHint) query.set("scenarioId", scenarioHint);
      try {
        const response = await fetch(
          `/api/alliance-sim${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as AllianceSimView | { error?: string };
        if (!response.ok || !isAllianceSimView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Alliance Sim. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setLoadStatus(response.status);
            setLoadError("error" in data && data.error ? data.error : "");
            setFetchFailed(true);
          }
          return;
        }
        setLoadStatus(null);
        setLoadError("");
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistAllianceSimSnapshot(urlOrg, scenarioHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Alliance Sim. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setLoadStatus(null);
          setLoadError("");
          setFetchFailed(true);
        }
      }
    })();
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as AllianceSimView | { error?: string };
        if (!response.ok || !isAllianceSimView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistAllianceSimSnapshot(orgId, "", data);
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
      <OfflineBanner feature="Alliance Sim" fromCache={fromCache} cachedAt={cachedAt} />

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
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => load()}>
                  Retry
                </Button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
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
          <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
            New scenario
          </Button>
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
        <Button variant="primary" type="submit" disabled={busy || !form.teamNumber}>
          Add robot
        </Button>
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
