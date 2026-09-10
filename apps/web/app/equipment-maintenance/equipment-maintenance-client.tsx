"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { equipmentCategoryLabel, maintenanceActionLabel } from "../../lib/equipment-maintenance";
import {
  EQUIPMENT_CATEGORIES,
  MAINTENANCE_ACTIONS,
  type EquipmentMaintenanceView,
} from "../../lib/equipment-maintenance/compute-equipment-maintenance";
import type { EquipmentCategory, EquipmentStatus, MaintenanceAction } from "../../lib/equipment-maintenance/types";
import {
  EQUIPMENT_MAINTENANCE_RELATED_INCLUDE,
  classifyEquipmentMaintenanceShell,
  formatEquipmentMaintenanceMetric,
  equipmentMaintenanceNextActions,
  equipmentMaintenanceRelatedLinks,
  equipmentMaintenanceSetupSteps,
  equipmentMaintenanceShellCopy,
  shouldShowEquipmentMaintenanceSummaryTiles,
  type EquipmentMaintenanceNextAction,
  type EquipmentMaintenanceShellKind,
} from "../../lib/equipment-maintenance/equipment-maintenance-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./equipment-maintenance.css";

const STATUS_LABEL: Record<EquipmentStatus, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  ok: "On schedule",
  unscheduled: "No schedule",
};

const STATUS_TONE: Record<EquipmentStatus, BadgeTone> = {
  overdue: "danger",
  due_soon: "setup",
  ok: "good",
  unscheduled: "neutral",
};

type LiveView = Extract<EquipmentMaintenanceView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = equipmentMaintenanceRelatedLinks(orgId, {
    include: [...EQUIPMENT_MAINTENANCE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related em-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: EquipmentMaintenanceNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions em-next-actions" aria-label="Next actions">
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MaintenanceShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
}: {
  description: string;
  orgId?: string | null;
  shell: EquipmentMaintenanceShellKind;
  error?: string;
  onRetry?: () => void;
}) {
  const actions = equipmentMaintenanceNextActions({ orgId, shell });
  const copy = equipmentMaintenanceShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "equipment-maintenance", orgId);
  const steps = shell === "setup" ? equipmentMaintenanceSetupSteps(orgId) : [];

  return (
    <main className="module-page em-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Equipment Maintenance"}
          </>
        }
        title="Equipment Maintenance"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Equipment Maintenance">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Choose your team
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/team", "tool-checkout", orgId)}>
                Open Tool Checkout
              </a>
              <a className="app-button secondary" href={withOrgHref("/inventory", orgId)}>
                Open Inventory
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="em-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="em-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted em-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function EquipmentMaintenanceClient() {
  const [view, setView] = useState<EquipmentMaintenanceView | null>(null);
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const assetCount = view?.status === "live" ? view.summary.totalAssets : 0;
  const logCount = view?.status === "live" ? view.summary.totalLogs : 0;
  const overdueCount = view?.status === "live" ? view.summary.overdueCount : 0;

  const shell = classifyEquipmentMaintenanceShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    assetCount,
  });
  const shellCopy = equipmentMaintenanceShellCopy(shell);
  const nextActions = equipmentMaintenanceNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    assetCount,
    overdueCount,
  });
  const teamHref = hubWorkbenchHref("team", "equipment-maintenance", orgId);
  const showTiles = shouldShowEquipmentMaintenanceSummaryTiles(assetCount, logCount);
  const loaded = view?.status === "live";

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

  if (shell === "loading") {
    return <MaintenanceShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <MaintenanceShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <MaintenanceShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page em-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Equipment Maintenance"}
          </>
        }
        title="Equipment Maintenance"
        description="Track shop equipment and log the maintenance that keeps them running."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="em-panel">
          <div className="em-stats">
            <StatTile label="Assets" value={formatEquipmentMaintenanceMetric(view.summary.totalAssets, loaded)} />
            <StatTile label="Overdue" value={formatEquipmentMaintenanceMetric(view.summary.overdueCount, loaded)} />
            <StatTile label="Due soon" value={formatEquipmentMaintenanceMetric(view.summary.dueSoonCount, loaded)} />
            <StatTile
              label="Unscheduled"
              value={formatEquipmentMaintenanceMetric(view.summary.unscheduledCount, loaded)}
            />
            <StatTile
              label="Maintenance logs"
              value={formatEquipmentMaintenanceMetric(view.summary.totalLogs, loaded)}
            />
            <StatTile
              label="Minutes logged"
              value={formatEquipmentMaintenanceMetric(view.summary.totalMinutesLogged, loaded)}
            />
          </div>
        </Panel>
      ) : null}

      <AddAssetForm busy={busy} mutate={mutate} />
      <LogMaintenanceForm view={view} busy={busy} mutate={mutate} />
      <AssetList view={view} busy={busy} mutate={mutate} />
      <RecentLogs view={view} busy={busy} mutate={mutate} />
      <NextActionsPanel actions={nextActions} />
    </main>
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
        soft
        badge="No equipment yet"
        badgeTone="setup"
        title="Add your first piece of shop equipment"
        description="Mills, printers, saws, and welders get schedules from what you log."
      />
    );
  }
  return (
    <Panel id="equipment-maintenance-assets" className="em-panel">
      <h2>Equipment</h2>
      <ul className="em-list">
        {view.assets.map((asset) => (
          <li key={asset.id} className="em-row">
            <div>
              <Badge tone={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
              <strong className="em-name">{asset.name}</strong>
              <small className="app-muted em-block">
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
            <div className="em-actions">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={asset.active ? `Retire ${asset.name}` : `Reactivate ${asset.name}`}
                onClick={() => mutate({ action: "set-asset-active", assetId: asset.id, active: !asset.active })}
              >
                {asset.active ? "Retire" : "Reactivate"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`Delete ${asset.name}`}
                onClick={() => {
                  if (window.confirm(`Delete "${asset.name}" and its maintenance history?`)) {
                    mutate({ action: "delete-asset", assetId: asset.id });
                  }
                }}
              >
                Delete
              </Button>
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
        soft
        badge="No maintenance logged yet"
        badgeTone="setup"
        title="Log your first maintenance action"
        description="Routine service, repairs, inspections, and cleaning count toward a healthy shop."
      />
    );
  }
  const assetName = (assetId: string) => view.assets.find((a) => a.id === assetId)?.name ?? "Unknown equipment";
  return (
    <Panel className="em-panel">
      <h2>Recent maintenance</h2>
      <ul className="em-list">
        {view.logs.slice(0, 20).map((log) => (
          <li key={log.id} className="em-row">
            <div>
              <strong>{assetName(log.assetId)}</strong>
              <small className="app-muted em-block">
                {log.performedOn} · {maintenanceActionLabel(log.action)} · {log.minutesSpent} min
              </small>
              {log.notes ? <small className="app-muted">{log.notes}</small> : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Delete maintenance log for ${assetName(log.assetId)} on ${log.performedOn}`}
              onClick={() => mutate({ action: "delete-log", logId: log.id })}
            >
              Delete
            </Button>
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
      id="equipment-maintenance-add"
      className="em-panel"
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
    >
      <h2>Add equipment</h2>
      <p className="app-muted em-tip">Real shop machines only.</p>
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
        <Button type="submit" variant="primary" disabled={busy || !form.name.trim()}>
          Add equipment
        </Button>
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
      id="equipment-maintenance-log"
      className="em-panel"
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
    >
      <h2>Log maintenance</h2>
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
        <Button type="submit" variant="primary" disabled={busy || !form.assetId || !form.performedOn}>
          Log maintenance
        </Button>
      </div>
    </Panel>
  );
}
