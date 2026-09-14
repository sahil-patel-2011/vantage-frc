"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import {
  AUTO_PRIORITIES,
  AUTO_STATUS_LABEL,
  AUTO_STATUSES,
  START_POSITIONS,
  type AutoPriority,
  type AutoStatus,
  type StartPosition,
} from "../../lib/auto-routines";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Routine = {
  id: string;
  name: string;
  startPosition: StartPosition;
  status: AutoStatus;
  priority: AutoPriority;
  estimatedPoints: number | null;
  description: string;
  pathNotes: string;
  byName: string | null;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      routines: Routine[];
      summary: {
        total: number;
        ready: number;
        proven: number;
        coveredStartPositions: string[];
        highPriorityUnproven: number;
        bestReadyPoints: number | null;
      };
    };

const EMPTY = {
  name: "",
  startPosition: "center" as StartPosition,
  status: "concept" as AutoStatus,
  priority: "normal" as AutoPriority,
  estimatedPoints: "",
  description: "",
  pathNotes: "",
};

function startLabel(position: string): string {
  if (!position) return position;
  return position.slice(0, 1).toUpperCase() + position.slice(1);
}

function isAutoRoutinesView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function autoRoutinesCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "ready":
      return data.context.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistAutoRoutinesSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = autoRoutinesCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("auto-routines", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("auto-routines", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Auto routines already painted; IndexedDB is best-effort.
  }
}

function AutoRoutinesRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related competition tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "auton-path-library", orgId)}>
        Auton paths
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "code", orgId)}>
        Code
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "strategy", orgId)}>
        Strategy
      </Button>
    </nav>
  );
}

function AutoRoutinesNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add an auto",
      detail: "Name it, pick a start position, and mark when it is competition-ready.",
      href: "#auto-routine",
      primary: true,
    },
    {
      id: "paths",
      label: "Open Auton paths",
      detail: "Field drawings for the routines you catalog here.",
      href: hubHref("/build", "auton-path-library", orgId),
      primary: false,
    },
    {
      id: "code",
      label: "Open Code",
      detail: "The programs that run these autos live next to this list.",
      href: hubHref("/build", "code", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function AutoRoutinesClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("auto-routines", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isAutoRoutinesView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/auto-routines?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
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
      if (!response.ok || !isAutoRoutinesView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Auto routines. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load auto library",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistAutoRoutinesSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Auto routines. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/auto-routines", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addRoutine(event: FormEvent) {
    event.preventDefault();
    await post({ action: "create_routine", seasonYear, ...form }, "Routine added.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  const robotHref = hubWorkbenchHref("build", "auton-path-library", orgId);

  if (!view) {
    const failure = fetchFailed
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
              <a href={robotHref}>Build</a>
              {" / Auto routines"}
            </>
          }
          title="Auto routines"
          description="Which autos are competition-ready from each start position."
        >
          <AutoRoutinesRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Auto routines" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading auto routines…"}
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
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          <PageHeader
            breadcrumbs={
              <>
                <a href={robotHref}>Build</a>
                {" / Auto routines"}
              </>
            }
            title="Auto routines"
            description="Which autos are competition-ready from each start position."
          >
            <AutoRoutinesRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Auto routines" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        </main>
      );
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Auto routines"}
          </>
        }
        title={`Auto routines — ${seasonYear}`}
        description="Which autos are competition-ready from each start position."
      >
        <AutoRoutinesRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Auto routines" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Competition-ready" value={view.summary.ready} />
        <StatTile label="Start positions covered" value={`${view.summary.coveredStartPositions.length}/3`} />
        <StatTile label="High-priority unproven" value={view.summary.highPriorityUnproven} />
        <StatTile
          label="Best ready auto"
          value={view.summary.bestReadyPoints != null ? `${view.summary.bestReadyPoints} pts` : "—"}
        />
      </div>

      <Panel as="form" id="auto-routine" onSubmit={addRoutine}>
        <h2>Add an auto routine</h2>
        <FormGrid min={160}>
          <FormRow label="Name" wide>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Center 3-piece"
            />
          </FormRow>
          <FormRow label="Start position">
            <select
              value={form.startPosition}
              onChange={(e) => setForm({ ...form, startPosition: e.target.value as StartPosition })}
            >
              {START_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {startLabel(p)}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Est. points">
            <input
              type="number"
              min="0"
              value={form.estimatedPoints}
              onChange={(e) => setForm({ ...form, estimatedPoints: e.target.value })}
            />
          </FormRow>
          <FormRow label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as AutoStatus })}
            >
              {AUTO_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {AUTO_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Priority">
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as AutoPriority })}
            >
              {AUTO_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {startLabel(p)}
                </option>
              ))}
            </select>
          </FormRow>
        </FormGrid>
        <FormRow label="Description" wide>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormRow>
        <FormRow label="Path / sequence notes" wide>
          <input
            value={form.pathNotes}
            onChange={(e) => setForm({ ...form, pathNotes: e.target.value })}
          />
        </FormRow>
        <Button variant="primary" type="submit">
          Add routine
        </Button>
      </Panel>

      <Panel>
        <h2>Readiness</h2>
        <p className="app-muted">
          {view.summary.ready} of {view.summary.total} routines are competition-ready.
        </p>
        <p className="app-muted">
          Start positions with a ready auto:{" "}
          {view.summary.coveredStartPositions.length
            ? view.summary.coveredStartPositions.map(startLabel).join(", ")
            : "none yet"}
          .
        </p>
        {view.summary.highPriorityUnproven > 0 ? (
          <p>
            <strong>
              {view.summary.highPriorityUnproven} high-priority auto
              {view.summary.highPriorityUnproven === 1 ? "" : "s"} still need testing.
            </strong>
          </p>
        ) : null}
      </Panel>

      <Panel>
        <h2>Routines</h2>
        {view.routines.length === 0 ? (
          <p className="app-muted">No auto routines yet — add the first one above.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.routines.map((r) => (
              <li
                key={r.id}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
              >
                <div>
                  <strong>
                    {r.name}
                    {r.status === "competition_ready" ? " ✓" : ""}
                  </strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    from {startLabel(r.startPosition)} · {AUTO_STATUS_LABEL[r.status]} · {startLabel(r.priority)}{" "}
                    priority
                    {r.estimatedPoints != null ? ` · ~${r.estimatedPoints} pts` : ""}
                    {r.description ? ` · ${r.description}` : ""}
                  </small>
                  {r.pathNotes ? (
                    <small className="app-muted" style={{ display: "block" }}>
                      {r.pathNotes}
                    </small>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {r.status !== "competition_ready" && r.status !== "retired" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void post({ action: "set_status", id: r.id, status: "competition_ready" }, "Marked ready.")}
                    >
                      Mark ready
                    </Button>
                  ) : null}
                  {view.context.role !== "viewer" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => void post({ action: "delete_routine", id: r.id }, "Routine deleted.")}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AutoRoutinesNextActions orgId={view.context.orgId} />
    </main>
  );
}
