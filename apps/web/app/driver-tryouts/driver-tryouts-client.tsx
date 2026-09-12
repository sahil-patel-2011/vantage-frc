"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  DRIVER_TRYOUTS_CRITERIA,
  DRIVER_TRYOUTS_ROLES,
  DRIVER_TRYOUTS_STATUSES,
  driverTryoutsCriterionLabel,
  driverTryoutsRoleLabel,
  driverTryoutsStatusLabel,
  parseRubricScore,
} from "../../lib/driver-tryouts";
import type { DriverTryoutsView } from "../../lib/driver-tryouts/compute-driver-tryouts";
import type { DriverTryoutsReadinessTier, DriverTryoutsRole } from "../../lib/driver-tryouts/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function tierTone(tier: DriverTryoutsReadinessTier): string {
  if (tier === "ready") return "good";
  if (tier === "in_progress") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<DriverTryoutsView, { status: "live" }>;

function isDriverTryoutsView(value: unknown): value is DriverTryoutsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function driverTryoutsCacheOrg(data: DriverTryoutsView, orgHint: string): string {
  switch (data.status) {
    case "live":
      return data.orgId.trim() || orgHint;
    case "setup_required":
      return data.orgId?.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistDriverTryoutsSnapshot(
  orgHint: string,
  seasonHint: string,
  data: DriverTryoutsView,
): Promise<void> {
  const cacheOrg = driverTryoutsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("driver-tryouts", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("driver-tryouts", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Driver tryouts already painted; IndexedDB is best-effort.
  }
}

export default function DriverTryoutsClient() {
  const [view, setView] = useState<DriverTryoutsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<DriverTryoutsView | null>(null);
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
      const cached = await getFeatureSnapshot<DriverTryoutsView>("driver-tryouts", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isDriverTryoutsView(cached.data)) {
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
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/driver-tryouts${query.toString() ? `?${query.toString()}` : ""}`, {
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
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isDriverTryoutsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Driver tryouts. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
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
      await persistDriverTryoutsSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Driver tryouts. Showing the last copy on this device.");
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
        const response = await fetch("/api/driver-tryouts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isDriverTryoutsView(data)) {
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
        void persistDriverTryoutsSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const failure =
    fetchFailed && !view
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
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Driver tryouts"}
          </>
        }
        title="Driver tryouts"
        description="Score and rank drive-team candidates against a fixed rubric. Selection readiness reflects only what has been scored."
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

      <OfflineBanner feature="Driver tryouts" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {!view ? (
        <EmptyState
          title={failure ? failure.title : "Opening Driver tryouts"}
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
      ) : (
        (() => {
          switch (view.status) {
            case "setup_required":
              return (
                <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
                  {view.steps[0] ? (
                    <Button as="a" variant="primary" href={view.steps[0].href}>
                      {view.steps[0].label}
                    </Button>
                  ) : null}
                </EmptyState>
              );
            case "live":
              return (
                <div style={{ display: "grid", gap: 16 }}>
                  <ReadinessPanel view={view} />
                  <AddCandidateForm busy={busy} mutate={mutate} />
                  {view.candidates.length > 0 ? (
                    <Rankings view={view} busy={busy} mutate={mutate} />
                  ) : (
                    <EmptyState
                      badge="No candidates yet"
                      badgeTone="setup"
                      title="Add your first driver-tryout candidate"
                      description="Add everyone trying out for driver, operator, or human player seats, then log rubric scores."
                    />
                  )}
                </div>
              );
            default: {
              const data: never = view;
              return data satisfies never;
            }
          }
        })()
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness, summary } = view;
  return (
    <Panel aria-label="Selection readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.replace("_", " ").toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Selection readiness</h2>
          <small className="app-muted">
            {summary.evaluatedCandidates} of {summary.totalCandidates} candidate(s) scored ·{" "}
            {readiness.candidatesFullyEvaluated} fully evaluated
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      {readiness.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function Rankings({
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
      <h2 style={{ marginTop: 0 }}>Ranking</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.summary.candidateScores.map((row) => (
          <li key={row.candidateId} className="app-card soft-panel" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <strong>
                  {row.rank ? `#${row.rank} · ` : ""}
                  {row.candidate.name}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {driverTryoutsRoleLabel(row.candidate.roleInterest)} · {driverTryoutsStatusLabel(row.candidate.status)}
                  {row.candidate.gradeLevel ? ` · Grade ${row.candidate.gradeLevel}` : ""}
                </small>
                <small className="app-muted">
                  {row.evaluationCount} evaluation(s)
                  {row.overallAverage != null ? ` · avg ${row.overallAverage.toFixed(2)}/5` : " · not scored"}
                </small>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={row.candidate.status}
                  disabled={busy}
                  onChange={(event) =>
                    mutate({
                      action: "update-candidate-status",
                      candidateId: row.candidateId,
                      status: event.target.value,
                    })
                  }
                >
                  {DRIVER_TRYOUTS_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {driverTryoutsStatusLabel(status)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove "${row.candidate.name}"?`)) {
                      mutate({ action: "delete-candidate", candidateId: row.candidateId });
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
            {row.averages ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginTop: 8 }}>
                {DRIVER_TRYOUTS_CRITERIA.map((criterion) => {
                  const averages = row.averages;
                  if (!averages) return null;
                  return (
                  <div key={criterion}>
                    <small className="app-muted" style={{ display: "block" }}>
                      {driverTryoutsCriterionLabel(criterion)}
                    </small>
                    <strong>{averages[criterion].toFixed(1)}</strong>
                  </div>
                  );
                })}
              </div>
            ) : null}
            <EvaluationForm candidateId={row.candidateId} busy={busy} mutate={mutate} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EvaluationForm({
  candidateId,
  busy,
  mutate,
}: {
  candidateId: string;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      evaluatedOn: "",
      scorePrecision: "",
      scoreAwareness: "",
      scoreCommunication: "",
      scoreComposure: "",
      scoreMechanical: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const scoresReady =
    Boolean(form.evaluatedOn) &&
    [form.scorePrecision, form.scoreAwareness, form.scoreCommunication, form.scoreComposure, form.scoreMechanical].every(
      (value) => parseRubricScore(value) != null,
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!scoresReady) return;
        mutate({
          action: "add-evaluation",
          candidateId,
          evaluatedOn: form.evaluatedOn,
          scorePrecision: Number(form.scorePrecision),
          scoreAwareness: Number(form.scoreAwareness),
          scoreCommunication: Number(form.scoreCommunication),
          scoreComposure: Number(form.scoreComposure),
          scoreMechanical: Number(form.scoreMechanical),
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ marginTop: 10, display: "grid", gap: 8 }}
    >
      <FormGrid min={110}>
        <FormRow label="Date">
          <input type="date" value={form.evaluatedOn} onChange={set("evaluatedOn")} required />
        </FormRow>
        <FormRow label="Precision">
          <input type="number" min={1} max={5} step={1} value={form.scorePrecision} onChange={set("scorePrecision")} required />
        </FormRow>
        <FormRow label="Awareness">
          <input type="number" min={1} max={5} step={1} value={form.scoreAwareness} onChange={set("scoreAwareness")} required />
        </FormRow>
        <FormRow label="Communication">
          <input type="number" min={1} max={5} step={1} value={form.scoreCommunication} onChange={set("scoreCommunication")} required />
        </FormRow>
        <FormRow label="Composure">
          <input type="number" min={1} max={5} step={1} value={form.scoreComposure} onChange={set("scoreComposure")} required />
        </FormRow>
        <FormRow label="Mechanical">
          <input type="number" min={1} max={5} step={1} value={form.scoreMechanical} onChange={set("scoreMechanical")} required />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <input value={form.notes} onChange={set("notes")} />
      </FormRow>
      <div>
        <Button variant="secondary" type="submit" disabled={busy || !scoresReady}>
          Log evaluation
        </Button>
      </div>
    </form>
  );
}

function AddCandidateForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      name: "",
      gradeLevel: "",
      roleInterest: "any" as DriverTryoutsRole,
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
        if (!form.name.trim()) return;
        mutate({
          action: "add-candidate",
          name: form.name,
          gradeLevel: form.gradeLevel || undefined,
          roleInterest: form.roleInterest,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add candidate</h2>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Candidate name" required />
        </FormRow>
        <FormRow label="Grade (optional)">
          <input value={form.gradeLevel} onChange={set("gradeLevel")} />
        </FormRow>
        <FormRow label="Role interest">
          <select value={form.roleInterest} onChange={set("roleInterest")}>
            {DRIVER_TRYOUTS_ROLES.map((role) => (
              <option key={role} value={role}>
                {driverTryoutsRoleLabel(role)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
          Add candidate
        </Button>
      </div>
    </Panel>
  );
}
