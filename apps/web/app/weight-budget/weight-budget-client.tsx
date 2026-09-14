"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { stale125WeightLimitCue } from "../../lib/weight-budget";
import {
  NO_WEIGH_IN_CLOSE_CUE,
  closePlannedAgainstWeighIn,
  isCloseBlank,
  scaleEntriesFromWeighInPayload,
  type WeighInScaleEntry,
} from "../../lib/weight-budget/close-vs-weigh-in";

type Component = {
  id: string;
  name: string;
  subsystem: string;
  weightLbs: number;
  quantity: number;
  notes: string;
  byName: string | null;
};
type Summary = {
  count: number;
  totalLbs: number;
  limitLbs: number;
  remainingLbs: number;
  overLimit: boolean;
  percentUsed: number;
  bySubsystem: { subsystem: string; lbs: number }[];
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; components: Component[]; summary: Summary };

const EMPTY = { name: "", subsystem: "", weightLbs: "", quantity: "1", notes: "" };

function isWeightBudgetView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function weightBudgetCacheOrg(data: View, orgHint: string): string {
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

async function persistWeightBudgetSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = weightBudgetCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("weight-budget", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("weight-budget", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Weight budget already painted; IndexedDB is best-effort.
  }
}

function WeightBudgetRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "robot-weigh-in", orgId)}>
        Weigh-in
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "gearbox", orgId)}>
        Gearbox calculator
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "inspection-copilot", orgId)}>
        Inspection
      </Button>
    </nav>
  );
}

function WeightBudgetNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add a component",
      detail: "Log the heavy items first — drivetrain, battery mount, superstructure.",
      href: "#weight-add",
      primary: true,
    },
    {
      id: "weigh-in",
      label: "Open Weigh-in",
      detail: "Planned vs scale stays blank until someone logs a real weigh-in.",
      href: hubHref("/build", "robot-weigh-in", orgId),
      primary: false,
    },
    {
      id: "inspection",
      label: "Open Inspection",
      detail: "Cut weight before inspection if the planned total is over the limit.",
      href: hubHref("/build", "inspection-copilot", orgId),
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

export default function WeightBudgetClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [limitDraft, setLimitDraft] = useState("");
  const [scaleEntries, setScaleEntries] = useState<WeighInScaleEntry[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("weight-budget", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isWeightBudgetView(cached.data)) {
        setView(cached.data);
        if (cached.data.status === "ready") setLimitDraft(String(cached.data.summary.limitLbs));
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
    const weighInQuery = new URLSearchParams({ season: String(seasonYear) });
    if (orgId) weighInQuery.set("orgId", orgId);
    try {
      const [response, weighInResponse] = await Promise.all([
        fetch(`/api/weight-budget?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        }),
        fetch(`/api/robot-weigh-in?${weighInQuery.toString()}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        }).catch(() => null),
      ]);
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setScaleEntries([]);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isWeightBudgetView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Weight budget. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load weight budget",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      if (data.status === "ready") setLimitDraft(String(data.summary.limitLbs));
      await persistWeightBudgetSnapshot(orgHint, seasonHint, data);
      if (!weighInResponse || !weighInResponse.ok) {
        setScaleEntries([]);
      } else {
        const weighIn = await weighInResponse.json().catch(() => null);
        setScaleEntries(scaleEntriesFromWeighInPayload(weighIn));
      }
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Weight budget. Showing the last copy on this device.");
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
    const response = await fetch("/api/weight-budget", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addComponent(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_component", seasonYear, ...form }, "Component added.");
    if (view?.status === "ready") setForm({ ...EMPTY, subsystem: form.subsystem });
  }

  const robotHref = hubWorkbenchHref("build", "weight-budget", orgId);

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
              typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
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
              {" / Weight budget"}
            </>
          }
          title="Weight budget"
          description="Planned pounds from logged components."
        >
          <WeightBudgetRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Weight budget" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading weight budget…"}
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
                {" / Weight budget"}
              </>
            }
            title="Weight budget"
            description="Planned pounds from logged components."
          >
            <WeightBudgetRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Weight budget" fromCache={fromCache} cachedAt={cachedAt} />
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

  const s = view.summary;
  const close = closePlannedAgainstWeighIn(s.totalLbs, scaleEntries);
  const closeBlank = isCloseBlank(close);
  const weighInHref = hubHref("/build", "robot-weigh-in", view.context.orgId);
  const staleCue = stale125WeightLimitCue(s.limitLbs);

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Weight budget"}
          </>
        }
        title={`Weight budget — ${seasonYear}`}
        description="Planned pounds from logged components. Scale comparison stays blank until weigh-in has a real log."
      >
        <WeightBudgetRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Weight budget" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? <p className="app-muted" role="status">{message}</p> : null}
      {staleCue ? <p className="app-muted" role="status">{staleCue}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Total weight" value={s.totalLbs} unit="lb" />
        <StatTile label="Limit" value={s.limitLbs} unit="lb" />
        <StatTile label="Remaining" value={s.remainingLbs} unit="lb" />
        <StatTile label="Used" value={s.percentUsed} unit="%" />
        <StatTile label="Scale (weigh-in)" value={closeBlank ? "" : close.loggedLbs} unit={closeBlank ? undefined : "lb"} />
        <StatTile
          label="Planned vs scale"
          value={closeBlank || close.deltaLbs == null ? "" : `${close.deltaLbs > 0 ? "+" : ""}${close.deltaLbs}`}
          unit={closeBlank || close.deltaLbs == null ? undefined : "lb"}
        />
      </div>

      <Panel aria-label="Planned vs weigh-in">
        <h2>Planned vs weigh-in</h2>
        {closeBlank ? (
          <>
            <p>
              <strong>Planned {close.plannedLbs} lb</strong>
            </p>
            <p className="app-muted">{NO_WEIGH_IN_CLOSE_CUE}</p>
            <Button as="a" variant="secondary" href={weighInHref}>Log a weigh-in</Button>
          </>
        ) : (
          <>
            <p>
              <strong>Planned {close.plannedLbs} lb · Scale {close.loggedLbs} lb</strong>
            </p>
            <p className="app-muted">
              {close.deltaLbs == null
                ? ""
                : close.deltaLbs === 0
                  ? `On plan as of ${close.loggedOn}.`
                  : `${close.deltaLbs > 0 ? "+" : ""}${close.deltaLbs} lb vs plan as of ${close.loggedOn}.`}
            </p>
            <Button as="a" variant="secondary" href={weighInHref}>Open weigh-in</Button>
          </>
        )}
      </Panel>

      {s.overLimit ? (
        <Panel>
          <h2>Over the weight limit</h2>
          <p>
            {s.totalLbs} lb exceeds the {s.limitLbs} lb limit by {Math.abs(s.remainingLbs)} lb. Cut weight before inspection.
          </p>
        </Panel>
      ) : null}

      <Panel as="form" id="weight-add" onSubmit={addComponent}>
        <h2>Add a component</h2>
        <FormGrid min={160}>
          <FormRow label="Name">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Swerve module" />
          </FormRow>
          <FormRow label="Subsystem">
            <input value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })} placeholder="Drivetrain" />
          </FormRow>
          <FormRow label="Weight each (lb)">
            <input required type="number" min="0" step="0.01" value={form.weightLbs} onChange={(e) => setForm({ ...form, weightLbs: e.target.value })} />
          </FormRow>
          <FormRow label="Quantity">
            <input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes">
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        <Button variant="primary" type="submit">Add component</Button>
      </Panel>

      <Panel>
        <h2>By subsystem</h2>
        {s.bySubsystem.length === 0 ? (
          <p className="app-muted">No components logged yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
            {s.bySubsystem.map((b) => (
              <li key={b.subsystem}>
                <strong>{b.subsystem}</strong>
                <span className="app-muted"> {b.lbs} lb · {s.totalLbs > 0 ? Math.round((b.lbs / s.totalLbs) * 100) : 0}% of robot</span>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void post({ action: "set_limit", seasonYear, limitLbs: limitDraft }, "Limit updated.");
          }}
        >
          <FormRow label="Weight limit (lb)">
            <input type="number" min="0" step="0.1" value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} />
          </FormRow>
          <Button variant="primary" type="submit">Set limit</Button>
        </form>
      </Panel>

      <Panel>
        <h2>Components</h2>
        {view.components.length === 0 ? (
          <p className="app-muted">No components yet — log your heavy items first (drivetrain, battery mount, superstructure).</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.components.map((c) => (
              <li key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>{c.name}{c.quantity > 1 ? ` ×${c.quantity}` : ""} · {(c.weightLbs * c.quantity).toFixed(2)} lb</strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {c.weightLbs} lb each{c.subsystem ? ` · ${c.subsystem}` : ""}{c.notes ? ` · ${c.notes}` : ""}
                  </small>
                </div>
                {view.context.role !== "viewer" ? (
                  <Button type="button" size="sm" variant="danger" onClick={() => void post({ action: "delete_component", id: c.id }, "Component removed.")}>
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WeightBudgetNextActions orgId={view.context.orgId} />
    </main>
  );
}
