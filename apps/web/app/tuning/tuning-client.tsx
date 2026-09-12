"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  TUNING_CATEGORIES,
  TUNING_CATEGORY_LABEL,
  currentLimitTuningCue,
  type TuningCategory,
} from "../../lib/tuning";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Constant = {
  id: string;
  subsystem: string;
  name: string;
  value: string;
  unit: string;
  category: TuningCategory;
  notes: string;
  byName: string | null;
  updatedAt: string;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      constants: Constant[];
      summary: { total: number; subsystems: number; byCategory: Record<TuningCategory, number> };
    };

const EMPTY = {
  subsystem: "",
  name: "",
  value: "",
  unit: "",
  category: "encoder_offset" as TuningCategory,
  notes: "",
};

function isTuningView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function tuningCacheOrg(data: View, orgHint: string): string {
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

async function persistTuningSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = tuningCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("tuning", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("tuning", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Tuning log already painted; IndexedDB is best-effort.
  }
}

function TuningRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "subsystems", orgId)}>
        Subsystem specs
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "shooter-table", orgId)}>
        Shooter table
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "code", orgId)}>
        Code
      </Button>
    </nav>
  );
}

function TuningNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "save",
      label: "Record a constant",
      detail: "Offsets and gains that hurt to lose belong here, not on a lost laptop.",
      href: "#tuning-constant",
      primary: true,
    },
    {
      id: "subsystems",
      label: "Open Subsystem specs",
      detail: "Name the mechanism this constant belongs to.",
      href: hubHref("/build", "subsystems", orgId),
      primary: false,
    },
    {
      id: "shooter",
      label: "Open Shooter table",
      detail: "Distance lookup is a different page from these constants.",
      href: hubHref("/build", "shooter-table", orgId),
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

export default function TuningClient({ orgId }: { orgId: string | null }) {
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
      const cached = await getFeatureSnapshot<View>("tuning", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isTuningView(cached.data)) {
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
      const response = await fetch(`/api/tuning?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`, {
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
      if (!response.ok || !isTuningView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Tuning log. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load tuning constants",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistTuningSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Tuning log. Showing the last copy on this device.");
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
    const response = await fetch("/api/tuning", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function saveConstant(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "save_constant", seasonYear, ...form }, "Constant saved.");
    if (view?.status === "ready") setForm({ ...EMPTY, subsystem: form.subsystem, category: form.category });
  }

  const robotHref = hubWorkbenchHref("build", "tuning-log", orgId);

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
              {" / Tuning log"}
            </>
          }
          title="Tuning log"
          description="Offsets, gains, and zeros that a reflash should not wipe."
        >
          <TuningRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Tuning log" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading tuning constants…"}
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
                {" / Tuning log"}
              </>
            }
            title="Tuning log"
            description="Offsets, gains, and zeros that a reflash should not wipe."
          >
            <TuningRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Tuning log" fromCache={fromCache} cachedAt={cachedAt} />
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

  const subsystems = [...new Set(view.constants.map((c) => c.subsystem || "General"))].sort();
  const currentLimitCue = currentLimitTuningCue(view.constants);

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Tuning log"}
          </>
        }
        title={`Tuning log — ${seasonYear}`}
        description="Saving the same subsystem and name again updates that constant in place."
      >
        <TuningRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Tuning log" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}
      {currentLimitCue ? (
        <p className="app-muted" role="status">
          {currentLimitCue}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Constants logged" value={view.summary.total} />
        <StatTile label="Subsystems" value={view.summary.subsystems} />
        <StatTile label="Encoder offsets" value={view.summary.byCategory.encoder_offset} />
        <StatTile label="Gain sets" value={view.summary.byCategory.pid} />
      </div>

      <Panel as="form" id="tuning-constant" onSubmit={saveConstant}>
        <h2>Record a constant</h2>
        <FormGrid min={160}>
          <FormRow label="Subsystem">
            <input
              value={form.subsystem}
              onChange={(e) => setForm({ ...form, subsystem: e.target.value })}
              placeholder="Swerve"
            />
          </FormRow>
          <FormRow label="Category">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as TuningCategory })}
            >
              {TUNING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TUNING_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="FL module offset"
            />
          </FormRow>
          <FormRow label="Value">
            <input
              required
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="0.373"
            />
          </FormRow>
          <FormRow label="Unit">
            <input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="rad"
            />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes" wide>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        <p className="app-muted">Keep notes for context like “measured after gearbox swap.”</p>
        <Button variant="primary" type="submit">
          Save constant
        </Button>
      </Panel>

      {subsystems.map((sub) => (
        <Panel key={sub}>
          <h2>{sub}</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.constants
              .filter((c) => (c.subsystem || "General") === sub)
              .map((c) => (
                <li key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong>
                      {c.name} = {c.value}
                      {c.unit ? ` ${c.unit}` : ""}
                    </strong>
                    <small className="app-muted" style={{ display: "block" }}>
                      {TUNING_CATEGORY_LABEL[c.category]}
                      {c.notes ? ` · ${c.notes}` : ""}
                      {c.byName ? ` · ${c.byName}` : ""}
                    </small>
                  </div>
                  {view.context.role !== "viewer" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => void post({ action: "delete_constant", id: c.id }, "Constant removed.")}
                    >
                      Delete
                    </Button>
                  ) : null}
                </li>
              ))}
          </ul>
        </Panel>
      ))}

      {view.constants.length === 0 ? (
        <Panel>
          <p className="app-muted">No constants logged yet — start with your swerve module offsets.</p>
        </Panel>
      ) : null}

      <TuningNextActions orgId={view.context.orgId} />
    </main>
  );
}
