"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/ui/empty-state";
import { FormGrid, FormRow } from "../../components/ui/form-row";
import { PageHeader } from "../../components/ui/page-header";
import { Panel } from "../../components/ui/panel";
import { equipmentCategoryLabel, maintenanceActionLabel } from "../../lib/equipment-maintenance";
import {
  EQUIPMENT_CATEGORIES,
  MAINTENANCE_ACTIONS,
  type EquipmentMaintenanceView,
} from "../../lib/equipment-maintenance/compute-equipment-maintenance";
import type { EquipmentCategory, EquipmentStatus, MaintenanceAction } from "../../lib/equipment-maintenance/types";

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  ok: "On schedule",
  unscheduled: "No schedule",
};

function statusTone(status: EquipmentStatus): string {
  if (status === "overdue") return "demo";
  if (status === "due_soon") return "setup";
  if (status === "ok") return "good";
  return "";
}

type LiveView = Extract<EquipmentMaintenanceView, { status: "live" }>;

export default function EquipmentMaintenanceClient() {
  const [view, setView] = useState<EquipmentMaintenanceView | null>(null);
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
    void fetch(`/api/equipment-maintenance${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as EquipmentMaintenanceView | { error?: string };
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
        const response = await fetch("/api/equipment-maintenance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as EquipmentMaintenanceView | { error?: string };
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
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Equipment Maintenance"}
          </>
        }
        title="Equipment Maintenance"
        description="Track shop equipment — mills, printers, saws, welders — and log the maintenance that keeps them running. Schedules are computed only from what you record."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Equipment Maintenance"
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
          {view.orgId ? <AddAssetForm busy={busy} mutate={mutate} /> : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <AddAssetForm busy={busy} mutate={mutate} />
          <LogMaintenanceForm view={view} busy={busy} mutate={mutate} />
          <AssetList view={view} busy={busy} mutate={mutate} />
          <RecentLogs view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Assets", value: String(summary.totalAssets) },
    { label: "Overdue", value: String(summary.overdueCount) },
    { label: "Due soon", value: String(summary.dueSoonCount) },
    { label: "Unscheduled", value: String(summary.unscheduledCount) },
    { label: "Maintenance logs", value: String(summary.totalLogs) },
    { label: "Minutes logged", value: summary.totalMinutesLogged.toLocaleString() },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AssetList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.assets.length === 0) {
    return (
      <EmptyState
        badge="No equipment yet"
        badgeTone="setup"
        title="Add your first piece of shop equipment"
        description="Mills, printers, saws, and welders you add here get maintenance schedules computed from what you log."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Equipment</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.assets.map((asset) => (
          <li
            key={asset.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <span className={`app-badge ${statusTone(asset.status)}`}>{STATUS_LABEL[asset.status]}</span>
              <strong style={{ marginLeft: 8 }}>{asset.name}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {equipmentCategoryLabel(asset.category)}
                {asset.location ? ` · ${asset.location}` : ""}
                {asset.intervalDays ? ` · every ${asset.intervalDays}d` : " · no interval set"}
              </small>
              <small className="app-muted">
                {asset.lastPerformedOn ? `Last serviced ${asset.lastPerformedOn}` : "No maintenance logged yet"}
                {asset.nextDueOn ? ` · next due ${asset.nextDueOn}` : ""}
                {` · ${asset.logCount} log(s)`}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "set-asset-active", assetId: asset.id, active: !asset.active })}
              >
                {asset.active ? "Retire" : "Reactivate"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${asset.name}" and its maintenance history?`)) {
                    mutate({ action: "delete-asset", assetId: asset.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RecentLogs({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.logs.length === 0) {
    return (
      <EmptyState
        badge="No maintenance logged yet"
        badgeTone="setup"
        title="Log your first maintenance action"
        description="Routine service, repairs, inspections, and cleaning all count toward a healthy shop."
      />
    );
  }
  const assetName = (assetId: string) => view.assets.find((a) => a.id === assetId)?.name ?? "Unknown equipment";
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent maintenance</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.logs.slice(0, 20).map((log) => (
          <li key={log.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{assetName(log.assetId)}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {log.performedOn} · {maintenanceActionLabel(log.action)} · {log.minutesSpent} min
              </small>
              {log.notes ? <small className="app-muted">{log.notes}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "delete-log", logId: log.id })}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddAssetForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ name: "", category: "other" as EquipmentCategory, location: "", intervalDays: "", notes: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "create-asset",
          name: form.name,
          category: form.category,
          location: form.location || undefined,
          intervalDays: form.intervalDays ? Number(form.intervalDays) : undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add equipment</h2>
      <FormGrid min={160}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="CNC Router" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {EQUIPMENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {equipmentCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Location (optional)">
          <input value={form.location} onChange={set("location")} placeholder="Shop bay 1" />
        </FormRow>
        <FormRow label="Maintenance interval (days, optional)">
          <input type="number" min={1} value={form.intervalDays} onChange={set("intervalDays")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add equipment
        </button>
      </div>
    </Panel>
  );
}

function LogMaintenanceForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const firstAssetId = view.assets[0]?.id ?? "";
  const empty = useMemo(
    () => ({
      assetId: firstAssetId,
      performedOn: "",
      maintenanceAction: "routine" as MaintenanceAction,
      minutesSpent: "",
      notes: "",
    }),
    [firstAssetId],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (view.assets.length === 0) return null;

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.assetId || !form.performedOn) return;
        mutate({
          action: "log-maintenance",
          assetId: form.assetId,
          performedOn: form.performedOn,
          maintenanceAction: form.maintenanceAction,
          minutesSpent: Number(form.minutesSpent) || 0,
          notes: form.notes || undefined,
        });
        setForm({ ...empty, assetId: form.assetId });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log maintenance</h2>
      <FormGrid min={160}>
        <FormRow label="Equipment">
          <select value={form.assetId} onChange={set("assetId")}>
            {view.assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.performedOn} onChange={set("performedOn")} required />
        </FormRow>
        <FormRow label="Action">
          <select value={form.maintenanceAction} onChange={set("maintenanceAction")}>
            {MAINTENANCE_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {maintenanceActionLabel(action)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Minutes spent">
          <input type="number" min={0} value={form.minutesSpent} onChange={set("minutesSpent")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.assetId || !form.performedOn}>
          Log maintenance
        </button>
      </div>
    </Panel>
  );
}
