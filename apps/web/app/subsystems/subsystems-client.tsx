"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  MOTORS,
  SUBSYSTEM_CATEGORIES,
  computeFreeSpeedFps,
  motorFreeRpm,
  motorLabel,
  type SubsystemCategory,
} from "../../lib/subsystems";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Subsystem = {
  id: string;
  name: string;
  category: SubsystemCategory;
  motorType: string;
  motorCount: number | null;
  gearReduction: number | null;
  wheelDiameterIn: number | null;
  notes: string;
  byName: string | null;
  freeSpeedFps: number | null;
};

type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; subsystems: Subsystem[] };

const EMPTY = {
  name: "",
  category: "drivetrain" as SubsystemCategory,
  motorType: "neo",
  motorCount: "",
  gearReduction: "",
  wheelDiameterIn: "",
  notes: "",
};

function isSubsystemsView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function subsystemsCacheOrg(data: View, orgHint: string): string {
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

async function persistSubsystemsSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = subsystemsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("subsystems", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("subsystems", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Subsystem specs already painted; IndexedDB is best-effort.
  }
}

function SubsystemsRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "wiring-map", orgId)}>
        CAN-bus map
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "cad", orgId)}>
        CAD
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "power-budget", orgId)}>
        Power budget
      </Button>
    </nav>
  );
}

function SubsystemsNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "save",
      label: "Save a subsystem",
      detail: "Name the motors and reduction so the next person does not re-derive them from CAD.",
      href: "#subsystem-spec",
      primary: true,
    },
    {
      id: "wiring",
      label: "Open CAN-bus map",
      detail: "Each mechanism here should match a device on the wiring map.",
      href: hubHref("/build", "wiring-map", orgId),
      primary: false,
    },
    {
      id: "power",
      label: "Open Power budget",
      detail: "Typical and peak amps for these motors live on the budget.",
      href: hubHref("/build", "power-budget", orgId),
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

export default function SubsystemsClient({ orgId }: { orgId: string | null }) {
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
      const cached = await getFeatureSnapshot<View>("subsystems", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isSubsystemsView(cached.data)) {
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
        `/api/subsystems?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
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
      if (!response.ok || !isSubsystemsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Subsystem specs. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load subsystems",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistSubsystemsSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Subsystem specs. Showing the last copy on this device.");
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
    const response = await fetch("/api/subsystems", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addSubsystem(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_subsystem", seasonYear, ...form }, "Subsystem saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  const robotHref = hubWorkbenchHref("build", "subsystems", orgId);

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
              {" / Subsystem specs"}
            </>
          }
          title="Subsystem specs"
          description="Motors, reduction, and wheel size for each mechanism."
        >
          <SubsystemsRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Subsystem specs" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading subsystems…"}
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
                {" / Subsystem specs"}
              </>
            }
            title="Subsystem specs"
            description="Motors, reduction, and wheel size for each mechanism."
          >
            <SubsystemsRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Subsystem specs" fromCache={fromCache} cachedAt={cachedAt} />
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

  const previewFps = computeFreeSpeedFps(
    motorFreeRpm(form.motorType),
    Number(form.gearReduction) || null,
    Number(form.wheelDiameterIn) || null,
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / Subsystem specs"}
          </>
        }
        title={`Subsystem specs — ${seasonYear}`}
        description="Free speed is theoretical. Real speed runs slower under load."
      >
        <SubsystemsRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Subsystem specs" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <Panel as="form" id="subsystem-spec" onSubmit={addSubsystem}>
        <h2>Add a subsystem</h2>
        <FormGrid min={160}>
          <FormRow label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Swerve drivetrain"
            />
          </FormRow>
          <FormRow label="Category">
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as SubsystemCategory })}
            >
              {SUBSYSTEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Motor">
            <select value={form.motorType} onChange={(e) => setForm({ ...form, motorType: e.target.value })}>
              <option value="">—</option>
              {MOTORS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Motor count">
            <input
              type="number"
              min="0"
              value={form.motorCount}
              onChange={(e) => setForm({ ...form, motorCount: e.target.value })}
            />
          </FormRow>
          <FormRow label="Gear reduction (X:1)">
            <input
              type="number"
              min="0"
              step="0.001"
              value={form.gearReduction}
              onChange={(e) => setForm({ ...form, gearReduction: e.target.value })}
              placeholder="6.75"
            />
          </FormRow>
          <FormRow label="Wheel dia. (in)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={form.wheelDiameterIn}
              onChange={(e) => setForm({ ...form, wheelDiameterIn: e.target.value })}
              placeholder="4"
            />
          </FormRow>
        </FormGrid>
        {previewFps != null ? (
          <p className="app-muted" role="status">
            Theoretical free speed: {previewFps} ft/s
          </p>
        ) : null}
        <FormRow label="Notes" wide>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        <Button variant="primary" type="submit">
          Save subsystem
        </Button>
      </Panel>

      <Panel>
        <h2>Free-speed calculator</h2>
        <p className="app-muted">
          Pick a motor, gear reduction, and wheel diameter and this computes theoretical free speed (ft/s) — the
          number you check on every drivetrain design iteration. Actual speed runs ~10-20% lower under load.
        </p>
      </Panel>

      <Panel>
        <h2>Subsystems</h2>
        {view.subsystems.length === 0 ? (
          <p className="app-muted">No subsystems yet — start with your drivetrain.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.subsystems.map((s) => (
              <li key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {s.name} · {s.category}
                    {s.freeSpeedFps != null ? ` · ${s.freeSpeedFps} ft/s` : ""}
                  </strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {s.motorCount != null && s.motorType
                      ? `${s.motorCount}× ${motorLabel(s.motorType)}`
                      : s.motorType
                        ? motorLabel(s.motorType)
                        : "no motor set"}
                    {s.gearReduction != null ? ` · ${s.gearReduction}:1` : ""}
                    {s.wheelDiameterIn != null ? ` · ${s.wheelDiameterIn}in wheel` : ""}
                    {s.notes ? ` · ${s.notes}` : ""}
                  </small>
                </div>
                {view.context.role !== "viewer" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void post({ action: "delete_subsystem", id: s.id }, "Subsystem removed.")}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SubsystemsNextActions orgId={view.context.orgId} />
    </main>
  );
}
