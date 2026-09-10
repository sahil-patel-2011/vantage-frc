"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { vendorCategoryLabel } from "../../lib/vendors";
import { VENDOR_CATEGORIES, type VendorsView } from "../../lib/vendors/compute-vendors";
import {
  VENDORS_RELATED_INCLUDE,
  classifyVendorsShell,
  formatVendorsMetric,
  shouldShowVendorsSummaryTiles,
  vendorsNextActions,
  vendorsRelatedLinks,
  vendorsShellCopy,
  type VendorsNextAction,
  type VendorsShellKind,
} from "../../lib/vendors/vendors-related";
import type { Vendor, VendorCategory } from "../../lib/vendors/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./vendors.css";

type LiveView = Extract<VendorsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

/**
 * CSV shape of the vendor directory — the sheet a purchasing lead works from.
 * `accountNumber` is deliberately left out: it is an account credential, and an export
 * that lands in a shared Drive should not carry it.
 */
const VENDOR_CSV_COLUMNS: CsvColumn<Vendor>[] = [
  { key: "name", header: "Vendor" },
  { key: "category", header: "Category", value: (vendor) => vendorCategoryLabel(vendor.category) },
  { key: "preferred", header: "Preferred", hint: "true / false", value: (vendor) => vendor.preferred },
  { key: "rating", header: "Rating", hint: "1–5, blank when unrated", value: (vendor) => vendor.rating },
  {
    key: "leadTimeDays",
    header: "Lead time days",
    hint: "Typical order-to-delivery, blank when unknown",
    value: (vendor) => vendor.leadTimeDays,
  },
  { key: "website", header: "Website", value: (vendor) => vendor.website },
  { key: "contactName", header: "Contact", value: (vendor) => vendor.contactName },
  { key: "contactEmail", header: "Email", value: (vendor) => vendor.contactEmail },
  { key: "contactPhone", header: "Phone", value: (vendor) => vendor.contactPhone },
  { key: "notes", header: "Notes", value: (vendor) => vendor.notes },
];

function VendorsRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = vendorsRelatedLinks(orgId, {
    include: [...VENDORS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related vendors-related" aria-label="Related procurement tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function VendorsNextActionsPanel({ actions }: { actions: VendorsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions vendors-next-actions" aria-label="Next actions">
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

function VendorsShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: VendorsShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = vendorsNextActions({ orgId, shell });
  const copy = vendorsShellCopy(shell);
  const buildHref = withOrgHref("/build", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);

  return (
    <main className="module-page vendors-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Vendors"}
          </>
        }
        title="Vendor Directory"
        description={description}
      >
        <VendorsRelatedStrip orgId={orgId} />
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
      <VendorsNextActionsPanel actions={actions} />
    </main>
  );
}

export default function VendorsClient() {
  const [view, setView] = useState<VendorsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    void fetch(`/api/vendors${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as VendorsView | { error?: string };
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
  const preferredCount = view?.status === "live" ? view.summary.preferred : 0;
  const missingContactCount = view?.status === "live" ? view.summary.missingContact : 0;

  const shell = classifyVendorsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    vendorCount,
  });
  const shellCopy = vendorsShellCopy(shell);
  const nextActions = vendorsNextActions({
    orgId,
    shell,
    vendorCount,
    preferredCount,
    missingContactCount,
  });
  const relatedLinks = vendorsRelatedLinks(orgId, {
    include: [...VENDORS_RELATED_INCLUDE],
  });
  const buildHref = withOrgHref("/build", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);
  const leadTimesHref = hubHref("/business", "vendor-lead-times", orgId);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as VendorsView | { error?: string };
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
    return <VendorsShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <VendorsShell
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
      <VendorsShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
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
        ) : null}
      </VendorsShell>
    );
  }

  if (view?.status !== "live") {
    return <VendorsShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page vendors-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Vendors"}
          </>
        }
        title="Vendor Directory"
        description="Your team's known suppliers — COTS, raw stock, tools, and services — with contacts, lead times, and ratings. Purchase orders pick a vendor from this directory. Cross-check Orders and Vendor Lead Times."
      >
        <div className="vendors-header-actions">
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

      <VendorsNextActionsPanel actions={nextActions} />

      {shouldShowVendorsSummaryTiles(vendorCount) ? <SummaryTiles view={view} /> : null}

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

      <div className="vendors-layout">
        <AddVendorForm busy={busy} mutate={mutate} />
        <VendorList view={view} busy={busy} mutate={mutate} />
        <Panel className="vendors-tip" aria-label="Vendor directory tip">
          <span className="eyebrow">Procurement path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Purchase orders pick a supplier id from this directory — add vendors here, then submit
            through <a href={ordersHref}>Orders</a>. Keep shipping windows in{" "}
            <a href={leadTimesHref}>Vendor Lead Times</a>.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Vendors", value: formatVendorsMetric(s.total, true) },
    { label: "Preferred", value: formatVendorsMetric(s.preferred, true) },
    { label: "Avg rating", value: s.avgRating > 0 ? `${s.avgRating}★` : "—" },
    { label: "Missing contact", value: formatVendorsMetric(s.missingContact, true) },
  ];
  return (
    <section className="vendors-stats" aria-label="Real vendor directory counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
      {s.byCategory.length > 0 ? (
        <div className="vendors-category-chips">
          {s.byCategory.map((row) => (
            <span
              key={row.category}
              className="app-badge"
              title={row.avgLeadTimeDays != null ? `~${row.avgLeadTimeDays}d lead` : "lead time unknown"}
            >
              {vendorCategoryLabel(row.category)}: {row.count}
              {row.avgLeadTimeDays != null ? ` · ~${row.avgLeadTimeDays}d` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AddVendorForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      name: "",
      category: "hardware" as VendorCategory,
      website: "",
      contactEmail: "",
      contactPhone: "",
      leadTimeDays: "",
      rating: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="vendors-add-vendor"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "create-vendor",
          name: form.name,
          category: form.category,
          website: form.website || undefined,
          contactEmail: form.contactEmail || undefined,
          contactPhone: form.contactPhone || undefined,
          leadTimeDays: form.leadTimeDays || undefined,
          rating: form.rating || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add vendor</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Contacts and lead times come from real suppliers.
      </p>
      <FormGrid min={140}>
        <FormRow label="Vendor name" wide>
          <input value={form.name} onChange={set("name")} placeholder="McMaster-Carr" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {VENDOR_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {vendorCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Website">
          <input value={form.website} onChange={set("website")} placeholder="mcmaster.com" />
        </FormRow>
        <FormRow label="Email">
          <input value={form.contactEmail} onChange={set("contactEmail")} />
        </FormRow>
        <FormRow label="Phone">
          <input value={form.contactPhone} onChange={set("contactPhone")} />
        </FormRow>
        <FormRow label="Lead time (days)">
          <input type="number" min={0} value={form.leadTimeDays} onChange={set("leadTimeDays")} />
        </FormRow>
        <FormRow label="Rating (1–5)">
          <input type="number" min={1} max={5} value={form.rating} onChange={set("rating")} />
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

function VendorList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.vendors.length === 0) {
    return null;
  }
  return (
    <section id="vendors-directory" style={{ display: "grid", gap: 12 }} aria-label="Vendor directory">
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <ExportButton
          rows={view.vendors}
          columns={VENDOR_CSV_COLUMNS}
          feature="Vendors"
          orgLabel={view.teamNumber != null ? `team-${view.teamNumber}` : null}
          orgId={view.orgId}
          size="sm"
          provenance="Your team's vendor directory. Account numbers are intentionally left out of the file."
        />
      </div>
      {view.vendors.map((vendor) => (
        <VendorCard key={vendor.id} vendor={vendor} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function VendorCard({ vendor, busy, mutate }: { vendor: Vendor; busy: boolean; mutate: Mutate }) {
  const websiteHref = vendor.website
    ? vendor.website.startsWith("http")
      ? vendor.website
      : `https://${vendor.website}`
    : null;
  return (
    <article className="app-card soft-panel">
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge">{vendorCategoryLabel(vendor.category)}</span>{" "}
          {vendor.rating ? <small className="app-muted">{"★".repeat(vendor.rating)}</small> : null}
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>
            {vendor.name}
            {vendor.preferred ? (
              <span title="Preferred" style={{ color: "#c9a900" }}>
                {" "}
                ★
              </span>
            ) : null}
          </h2>
          <small className="app-muted">
            {websiteHref ? (
              <a href={websiteHref} target="_blank" rel="noreferrer">
                {vendor.website}
              </a>
            ) : null}
            {vendor.contactEmail ? ` · ${vendor.contactEmail}` : ""}
            {vendor.contactPhone ? ` · ${vendor.contactPhone}` : ""}
            {vendor.leadTimeDays != null ? ` · ~${vendor.leadTimeDays}d lead` : ""}
          </small>
        </div>
        <button
          type="button"
          className={`app-badge ${vendor.preferred ? "good" : ""}`}
          disabled={busy}
          title="Toggle preferred"
          style={{ cursor: "pointer", border: "none" }}
          onClick={() => mutate({ action: "update-vendor", vendorId: vendor.id, preferred: !vendor.preferred })}
        >
          {vendor.preferred ? "Preferred" : "Mark preferred"}
        </button>
      </header>
      <footer style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Rating
          <select
            value={vendor.rating ? String(vendor.rating) : ""}
            disabled={busy}
            onChange={(event) =>
              mutate({ action: "update-vendor", vendorId: vendor.id, rating: event.target.value || null })
            }
          >
            <option value="">—</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}★
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${vendor.name}"?`)) mutate({ action: "delete-vendor", vendorId: vendor.id });
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
