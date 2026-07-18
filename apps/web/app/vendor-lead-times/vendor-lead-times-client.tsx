"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { reorderStatusLabel, reorderUrgencyLabel } from "../../lib/vendor-lead-times";
import type { VendorLeadTimesView } from "../../lib/vendor-lead-times/compute-vendor-lead-times";
import type { ReorderStatus, ReorderUrgency } from "../../lib/vendor-lead-times/types";

function urgencyTone(urgency: ReorderUrgency): string {
  if (urgency === "overdue") return "demo";
  if (urgency === "due_soon") return "setup";
  if (urgency === "resolved") return "";
  return "good";
}

type LiveView = Extract<VendorLeadTimesView, { status: "live" }>;

export default function VendorLeadTimesClient() {
  const [view, setView] = useState<VendorLeadTimesView | null>(null);
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
    void fetch(`/api/vendor-lead-times${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as VendorLeadTimesView | { error?: string };
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
        const response = await fetch("/api/vendor-lead-times", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as VendorLeadTimesView | { error?: string };
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
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Vendor Lead Times"}
          </>
        }
        title="Vendor Lead Times"
        description="Track vendor shipping lead times and calculate the latest date to reorder parts so they still arrive in time."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Vendor Lead Times"
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
          <SummaryTiles view={view} />
          <AddVendorForm busy={busy} mutate={mutate} />
          {view.vendors.length > 0 ? (
            <AddReorderForm view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No vendors yet"
              badgeTone="setup"
              title="Add a vendor to start tracking reorders"
              description="Once a vendor has a lead time, you can log reorders and see order-by dates."
            />
          )}
          <VendorList view={view} busy={busy} mutate={mutate} />
          <ReorderList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Vendors", value: String(view.vendors.length) },
    { label: "Open reorders", value: String(summary.totalOpen) },
    { label: "Overdue", value: String(summary.overdueCount) },
    { label: "Due soon", value: String(summary.dueSoonCount) },
    { label: "On track", value: String(summary.okCount) },
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

function AddVendorForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ name: "", leadTimeDays: "", safetyBufferDays: "", notes: "" }),
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
          action: "add-vendor",
          name: form.name,
          leadTimeDays: Number(form.leadTimeDays) || 0,
          safetyBufferDays: Number(form.safetyBufferDays) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add vendor</h2>
      <FormGrid min={160}>
        <FormRow label="Vendor name">
          <input value={form.name} onChange={set("name")} placeholder="AndyMark" required />
        </FormRow>
        <FormRow label="Lead time (days)">
          <input type="number" min={0} value={form.leadTimeDays} onChange={set("leadTimeDays")} />
        </FormRow>
        <FormRow label="Safety buffer (days)">
          <input type="number" min={0} value={form.safetyBufferDays} onChange={set("safetyBufferDays")} />
        </FormRow>
        <FormRow label="Notes (optional)" wide>
          <input value={form.notes} onChange={set("notes")} />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add vendor
        </button>
      </div>
    </Panel>
  );
}

function AddReorderForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ vendorId: view.vendors[0]?.id ?? "", itemName: "", quantity: "1", neededBy: "", notes: "" }),
    [view.vendors],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.vendorId || !form.itemName.trim() || !form.neededBy) return;
        mutate({
          action: "add-reorder",
          vendorId: form.vendorId,
          itemName: form.itemName,
          quantity: Number(form.quantity) || 1,
          neededBy: form.neededBy,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log reorder</h2>
      <FormGrid min={160}>
        <FormRow label="Vendor">
          <select value={form.vendorId} onChange={set("vendorId")} required>
            {view.vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Item">
          <input value={form.itemName} onChange={set("itemName")} placeholder="Gearbox kit" required />
        </FormRow>
        <FormRow label="Quantity">
          <input type="number" min={1} value={form.quantity} onChange={set("quantity")} />
        </FormRow>
        <FormRow label="Needed by">
          <input type="date" value={form.neededBy} onChange={set("neededBy")} required />
        </FormRow>
        <FormRow label="Notes (optional)" wide>
          <input value={form.notes} onChange={set("notes")} />
        </FormRow>
      </FormGrid>
      <div>
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.vendorId || !form.itemName.trim() || !form.neededBy}
        >
          Log reorder
        </button>
      </div>
    </Panel>
  );
}

function VendorList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.vendors.length === 0) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Vendors</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.vendors.map((vendor) => (
          <li key={vendor.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{vendor.name}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {vendor.leadTimeDays}d lead time · {vendor.safetyBufferDays}d safety buffer
                {vendor.notes ? ` · ${vendor.notes}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete vendor "${vendor.name}"? This removes its reorders too.`)) {
                  mutate({ action: "delete-vendor", vendorId: vendor.id });
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

function ReorderList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.reorders.length === 0) {
    return (
      <EmptyState
        badge="No reorders yet"
        badgeTone="setup"
        title="Log a reorder to see its order-by date"
        description="Reorder-by date = needed-by date minus vendor lead time and safety buffer."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Reorders</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.reorders.map((reorder) => (
          <li key={reorder.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${urgencyTone(reorder.calc.urgency)}`}>
                {reorderUrgencyLabel(reorder.calc.urgency)}
              </span>
              <strong style={{ display: "block", marginTop: 4 }}>
                {reorder.itemName} × {reorder.quantity}
              </strong>
              <small className="app-muted" style={{ display: "block" }}>
                {reorder.vendorName} · needed {reorder.neededBy} · order by {reorder.calc.orderByDate} ·{" "}
                {reorder.calc.daysUntilOrderBy >= 0
                  ? `${reorder.calc.daysUntilOrderBy}d until order-by`
                  : `${Math.abs(reorder.calc.daysUntilOrderBy)}d past order-by`}
              </small>
              {reorder.notes ? (
                <small className="app-muted" style={{ display: "block" }}>
                  {reorder.notes}
                </small>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
              <select
                value={reorder.status}
                disabled={busy}
                aria-label={`Status for ${reorder.itemName}`}
                onChange={(event) =>
                  mutate({
                    action: "set-reorder-status",
                    reorderId: reorder.id,
                    status: event.target.value as ReorderStatus,
                  })
                }
              >
                {(["open", "ordered", "received", "cancelled"] as ReorderStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {reorderStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete reorder "${reorder.itemName}"?`)) {
                    mutate({ action: "delete-reorder", reorderId: reorder.id });
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
