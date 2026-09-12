"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { DEFAULT_STATIONS, planToCsv, tabletSheetsByScout } from "../../lib/shift-balancer";
import type { ShiftBalancerView } from "../../lib/shift-balancer/compute-shift-balancer";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function isShiftBalancerView(value: unknown): value is ShiftBalancerView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistShiftBalancerSnapshot(orgHint: string, data: ShiftBalancerView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("shift-balancer", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("shift-balancer", "_", data);
  } catch {
    // Live shift board already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<ShiftBalancerView, { status: "live" }>;

export default function ShiftBalancerClient() {
  const [view, setView] = useState<ShiftBalancerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ShiftBalancerView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<ShiftBalancerView>("shift-balancer", urlOrg || "_");
        if (!viewRef.current && cached?.data && isShiftBalancerView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setErrorStatus(null);
      setErrorMessage(null);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(
          `/api/shift-balancer${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as ShiftBalancerView | { error?: string };
        if (!response.ok || !isShiftBalancerView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Scout shift balancer. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setErrorStatus(response.status);
            setErrorMessage("error" in data && data.error ? data.error : null);
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistShiftBalancerSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Scout shift balancer. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
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
        const response = await fetch("/api/shift-balancer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as ShiftBalancerView | { error?: string };
        if (!response.ok || !isShiftBalancerView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistShiftBalancerSnapshot(orgId, data);
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
            {" / Shift Balancer"}
          </>
        }
        title="Scout shift load balancer"
        description="Auto-generate scouting shift rotations across the roster, capping consecutive matches per scout. When an event schedule is cached, assign scouts to real qualification slots, flag lunch-sized gaps, and print a sheet per tablet."
      />
      <OfflineBanner feature="Scout shift balancer" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: errorMessage,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: errorMessage,
            },
          );
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
        <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <RosterPanel view={view} busy={busy} mutate={mutate} />
          <GeneratePlanForm view={view} busy={busy} mutate={mutate} />
          <PlansPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function RosterPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState("");
  const activeCount = view.scouts.filter((s) => s.active).length;

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Scout roster</h2>
        <small className="app-muted">
          {activeCount} active · {view.scouts.length} total
        </small>
      </header>

      {view.scouts.length === 0 ? (
        <p className="app-muted">Add scouts to build a rotation.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, marginTop: 10 }}>
          {view.scouts.map((scout) => (
            <li key={scout.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span>
                {scout.name}{" "}
                {!scout.active ? <span className="app-badge setup">Inactive</span> : null}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "set-scout-active", scoutId: scout.id, active: !scout.active })}
                >
                  {scout.active ? "Deactivate" : "Activate"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove "${scout.name}" from the roster?`)) {
                      mutate({ action: "remove-scout", scoutId: scout.id });
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          mutate({ action: "add-scout", name });
          setName("");
        }}
        style={{ display: "flex", gap: 8, marginTop: 12 }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Scout name" />
        <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
          Add scout
        </Button>
      </form>
    </Panel>
  );
}

function GeneratePlanForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      label: "",
      matchCount: "10",
      maxConsecutiveMatches: "3",
      stations: DEFAULT_STATIONS.join(", "),
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = (useEventSchedule: boolean) => {
    const matchCount = Number(form.matchCount);
    const maxConsecutiveMatches = Number(form.maxConsecutiveMatches);
    if (!useEventSchedule && (!matchCount || matchCount <= 0)) return;
    mutate({
      action: "generate-plan",
      label: form.label || (useEventSchedule ? "Event quals rotation" : "Shift plan"),
      matchCount,
      maxConsecutiveMatches: maxConsecutiveMatches > 0 ? maxConsecutiveMatches : 3,
      stations: form.stations
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      useEventSchedule,
    });
    setForm(empty);
  };

  return (
    <Panel as="form" onSubmit={(event) => { event.preventDefault(); submit(false); }} style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Generate rotation</h2>
      {view.eventKey && view.qualMatchCount > 0 ? (
        <p className="app-muted" style={{ margin: 0 }}>
          Active event {view.eventKey} has {view.qualMatchCount} cached qualification matches.
        </p>
      ) : view.eventKey ? (
        <p className="app-muted" style={{ margin: 0 }}>
          Active event {view.eventKey} has no qualification matches cached yet. Sync official matches or generate a numeric plan below.
        </p>
      ) : (
        <p className="app-muted" style={{ margin: 0 }}>
          Set an active event on Command to generate from the official qualification schedule.
        </p>
      )}
      <FormGrid min={160}>
        <FormRow label="Plan label">
          <input value={form.label} onChange={set("label")} placeholder="Quals rotation" />
        </FormRow>
        <FormRow label="Match count">
          <input type="number" min={1} value={form.matchCount} onChange={set("matchCount")} required />
        </FormRow>
        <FormRow label="Max consecutive matches" hint="Fatigue cap per scout">
          <input
            type="number"
            min={1}
            value={form.maxConsecutiveMatches}
            onChange={set("maxConsecutiveMatches")}
            required
          />
        </FormRow>
      </FormGrid>
      <FormRow label="Stations (comma-separated)">
        <input value={form.stations} onChange={set("stations")} />
      </FormRow>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="primary" type="submit" disabled={busy || !Number(form.matchCount)}>
          Generate plan
        </Button>
        <Button variant="secondary" type="button" disabled={busy || view.qualMatchCount <= 0} onClick={() => submit(true)}>
          Use event schedule
        </Button>
      </div>
    </Panel>
  );
}

function PlansPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.plans.length === 0) {
    return (
      <EmptyState
        badge="No plans yet"
        badgeTone="setup"
        title="Generate your first shift rotation"
        description="Add scouts to the roster, then generate a plan to balance shifts and cap fatigue."
      />
    );
  }

  const latest = view.plans[0];
  const summary = view.latestSummary;
  if (!latest) return null;
  const sheets = tabletSheetsByScout(latest.assignments);

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Latest plan · {latest.label}</h2>
      <small className="app-muted">
        {latest.matchCount} matches · {latest.stations.length} stations/match · max {latest.maxConsecutiveMatches}{" "}
        consecutive
      </small>

      {summary?.rosterShortfall ? (
        <p className="telemetry-status" role="alert" style={{ marginTop: 8 }}>
          Roster is smaller than the station count — some stations may go unfilled some matches.
        </p>
      ) : null}

      {summary ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginTop: 12 }}>
          <div>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{summary.totalShifts}</strong>
            <span className="app-muted">Total shifts</span>
          </div>
          <div>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{summary.scoutsUsed}</strong>
            <span className="app-muted">Scouts used</span>
          </div>
          <div>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{summary.maxLoad}</strong>
            <span className="app-muted">Max shifts/scout</span>
          </div>
          <div>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{summary.minLoad}</strong>
            <span className="app-muted">Min shifts/scout</span>
          </div>
        </div>
      ) : null}

      {summary && summary.loadByScout.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6, marginTop: 12 }}>
          {summary.loadByScout.map((row) => (
            <li key={row.scoutId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.scoutName}</span>
              <small className="app-muted">
                {row.shifts} shift(s) · longest streak {row.longestStreak}
              </small>
            </li>
          ))}
        </ul>
      ) : null}

      {latest.assignments.some((row) => row.teamNumber != null) ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6, marginTop: 12 }}>
          {latest.assignments.slice(0, 18).map((row, index) => (
            <li
              key={`${row.matchKey ?? row.match}-${row.station}-${row.scoutId}-${index}`}
              style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
            >
              <span>
                {row.matchLabel ?? `Match ${row.match}`} · {row.station}
                {row.teamNumber != null ? ` · ${row.teamNumber}` : ""}
                {row.breakAfterMinutes != null ? ` · ${row.breakAfterMinutes}m break` : ""}
              </span>
              <small className="app-muted">{row.scoutName}</small>
            </li>
          ))}
        </ul>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <Button variant="secondary" type="button" onClick={() => { const csv = planToCsv({ label: latest.label, assignments: latest.assignments }); const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${latest.label.replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "") || "scout-shifts"}.csv`; link.click(); URL.revokeObjectURL(url); }}>
          Download CSV
        </Button>
        <Button variant="secondary" type="button" onClick={() => window.print()}>
          Print tablet sheets
        </Button>
      </div>

      {sheets.length > 0 ? (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <h3 style={{ margin: 0 }}>Tablet sheets</h3>
          <p className="app-muted" style={{ margin: 0 }}>
            One card per scout — tape it to the tablet the way CD teams print ScoutingPASS / scoutsched sheets.
          </p>
          {sheets.map((sheet) => (
            <article
              key={sheet.scoutId}
              style={{ border: "1px solid var(--line, #ccc)", borderRadius: 8, padding: 12 }}
            >
              <strong>{sheet.scoutName}</strong>
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 4 }}>
                {sheet.rows.map((row, index) => (
                  <li key={`${row.match}-${row.station}-${index}`}>
                    {row.matchLabel ?? `Match ${row.match}`} · {row.station}
                    {row.teamNumber != null ? ` · team ${row.teamNumber}` : ""}
                    {row.breakAfterMinutes != null ? ` · then ${row.breakAfterMinutes}m break` : ""}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      <h3 style={{ marginTop: 16 }}>All plans</h3>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {view.plans.map((plan) => (
          <li key={plan.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span>
              {plan.label} <small className="app-muted">({plan.matchCount} matches)</small>
            </span>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete plan "${plan.label}"?`)) {
                  mutate({ action: "delete-plan", planId: plan.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
