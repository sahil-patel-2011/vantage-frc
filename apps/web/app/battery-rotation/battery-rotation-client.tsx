"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { batteryStatusLabel, irTrendLabel } from "../../lib/battery-rotation";
import {
  BATTERY_STATUSES,
  type BatteryRotationView,
} from "../../lib/battery-rotation/compute-battery-rotation";
import type { BatteryStatus } from "../../lib/battery-rotation/types";
import {
  BATTERY_ROTATION_RELATED_INCLUDE,
  batteryRotationNextActions,
  batteryRotationRelatedLinks,
  batteryRotationSetupSteps,
  batteryRotationShellCopy,
  classifyBatteryRotationShell,
  formatBatteryRotationMetric,
  formatBatteryRotationPlanReadiness,
  shouldShowBatteryRotationSummaryTiles,
  type BatteryRotationNextAction,
  type BatteryRotationShellKind,
} from "../../lib/battery-rotation/battery-rotation-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

function statusTone(status: BatteryStatus): string {
  if (status === "short_pack") return "demo";
  if (status === "retired") return "";
  if (status === "active") return "good";
  return "setup";
}

type LiveView = Extract<BatteryRotationView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function BatteryRotationRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = batteryRotationRelatedLinks(orgId, {
    include: [...BATTERY_ROTATION_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related battery-rotation-related" aria-label="Related battery tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function BatteryRotationNextActionsPanel({ actions }: { actions: BatteryRotationNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions battery-rotation-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">
          Batteries, Health Forecast, and Pit — never DEMO IR or charge metrics.
        </p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BatteryRotationShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: BatteryRotationShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = batteryRotationNextActions({ orgId, shell });
  const copy = batteryRotationShellCopy(shell);
  const competitionHref = withOrgHref("/competition", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const forecastHref = hubHref("/build", "battery-health-forecast", orgId);
  const pitHref = withOrgHref("/pit", orgId);

  return (
    <main className="module-page battery-rotation-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Battery rotation"}
          </>
        }
        title="Battery rotation & charge planner"
        description={description}
      >
        <BatteryRotationRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No batteries yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={batteriesHref}>
              Open Batteries
            </a>
            <a className="app-button secondary" href={forecastHref}>
              Open Health Forecast
            </a>
            <a className="app-button secondary" href={pitHref}>
              Open Pit command
            </a>
          </>
        ) : null}
      </EmptyState>
      <BatteryRotationNextActionsPanel actions={actions} />
    </main>
  );
}

export default function BatteryRotationClient() {
  const [view, setView] = useState<BatteryRotationView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/battery-rotation${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BatteryRotationView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const batteryCount = view?.status === "live" ? view.batteries.length : 0;
  const summary = view?.status === "live" ? view.summary : null;

  const shell = classifyBatteryRotationShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    batteryCount,
  });
  const shellCopy = batteryRotationShellCopy(shell);
  const nextActions = batteryRotationNextActions({
    orgId,
    shell,
    batteryCount,
    shortPackCount: summary?.shortPackCount ?? 0,
    chargeShortfallCount: summary?.chargeShortfallCount ?? 0,
    upcomingAssignments: summary?.upcomingAssignments ?? 0,
  });
  const relatedLinks = batteryRotationRelatedLinks(orgId, {
    include: [...BATTERY_ROTATION_RELATED_INCLUDE],
  });
  const competitionHref = withOrgHref("/competition", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const forecastHref = hubHref("/build", "battery-health-forecast", orgId);
  const pitHref = withOrgHref("/pit", orgId);
  const setupSteps = batteryRotationSetupSteps(orgId);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/battery-rotation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as BatteryRotationView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <BatteryRotationShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <BatteryRotationShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={load}
      />
    );
  }

  if (shell === "setup") {
    return (
      <BatteryRotationShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {(view?.status === "setup_required" ? view.steps : setupSteps).length > 0 ? (
          <ol className="strategy-setup-steps">
            {(view?.status === "setup_required" ? view.steps : setupSteps).map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </BatteryRotationShell>
    );
  }

  if (view?.status !== "live") {
    return <BatteryRotationShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page battery-rotation-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Battery rotation"}
          </>
        }
        title="Battery rotation & charge planner"
        description="Schedule which pack runs which match from internal-resistance trends vs. match cadence and charge time — never DEMO IR or charge metrics."
      >
        <div className="battery-rotation-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <BatteryRotationNextActionsPanel actions={nextActions} />

      {shouldShowBatteryRotationSummaryTiles(batteryCount) ? <SummaryPanel view={view} /> : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No batteries yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={batteriesHref}>
            Open Batteries
          </a>
          <a className="app-button secondary" href={forecastHref}>
            Open Health Forecast
          </a>
          <a className="app-button secondary" href={pitHref}>
            Open Pit command
          </a>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <AddBatteryForm busy={busy} mutate={mutate} />
        {shell === "ready" ? <FleetHealth view={view} busy={busy} mutate={mutate} /> : null}
        <LogReadingForm view={view} busy={busy} mutate={mutate} />
        {shell === "ready" ? (
          <>
            <ScheduleAssignmentForm view={view} busy={busy} mutate={mutate} />
            <RotationSchedule view={view} busy={busy} mutate={mutate} />
          </>
        ) : null}
        <Panel aria-label="Battery rotation tip">
          <span className="eyebrow">Fleet path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Log IR on <a href={batteriesHref}>Batteries</a>, project retirement in{" "}
            <a href={forecastHref}>Health Forecast</a>, and check event-day rack status in{" "}
            <a href={pitHref}>Pit command</a> — never invent DEMO resistance or charge plans.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Batteries", value: formatBatteryRotationMetric(summary.totalBatteries, true) },
    {
      label: "Active/charging",
      value: formatBatteryRotationMetric(summary.activeBatteries, true),
    },
    {
      label: "Short-pack alerts",
      value: formatBatteryRotationMetric(summary.shortPackCount, true),
    },
    {
      label: "Upcoming assignments",
      value: formatBatteryRotationMetric(summary.upcomingAssignments, true),
    },
    {
      label: "Charge shortfalls",
      value: formatBatteryRotationMetric(summary.chargeShortfallCount, true),
    },
    {
      label: "Plan readiness",
      value: formatBatteryRotationPlanReadiness(
        summary.planReadiness,
        true,
        summary.totalBatteries,
      ),
    },
  ];
  return (
    <section className="battery-rotation-stats" aria-label="Real battery rotation counts">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {summary.shortPackCount > 0 ? (
        <p className="app-muted" style={{ marginTop: 12 }} role="alert">
          {summary.shortPackCount} pack(s) are flagged short from logged IR — retire or bench them
          before elimination matches.
        </p>
      ) : null}
    </section>
  );
}

function FleetHealth({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  return (
    <Panel id="br-fleet">
      <h2 style={{ marginTop: 0 }}>Fleet health</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10, margin: 0 }}>
        {view.batteries.map((battery) => (
          <li
            key={battery.batteryId}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{battery.label}</strong>{" "}
              <span className={`app-badge ${statusTone(battery.status)}`}>
                {batteryStatusLabel(battery.status)}
              </span>
              {battery.shortPackAlert ? <span className="app-badge demo">Short pack</span> : null}
              <small className="app-muted" style={{ display: "block" }}>
                {battery.readingsCount === 0
                  ? "No IR readings logged yet"
                  : `Latest IR ${battery.latestIrMohm} mΩ · avg ${battery.averageIrMohm} mΩ · trend ${irTrendLabel(battery.trend)}`}
              </small>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={battery.status}
                disabled={busy}
                onChange={(event) =>
                  mutate({
                    action: "update-status",
                    batteryId: battery.batteryId,
                    status: event.target.value,
                  })
                }
              >
                {BATTERY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {batteryStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove "${battery.label}" from rotation tracking?`)) {
                    mutate({ action: "delete-battery", batteryId: battery.batteryId });
                  }
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddBatteryForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(() => ({ label: "", serialNumber: "", purchasedOn: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="br-add-battery"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.label.trim()) return;
        mutate({
          action: "add-battery",
          label: form.label,
          serialNumber: form.serialNumber || undefined,
          purchasedOn: form.purchasedOn || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add battery</h2>
      <FormGrid min={160}>
        <FormRow label="Label">
          <input value={form.label} onChange={set("label")} placeholder="Battery 7" required />
        </FormRow>
        <FormRow label="Serial (optional)">
          <input value={form.serialNumber} onChange={set("serialNumber")} />
        </FormRow>
        <FormRow label="Purchased (optional)">
          <input type="date" value={form.purchasedOn} onChange={set("purchasedOn")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.label.trim()}>
          Add battery
        </button>
      </div>
    </Panel>
  );
}

function LogReadingForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  const empty = useMemo(
    () => ({ batteryId: "", internalResistanceMohm: "", voltage: "", cycleCount: "", notes: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (view.batteries.length === 0) {
    return (
      <EmptyState
        soft
        badge="No batteries yet"
        badgeTone="setup"
        title="Add a battery first"
        description="Log an internal-resistance reading once at least one real pack is tracked — never DEMO IR values."
      />
    );
  }

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.batteryId || !form.internalResistanceMohm) return;
        mutate({
          action: "log-reading",
          batteryId: form.batteryId,
          internalResistanceMohm: Number(form.internalResistanceMohm),
          voltage: form.voltage || undefined,
          cycleCount: form.cycleCount || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log IR reading</h2>
      <FormGrid min={160}>
        <FormRow label="Battery">
          <select value={form.batteryId} onChange={set("batteryId")} required>
            <option value="">Select…</option>
            {view.batteries.map((b) => (
              <option key={b.batteryId} value={b.batteryId}>
                {b.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Internal resistance (mΩ)">
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.internalResistanceMohm}
            onChange={set("internalResistanceMohm")}
            required
          />
        </FormRow>
        <FormRow label="Voltage (optional)">
          <input type="number" min={0} step="0.01" value={form.voltage} onChange={set("voltage")} />
        </FormRow>
        <FormRow label="Cycle count (optional)">
          <input type="number" min={0} value={form.cycleCount} onChange={set("cycleCount")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.batteryId || !form.internalResistanceMohm}
        >
          Log reading
        </button>
      </div>
    </Panel>
  );
}

function ScheduleAssignmentForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  const empty = useMemo(
    () => ({ batteryId: "", matchLabel: "", scheduledAt: "", chargeMinutesAvailable: "", notes: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (view.batteries.length === 0) return null;

  return (
    <Panel
      id="br-schedule-form"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.batteryId || !form.matchLabel.trim() || !form.scheduledAt) return;
        mutate({
          action: "schedule-assignment",
          batteryId: form.batteryId,
          matchLabel: form.matchLabel,
          scheduledAt: form.scheduledAt,
          chargeMinutesAvailable: Number(form.chargeMinutesAvailable) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Schedule match assignment</h2>
      <FormGrid min={160}>
        <FormRow label="Battery">
          <select value={form.batteryId} onChange={set("batteryId")} required>
            <option value="">Select…</option>
            {view.batteries.map((b) => (
              <option key={b.batteryId} value={b.batteryId}>
                {b.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Match">
          <input value={form.matchLabel} onChange={set("matchLabel")} placeholder="Qual 24" required />
        </FormRow>
        <FormRow label="Scheduled at">
          <input type="datetime-local" value={form.scheduledAt} onChange={set("scheduledAt")} required />
        </FormRow>
        <FormRow label="Charge minutes available" hint={`Recommend ≥90 for a full charge`}>
          <input
            type="number"
            min={0}
            value={form.chargeMinutesAvailable}
            onChange={set("chargeMinutesAvailable")}
          />
        </FormRow>
      </FormGrid>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.batteryId || !form.matchLabel.trim() || !form.scheduledAt}
        >
          Schedule
        </button>
      </div>
    </Panel>
  );
}

function RotationSchedule({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  if (view.slots.length === 0) {
    return (
      <EmptyState
        soft
        badge="No assignments yet"
        badgeTone="setup"
        title="Schedule your first battery-to-match assignment"
        description="Assignments show rotation order with charge-time and short-pack warnings from real logs — never DEMO schedules."
      />
    );
  }
  return (
    <Panel id="br-schedule">
      <h2 style={{ marginTop: 0 }}>Rotation schedule</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10, margin: 0 }}>
        {view.slots.map((slot) => (
          <li
            key={slot.assignmentId}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{slot.matchLabel}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {new Date(slot.scheduledAt).toLocaleString()} · {slot.batteryLabel} ·{" "}
                {slot.chargeMinutesAvailable} min charge window
              </small>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {slot.batteryAlert ? <span className="app-badge demo">Short pack</span> : null}
                {!slot.chargeSufficient ? (
                  <span className="app-badge setup">Charge shortfall</span>
                ) : null}
                <small className="app-muted">Trend: {irTrendLabel(slot.batteryTrend)}</small>
              </div>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove the assignment for "${slot.matchLabel}"?`)) {
                  mutate({ action: "delete-assignment", assignmentId: slot.assignmentId });
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
