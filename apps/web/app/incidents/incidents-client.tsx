"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../components/ui";
import { incidentCategoryLabel, incidentSeverityLabel, incidentStatusLabel } from "../../lib/incidents";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type IncidentsView,
} from "../../lib/incidents/compute-incidents";
import type { IncidentCategory, IncidentEvaluation, IncidentSeverity, IncidentStatus } from "../../lib/incidents/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<IncidentsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function isIncidentsView(value: unknown): value is IncidentsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function incidentsCacheOrg(data: IncidentsView, orgHint: string): string {
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

async function persistIncidentsSnapshot(
  orgHint: string,
  seasonHint: string,
  data: IncidentsView,
): Promise<void> {
  const cacheOrg = incidentsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("incidents", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("incidents", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Safety incidents already painted; IndexedDB is best-effort.
  }
}

const SEVERITY_COLOR: Record<IncidentSeverity, string> = {
  minor: "#2f9e57",
  moderate: "#c9a900",
  serious: "#d9822b",
  critical: "#c02626",
};

export default function IncidentsClient() {
  const [view, setView] = useState<IncidentsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<IncidentsView | null>(null);
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
      const cached = await getFeatureSnapshot<IncidentsView>("incidents", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isIncidentsView(cached.data)) {
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
    setErrorStatus(null);
    setLoadError("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/incidents${query.toString() ? `?${query.toString()}` : ""}`, {
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
      if (!response.ok || !isIncidentsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Safety incidents. Showing the last copy on this device.");
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
      await persistIncidentsSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Safety incidents. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data = (await response.json()) as IncidentsView | { error?: string };
          if (!response.ok || !isIncidentsView(data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
          setFromCache(false);
          void persistIncidentsSnapshot(orgId, String(data.seasonYear), data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  const related = (
    <nav className="product-hub-related" aria-label="Related safety tools">
      <Button as="a" variant="secondary" href={withOrgHref("/safety", orgId)}>
        Safety log
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "safety-training", orgId)}>
        Safety training
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "fmea", orgId)}>
        Failure log
      </Button>
    </nav>
  );

  if (!view) {
    const copy = fetchFailed
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
          breadcrumbs="Team / Safety incidents"
          title="Safety incidents"
          description="Log injuries, near-misses, and shop hazards, assign a corrective action, and track it to closure."
        >
          {related}
        </PageHeader>
        <OfflineBanner feature="Safety incidents" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={copy ? copy.title : "Opening Safety incidents"}
          description={copy ? copy.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : copy?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
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
            breadcrumbs="Team / Safety incidents"
            title="Safety incidents"
            description="Log injuries, near-misses, and shop hazards, assign a corrective action, and track it to closure."
          >
            {related}
          </PageHeader>
          <OfflineBanner feature="Safety incidents" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState
            soft
            badge="Needs setup"
            badgeTone="setup"
            title="Choose your team"
            description={view.message}
          >
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      const data: never = view;
      return data satisfies never;
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Safety incidents"
        title="Safety incidents"
        description="Log injuries, near-misses, and shop hazards, assign a corrective action, and track it to closure. A near-miss recorded today is an injury prevented tomorrow."
      >
        {related}
        {view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                void load(next);
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

      <OfflineBanner feature="Safety incidents" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        {view.summary.overdue.length > 0 || view.summary.priority.length > 0 ? <Attention view={view} /> : null}
        <AddIncidentForm busy={busy} mutate={mutate} />
        <IncidentList view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  return (
    <section className="app-card soft-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{s.open}</strong>
          <span className="app-muted">Open</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block", color: s.bySeverity.critical + s.bySeverity.serious > 0 ? "#c02626" : "inherit" }}>
            {s.bySeverity.critical + s.bySeverity.serious}
          </strong>
          <span className="app-muted">Serious+</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{s.overdue.length}</strong>
          <span className="app-muted">Overdue actions</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{s.avgDaysOpen}</strong>
          <span className="app-muted">Avg days open</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {(["critical", "serious", "moderate", "minor"] as IncidentSeverity[]).map((severity) => (
          <span key={severity} className="app-badge" style={{ background: SEVERITY_COLOR[severity], color: "#fff" }}>
            {incidentSeverityLabel(severity)}: {s.bySeverity[severity]}
          </span>
        ))}
      </div>
    </section>
  );
}

function Attention({ view }: { view: LiveView }) {
  const items = view.summary.overdue.length > 0 ? view.summary.overdue : view.summary.priority;
  const heading = view.summary.overdue.length > 0 ? "Overdue corrective actions" : "Priority — serious & critical";
  return (
    <section className="app-card soft-panel" style={{ borderLeft: "3px solid #c02626" }}>
      <h2 style={{ marginTop: 0 }}>{heading}</h2>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {items.map((evaluation) => (
          <li key={evaluation.incident.id}>
            <strong>{evaluation.incident.title}</strong>
            <span style={{ color: SEVERITY_COLOR[evaluation.incident.severity] }}>
              {" "}
              · {incidentSeverityLabel(evaluation.incident.severity)}
            </span>
            <small className="app-muted">
              {" "}
              · {incidentCategoryLabel(evaluation.incident.category)}
              {evaluation.daysToDue != null && evaluation.overdue ? ` · ${Math.abs(evaluation.daysToDue)}d overdue` : ""}
              {evaluation.daysOpen != null ? ` · open ${evaluation.daysOpen}d` : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddIncidentForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      title: "",
      category: "near_miss" as IncidentCategory,
      severity: "moderate" as IncidentSeverity,
      occurredOn: "",
      location: "",
      description: "",
      correctiveAction: "",
      owner: "",
      dueOn: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="app-card soft-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-incident",
          title: form.title,
          category: form.category,
          severity: form.severity,
          occurredOn: form.occurredOn || undefined,
          location: form.location || undefined,
          description: form.description || undefined,
          correctiveAction: form.correctiveAction || undefined,
          owner: form.owner || undefined,
          dueOn: form.dueOn || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log an incident</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          <span className="app-muted">What happened?</span>
          <input value={form.title} onChange={set("title")} placeholder="Finger pinch near the mill vise" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Category</span>
          <select value={form.category} onChange={set("category")}>
            {INCIDENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {incidentCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Severity</span>
          <select value={form.severity} onChange={set("severity")}>
            {INCIDENT_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {incidentSeverityLabel(severity)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Occurred</span>
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Location</span>
          <input value={form.location} onChange={set("location")} placeholder="Machine shop" />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Action owner</span>
          <input value={form.owner} onChange={set("owner")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Action due</span>
          <input type="date" value={form.dueOn} onChange={set("dueOn")} />
        </label>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">What happened / contributing factors</span>
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Corrective action</span>
        <textarea value={form.correctiveAction} onChange={set("correctiveAction")} rows={2} placeholder="Add a fixed guard; brief team on vise procedure" />
      </label>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>
          Log incident
        </Button>
      </div>
    </form>
  );
}

function IncidentList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.evaluations.length === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge good">All clear</span>
        <h2>No incidents logged</h2>
        <p className="app-muted">Log near-misses and hazards here — a strong safety record is built on catching the small stuff.</p>
      </section>
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
      {view.evaluations.map((evaluation) => (
        <IncidentCard key={evaluation.incident.id} evaluation={evaluation} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function IncidentCard({ evaluation, busy, mutate }: { evaluation: IncidentEvaluation; busy: boolean; mutate: Mutate }) {
  const { incident, isOpen, overdue, daysToDue, daysOpen } = evaluation;
  return (
    <article className="app-card soft-panel" style={{ opacity: isOpen ? 1 : 0.65 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge" style={{ background: SEVERITY_COLOR[incident.severity], color: "#fff" }}>
            {incidentSeverityLabel(incident.severity)}
          </span>{" "}
          <small className="app-muted">
            {incidentCategoryLabel(incident.category)} · {incident.occurredOn}
            {incident.location ? ` · ${incident.location}` : ""}
            {incident.owner ? ` · ${incident.owner}` : ""}
          </small>
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>{incident.title}</h2>
        </div>
        {isOpen ? (
          <small className="app-muted" style={{ textAlign: "right" }}>
            {daysOpen != null ? `open ${daysOpen}d` : ""}
            {incident.dueOn ? (
              <span style={{ display: "block", color: overdue ? "#c02626" : "inherit" }}>
                {overdue ? `${Math.abs(daysToDue ?? 0)}d overdue` : `due in ${daysToDue}d`}
              </span>
            ) : null}
          </small>
        ) : null}
      </header>

      {incident.description ? (
        <p style={{ margin: "8px 0 0" }}>
          <span className="app-muted">Detail: </span>
          {incident.description}
        </p>
      ) : null}
      {incident.correctiveAction ? (
        <p style={{ margin: "8px 0 0" }}>
          <span className="app-muted">Corrective action: </span>
          {incident.correctiveAction}
        </p>
      ) : (
        <p className="app-muted" style={{ margin: "8px 0 0" }}>No corrective action recorded yet.</p>
      )}

      <footer style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Severity
          <select
            value={incident.severity}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-incident", incidentId: incident.id, severity: event.target.value })}
          >
            {INCIDENT_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {incidentSeverityLabel(severity)}
              </option>
            ))}
          </select>
        </label>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Status
          <select
            value={incident.status}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-incident", incidentId: incident.id, status: event.target.value })}
          >
            {INCIDENT_STATUSES.map((status: IncidentStatus) => (
              <option key={status} value={status}>
                {incidentStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${incident.title}"?`)) mutate({ action: "delete-incident", incidentId: incident.id });
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
