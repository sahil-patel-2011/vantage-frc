"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { reorderStatusLabel, reorderUrgencyLabel } from "../../lib/vendor-lead-times";
import type { VendorLeadTimesView } from "../../lib/vendor-lead-times/compute-vendor-lead-times";
import {
  VENDOR_LEAD_TIMES_RELATED_INCLUDE,
  classifyVendorLeadTimesShell,
  formatVendorLeadTimesMetric,
  shouldShowVendorLeadTimesSummaryTiles,
  vendorLeadTimesNextActions,
  vendorLeadTimesRelatedLinks,
  vendorLeadTimesShellCopy,
  type VendorLeadTimesNextAction,
  type VendorLeadTimesShellKind,
} from "../../lib/vendor-lead-times/vendor-lead-times-related";
import type { ReorderStatus, ReorderUrgency } from "../../lib/vendor-lead-times/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./vendor-lead-times.css";

function urgencyTone(urgency: ReorderUrgency): string {
  if (urgency === "overdue") return "danger";
  if (urgency === "due_soon") return "setup";
  if (urgency === "resolved") return "";
  return "good";
}

type LiveView = Extract<VendorLeadTimesView, { status: "live" }>;

function VendorLeadTimesRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = vendorLeadTimesRelatedLinks(orgId, {
    include: [...VENDOR_LEAD_TIMES_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related vendor-lead-times-related" aria-label="Related procurement tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function VendorLeadTimesNextActionsPanel({ actions }: { actions: VendorLeadTimesNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions vendor-lead-times-next-actions"
      aria-label="Next actions"
    >
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

function VendorLeadTimesShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: VendorLeadTimesShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = vendorLeadTimesNextActions({ orgId, shell });
  const copy = vendorLeadTimesShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "vendor-lead-times", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);

  return (
    <main className="module-page vendor-lead-times-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Vendor Lead Times"}
          </>
        }
        title="Vendor Lead Times"
        description={description}
      >
        <VendorLeadTimesRelatedStrip orgId={orgId} />
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
                ? "No vendors yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={ordersHref}>Open Orders</Button>
        ) : null}
      </EmptyState>
      <VendorLeadTimesNextActionsPanel actions={actions} />
    </main>
  );
}

export default function VendorLeadTimesClient() {
  const [view, setView] = useState<VendorLeadTimesView | null>(null);
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const vendorCount = view?.status === "live" ? view.vendors.length : 0;
  const openReorderCount = view?.status === "live" ? view.summary.totalOpen : 0;
  const overdueCount = view?.status === "live" ? view.summary.overdueCount : 0;

  const shell = classifyVendorLeadTimesShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    vendorCount,
  });
  const shellCopy = vendorLeadTimesShellCopy(shell);
  const nextActions = vendorLeadTimesNextActions({
    orgId,
    shell,
    vendorCount,
    openReorderCount,
    overdueCount,
  });
  const relatedLinks = vendorLeadTimesRelatedLinks(orgId, {
    include: [...VENDOR_LEAD_TIMES_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "vendor-lead-times", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);
  const spareHref = hubHref("/build", "spare-forecast", orgId);
  const vendorsHref = withOrgHref("/vendors", orgId);

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

  if (shell === "loading") {
    return (
      <VendorLeadTimesShell description={shellCopy.description} orgId={null} shell="loading" />
    );
  }

  if (shell === "error") {
    return (
      <VendorLeadTimesShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <VendorLeadTimesShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        
      </VendorLeadTimesShell>
    );
  }

  if (view?.status !== "live") {
    return <VendorLeadTimesShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page vendor-lead-times-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Vendor Lead Times"}
          </>
        }
        title="Vendor Lead Times"
        description="Track real vendor shipping lead times and calculate the latest date to reorder parts so they still arrive in time. Cross-check Orders, Spare Forecast, and Vendors."
      >
        <div className="vendor-lead-times-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <VendorLeadTimesNextActionsPanel actions={nextActions} />

      {shouldShowVendorLeadTimesSummaryTiles(vendorCount) ? (
        <SummaryTiles view={view} />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No vendors yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href={ordersHref}>
            Open Orders
          </Button>
        </EmptyState>
      ) : null}

      <div className="vendor-lead-times-layout">
        <AddVendorForm busy={busy} mutate={mutate} />
        {view.vendors.length > 0 ? (
          <AddReorderForm view={view} busy={busy} mutate={mutate} />
        ) : null}
        <VendorList view={view} busy={busy} mutate={mutate} />
        <ReorderList view={view} busy={busy} mutate={mutate} />
        <Panel className="vendor-lead-times-tip" aria-label="Vendor lead times tip">
          <span className="eyebrow">Procurement path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Place due reorders through <a href={ordersHref}>Orders</a>, align restock windows with{" "}
            <a href={spareHref}>Spare Forecast</a>, and keep contacts in <a href={vendorsHref}>Vendors</a>{" "}
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Vendors", value: formatVendorLeadTimesMetric(view.vendors.length, true) },
    { label: "Open reorders", value: formatVendorLeadTimesMetric(summary.totalOpen, true) },
    { label: "Overdue", value: formatVendorLeadTimesMetric(summary.overdueCount, true) },
    { label: "Due soon", value: formatVendorLeadTimesMetric(summary.dueSoonCount, true) },
    { label: "On track", value: formatVendorLeadTimesMetric(summary.okCount, true) },
  ];
  return (
    <section className="vendor-lead-times-stats" aria-label="Real vendor and reorder counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
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
      id="vendor-lead-times-add-vendor"
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
      <p className="app-muted" style={{ margin: 0 }}>
        Lead time and safety buffer come from real supplier quotes.
      </p>
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
        <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
          Add vendor
        </Button>
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
      id="vendor-lead-times-add-reorder"
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
      <p className="app-muted" style={{ margin: 0 }}>
        Order-by date = needed-by minus lead time and safety buffer.
      </p>
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
        <Button variant="primary" type="submit" disabled={busy || !form.vendorId || !form.itemName.trim() || !form.neededBy}>
          Log reorder
        </Button>
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
      <ul className="vendor-lead-times-list">
        {view.vendors.map((vendor) => (
          <li key={vendor.id} className="vendor-lead-times-row">
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
      <div id="vendor-lead-times-reorders">
        <EmptyState
          soft
          badge="No reorders yet"
          badgeTone="setup"
          title="Log a reorder to see its order-by date"
          description="Reorder-by date = needed-by date minus vendor lead time and safety buffer."
        />
      </div>
    );
  }
  return (
    <Panel id="vendor-lead-times-reorders">
      <h2 style={{ marginTop: 0 }}>Reorders</h2>
      <ul className="vendor-lead-times-list">
        {view.reorders.map((reorder) => (
          <li key={reorder.id} className="vendor-lead-times-row">
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
            <div className="vendor-lead-times-row-actions">
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
