"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  CAN_BUSES,
  DEVICE_TYPES,
  deviceTypeLabel,
  deviceUsesCan,
  type CanBus,
  type WiringConflict,
} from "../../lib/wiring";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Device = {
  id: string;
  name: string;
  deviceType: string;
  canId: number | null;
  canBus: CanBus;
  pdhPort: number | null;
  breakerAmp: number | null;
  subsystem: string;
  notes: string;
  byName: string | null;
};

type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      devices: Device[];
      summary: {
        totalDevices: number;
        canDevices: number;
        conflicts: WiringConflict[];
        conflictCount: number;
        pcmPhCanCues?: string[];
        servoHubCues?: string[];
        servoPowerCues?: string[];
      };
    };

const EMPTY = {
  name: "",
  deviceType: "talonfx",
  canId: "",
  canBus: "rio" as CanBus,
  pdhPort: "",
  breakerAmp: "",
  subsystem: "",
  notes: "",
};

function isWiringView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function wiringCacheOrg(data: View, orgHint: string): string {
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

async function persistWiringSnapshot(orgHint: string, seasonHint: string, data: View): Promise<void> {
  const cacheOrg = wiringCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("wiring", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("wiring", "_", data, seasonHint || seasonKey);
  } catch {
    // Live CAN-bus map already painted; IndexedDB is best-effort.
  }
}

function conflictText(conflict: WiringConflict): string {
  switch (conflict.kind) {
    case "can_id":
      return `Duplicate CAN ID ${conflict.canId} on ${conflict.canBus} (${deviceTypeLabel(conflict.deviceType)}): ${conflict.deviceNames.join(", ")}`;
    case "power_port":
      return `Two devices on power port ${conflict.port}: ${conflict.deviceNames.join(", ")}`;
    default: {
      conflict satisfies never;
      return "";
    }
  }
}

function WiringRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={withOrgHref("/inventory", orgId)}>
        Inventory
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "batteries", orgId)}>
        Batteries
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "power-budget", orgId)}>
        Power budget
      </Button>
    </nav>
  );
}

function WiringNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add a device",
      detail: "Name the controller, CAN ID, and power port before you power on.",
      href: "#wiring-device",
      primary: true,
    },
    {
      id: "power",
      label: "Open Power budget",
      detail: "Breaker amps on this map should match the load on the budget.",
      href: hubHref("/build", "power-budget", orgId),
      primary: false,
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "A mapped robot still needs a healthy pack.",
      href: hubHref("/build", "batteries", orgId),
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

export default function WiringClient({ orgId }: { orgId: string | null }) {
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
      const cached = await getFeatureSnapshot<View>("wiring", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isWiringView(cached.data)) {
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
      const response = await fetch(`/api/wiring?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`, {
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
      if (!response.ok || !isWiringView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh CAN-bus map. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load wiring map",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistWiringSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh CAN-bus map. Showing the last copy on this device.");
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
    const response = await fetch("/api/wiring", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function addDevice(event: React.FormEvent) {
    event.preventDefault();
    await post({ action: "create_device", seasonYear, ...form }, "Device added.");
    if (view?.status === "ready") {
      setForm({ ...EMPTY, deviceType: form.deviceType, canBus: form.canBus, subsystem: form.subsystem });
    }
  }

  const robotHref = hubWorkbenchHref("build", "wiring-map", orgId);

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
              {" / CAN-bus map"}
            </>
          }
          title="CAN-bus map"
          description="Controllers, CAN IDs, and power ports — conflicts before you power on."
        >
          <WiringRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="CAN-bus map" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening CAN-bus map"}
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
                {" / CAN-bus map"}
              </>
            }
            title="CAN-bus map"
            description="Controllers, CAN IDs, and power ports — conflicts before you power on."
          >
            <WiringRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="CAN-bus map" fromCache={fromCache} cachedAt={cachedAt} />
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

  const canForm = deviceUsesCan(form.deviceType);
  const canDevices = view.devices.filter((d) => d.canId != null);

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={robotHref}>Build</a>
            {" / CAN-bus map"}
          </>
        }
        title={`CAN-bus map — ${seasonYear}`}
        description="Each same-type device needs a unique CAN ID per bus."
      >
        <WiringRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="CAN-bus map" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Devices mapped" value={view.summary.totalDevices} />
        <StatTile label="On the CAN bus" value={view.summary.canDevices} />
        <StatTile label="Conflicts" value={view.summary.conflictCount} />
      </div>

      {view.summary.conflicts.length > 0 ? (
        <Panel>
          <h2>Wiring conflicts — fix before powering on</h2>
          {view.summary.conflicts.map((c, i) => (
            <p key={i}>{conflictText(c)}</p>
          ))}
        </Panel>
      ) : null}

      {(view.summary.pcmPhCanCues ?? []).length > 0 ? (
        <Panel>
          <h2>PCM / PH CAN</h2>
          {(view.summary.pcmPhCanCues ?? []).map((cue) => (
            <p key={cue}>{cue}</p>
          ))}
        </Panel>
      ) : null}

      {(view.summary.servoHubCues ?? []).length > 0 ? (
        <Panel>
          <h2>Servo hub</h2>
          {(view.summary.servoHubCues ?? []).map((cue) => (
            <p key={cue}>{cue}</p>
          ))}
        </Panel>
      ) : null}

      {(view.summary.servoPowerCues ?? []).length > 0 ? (
        <Panel>
          <h2>Servo power (R506)</h2>
          {(view.summary.servoPowerCues ?? []).map((cue) => (
            <p key={cue}>{cue}</p>
          ))}
        </Panel>
      ) : null}

      <Panel as="form" id="wiring-device" onSubmit={addDevice}>
        <h2>Add a device</h2>
        <FormGrid min={160}>
          <FormRow label="Name">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Front Left Drive"
            />
          </FormRow>
          <FormRow label="Type">
            <select value={form.deviceType} onChange={(e) => setForm({ ...form, deviceType: e.target.value })}>
              {DEVICE_TYPES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </FormRow>
          {canForm ? (
            <>
              <FormRow label="CAN ID">
                <input
                  type="number"
                  min="0"
                  max="62"
                  value={form.canId}
                  onChange={(e) => setForm({ ...form, canId: e.target.value })}
                />
              </FormRow>
              <FormRow label="CAN bus">
                <select
                  value={form.canBus}
                  onChange={(e) => setForm({ ...form, canBus: e.target.value as CanBus })}
                >
                  {CAN_BUSES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </FormRow>
            </>
          ) : null}
          <FormRow label="Power port">
            <input
              type="number"
              min="0"
              max="23"
              value={form.pdhPort}
              onChange={(e) => setForm({ ...form, pdhPort: e.target.value })}
            />
          </FormRow>
          <FormRow label="Breaker (A)">
            <input
              type="number"
              min="0"
              max="60"
              value={form.breakerAmp}
              onChange={(e) => setForm({ ...form, breakerAmp: e.target.value })}
            />
          </FormRow>
          <FormRow label="Subsystem">
            <input
              value={form.subsystem}
              onChange={(e) => setForm({ ...form, subsystem: e.target.value })}
              placeholder="Drivetrain"
            />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes" wide>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </FormRow>
        <Button variant="primary" type="submit">
          Add device
        </Button>
      </Panel>

      <Panel>
        <h2>CAN ID map</h2>
        <p className="app-muted">Each same-type device needs a unique CAN ID per bus.</p>
        {canDevices.length === 0 ? (
          <p className="app-muted">No CAN devices yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {canDevices.map((d) => (
              <li key={d.id}>
                <strong>
                  [{d.canBus} · {d.canId}] {d.name}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {deviceTypeLabel(d.deviceType)}
                  {d.subsystem ? ` · ${d.subsystem}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2>All devices</h2>
        {view.devices.length === 0 ? (
          <p className="app-muted">No devices mapped yet — add your motor controllers, sensors, and power devices.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
            {view.devices.map((d) => (
              <li key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>
                    {d.name} · {deviceTypeLabel(d.deviceType)}
                  </strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {d.canId != null ? `CAN ${d.canBus}:${d.canId}` : "no CAN"}
                    {d.pdhPort != null ? ` · port ${d.pdhPort}` : ""}
                    {d.breakerAmp != null ? ` · ${d.breakerAmp}A` : ""}
                    {d.subsystem ? ` · ${d.subsystem}` : ""}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </small>
                </div>
                {view.context.role !== "viewer" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void post({ action: "delete_device", id: d.id }, "Device removed.")}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <WiringNextActions orgId={view.context.orgId} />
    </main>
  );
}
