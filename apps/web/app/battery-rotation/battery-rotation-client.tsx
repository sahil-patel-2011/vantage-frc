"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { batteryStatusLabel, irTrendLabel } from "../../lib/battery-rotation";
import {
  BATTERY_STATUSES,
  type BatteryRotationView,
} from "../../lib/battery-rotation/compute-battery-rotation";
import type { BatteryStatus } from "../../lib/battery-rotation/types";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusTone(status: BatteryStatus): string {
  if (status === "short_pack") return "demo";
  if (status === "retired") return "";
  if (status === "active") return "good";
  return "setup";
}

type LiveView = Extract<BatteryRotationView, { status: "live" }>;

export default function BatteryRotationClient() {
  const [view, setView] = useState<BatteryRotationView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/battery-rotation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as BatteryRotationView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
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
            {" / Battery Rotation"}
          </>
        }
        title="Battery rotation & charge planner"
        description="Schedule which pack runs which match from internal-resistance trends vs. match cadence and charge time — with short-pack alerts."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load battery rotation"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryPanel view={view} />
          <AddBatteryForm busy={busy} mutate={mutate} />
          {view.batteries.length > 0 ? <FleetHealth view={view} busy={busy} mutate={mutate} /> : null}
          <LogReadingForm view={view} busy={busy} mutate={mutate} />
          <ScheduleAssignmentForm view={view} busy={busy} mutate={mutate} />
          <RotationSchedule view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Batteries", value: String(summary.totalBatteries) },
    { label: "Active/charging", value: String(summary.activeBatteries) },
    { label: "Short-pack alerts", value: String(summary.shortPackCount) },
    { label: "Upcoming assignments", value: String(summary.upcomingAssignments) },
    { label: "Charge shortfalls", value: String(summary.chargeShortfallCount) },
    { label: "Plan readiness", value: pct(summary.planReadiness) },
  ];
  return (
    <Panel>
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
          {summary.shortPackCount} pack(s) are flagged short — retire or bench them before elimination matches.
        </p>
      ) : null}
    </Panel>
  );
}

function FleetHealth({
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
      <h2 style={{ marginTop: 0 }}>Fleet health</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.batteries.map((battery) => (
          <li
            key={battery.batteryId}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{battery.label}</strong>{" "}
              <span className={`app-badge ${statusTone(battery.status)}`}>{batteryStatusLabel(battery.status)}</span>
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
                  mutate({ action: "update-status", batteryId: battery.batteryId, status: event.target.value })
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

function AddBatteryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ label: "", serialNumber: "", purchasedOn: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
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
  mutate: (payload: Record<string, unknown>) => void;
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
        badge="No batteries yet"
        badgeTone="setup"
        title="Add a battery first"
        description="Log an internal-resistance reading once at least one pack is tracked."
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
  mutate: (payload: Record<string, unknown>) => void;
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
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.slots.length === 0) {
    return (
      <EmptyState
        badge="No assignments yet"
        badgeTone="setup"
        title="Schedule your first battery-to-match assignment"
        description="Assignments show the rotation order with charge-time and short-pack warnings."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Rotation schedule</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.slots.map((slot) => (
          <li
            key={slot.assignmentId}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{slot.matchLabel}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {new Date(slot.scheduledAt).toLocaleString()} · {slot.batteryLabel} · {slot.chargeMinutesAvailable} min
                charge window
              </small>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {slot.batteryAlert ? <span className="app-badge demo">Short pack</span> : null}
                {!slot.chargeSufficient ? <span className="app-badge setup">Charge shortfall</span> : null}
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
