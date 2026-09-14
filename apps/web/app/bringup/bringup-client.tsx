"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import {
  BRINGUP_PHASES,
  BRINGUP_PHASE_LABEL,
  BRINGUP_RESULTS,
  type BringupPhase,
  type BringupResult,
} from "../../lib/bringup";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Item = {
  id: string;
  phase: BringupPhase;
  label: string;
  result: BringupResult;
  note: string;
  sortOrder: number;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      items: Item[];
      progress: { total: number; done: number; failed: number; percent: number; ready: boolean };
    };

const RESULT_LABEL: Record<BringupResult, string> = {
  pending: "—",
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
};

function isBringupView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function bringupCacheOrg(data: View, orgHint: string): string {
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

async function persistBringupSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = bringupCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("bringup", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("bringup", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Bring-up already painted; IndexedDB is best-effort.
  }
}

function BringupRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related robot tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "inspection-copilot", orgId)}>
        Inspection
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "wiring-map", orgId)}>
        CAN-bus map
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "robot", orgId)}>
        Blueprint
      </Button>
    </nav>
  );
}

function BringupNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "checklist",
      label: "Tick the next item",
      detail: "Pass, fail, or skip each first-power check before the robot drives.",
      href: "#bringup-checklist",
      primary: true,
    },
    {
      id: "inspection",
      label: "Open Inspection",
      detail: "Event weigh-in and binder checks sit next to this first-power list.",
      href: hubHref("/build", "inspection-copilot", orgId),
      primary: false,
    },
    {
      id: "wiring",
      label: "Open CAN-bus map",
      detail: "Wiring that failed bring-up should match the map.",
      href: hubHref("/build", "wiring-map", orgId),
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

export default function BringupClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [custom, setCustom] = useState<{ phase: BringupPhase; label: string }>({
    phase: "mechanical",
    label: "",
  });
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("bringup", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isBringupView(cached.data)) {
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
        `/api/bringup?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
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
      if (!response.ok || !isBringupView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Bring-up. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load checklist",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistBringupSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Bring-up. Showing the last copy on this device.");
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
    const response = await fetch("/api/bringup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addCustom(event: FormEvent) {
    event.preventDefault();
    if (!custom.label.trim()) return;
    await post({ action: "add_item", seasonYear, ...custom }, "Item added.");
    if (view?.status === "ready") setCustom({ ...custom, label: "" });
  }

  const robotHref = hubWorkbenchHref("build", "bringup", orgId);

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
              {" / Bring-up"}
            </>
          }
          title="Bring-up"
          description="First-power checks before this robot drives."
        >
          <BringupRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Bring-up" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Bring-up"}
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
                {" / Bring-up"}
              </>
            }
            title="Bring-up"
            description="First-power checks before this robot drives."
          >
            <BringupRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Bring-up" fromCache={fromCache} cachedAt={cachedAt} />
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

  const p = view.progress;
  const phasesWithItems = BRINGUP_PHASES.filter((ph) => view.items.some((i) => i.phase === ph));

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Bring-up"}
          </>
        }
        title={`Bring-up — ${seasonYear}`}
        description="First-power checks before this robot drives."
      >
        <BringupRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Bring-up" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Progress" value={`${p.percent}%`} />
        <StatTile label="Done" value={`${p.done}/${p.total}`} />
        <StatTile label="Failures" value={p.failed} />
        <StatTile label="Ready to drive" value={p.ready ? "Yes" : "Not yet"} />
      </div>

      {view.items.length === 0 ? (
        <EmptyState
          title="No checklist yet"
          description="Load the standard first-power checks (mechanical, electrical, software, validation) for this robot."
        >
          <Button
            variant="primary"
            type="button"
            onClick={() => void post({ action: "seed_template", seasonYear }, "Standard checklist loaded.")}
          >
            Load standard checklist
          </Button>
        </EmptyState>
      ) : (
        <>
          <div id="bringup-checklist">
            {phasesWithItems.map((phase) => (
              <Panel key={phase}>
                <h2>{BRINGUP_PHASE_LABEL[phase]}</h2>
                <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
                  {view.items
                    .filter((i) => i.phase === phase)
                    .map((item) => (
                      <li
                        key={item.id}
                        style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
                      >
                        <div>
                          <strong>
                            {item.result === "pass" ? "✓ " : item.result === "fail" ? "✗ " : ""}
                            {item.label}
                          </strong>
                          <small className="app-muted" style={{ display: "block" }}>
                            {RESULT_LABEL[item.result]}
                            {item.note ? ` · ${item.note}` : ""}
                          </small>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {BRINGUP_RESULTS.filter((r) => r !== "pending" && r !== item.result).map((r) => (
                            <Button
                              key={r}
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => void post({ action: "set_result", id: item.id, result: r }, "Updated.")}
                            >
                              {RESULT_LABEL[r]}
                            </Button>
                          ))}
                          {view.context.role !== "viewer" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="danger"
                              onClick={() => void post({ action: "delete_item", id: item.id }, "Removed.")}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                </ul>
              </Panel>
            ))}
          </div>

          <Panel as="form" onSubmit={addCustom}>
            <h2>Add a custom item</h2>
            <FormGrid min={160}>
              <FormRow label="Phase">
                <select
                  value={custom.phase}
                  onChange={(e) => setCustom({ ...custom, phase: e.target.value as BringupPhase })}
                >
                  {BRINGUP_PHASES.map((ph) => (
                    <option key={ph} value={ph}>
                      {BRINGUP_PHASE_LABEL[ph]}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Item">
                <input
                  value={custom.label}
                  onChange={(e) => setCustom({ ...custom, label: e.target.value })}
                  placeholder="Check LED strip wiring"
                />
              </FormRow>
            </FormGrid>
            <Button variant="primary" type="submit">
              Add item
            </Button>
          </Panel>

          <BringupNextActions orgId={view.context.orgId} />
        </>
      )}
    </main>
  );
}
