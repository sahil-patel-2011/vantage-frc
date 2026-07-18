"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { vendorCategoryLabel } from "../../lib/vendors";
import { VENDOR_CATEGORIES, type VendorsView } from "../../lib/vendors/compute-vendors";
import type { Vendor, VendorCategory } from "../../lib/vendors/types";

type LiveView = Extract<VendorsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

export default function VendorsClient() {
  const [view, setView] = useState<VendorsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

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

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Build / Vendors</span>
          <h1>Vendor Directory</h1>
          <p>
            Your team&apos;s known suppliers — COTS, raw stock, tools, and services — with contacts, lead times, and
            ratings, so anyone can reorder fast and next season&apos;s team inherits your sourcing knowledge.
          </p>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <section className="app-card soft-panel">
          <h2>Could not load vendors</h2>
          <p className="app-muted">A network or server issue prevented loading. Try again.</p>
          <button type="button" className="app-button secondary" onClick={load}>
            Retry
          </button>
        </section>
      ) : view == null ? (
        <section className="app-card soft-panel">
          <h2>Loading…</h2>
          <p className="app-muted">Checking your workspace.</p>
        </section>
      ) : view.status === "setup_required" ? (
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>{view.message}</h2>
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
        </section>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <AddVendorForm busy={busy} mutate={mutate} />
          <VendorList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Vendors", value: String(s.total) },
    { label: "Preferred", value: String(s.preferred) },
    { label: "Avg rating", value: s.avgRating ? `${s.avgRating}★` : "—" },
    { label: "Missing contact", value: String(s.missingContact) },
  ];
  return (
    <section className="app-card soft-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {s.byCategory.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {s.byCategory.map((row) => (
            <span key={row.category} className="app-badge demo" title={row.avgLeadTimeDays != null ? `~${row.avgLeadTimeDays}d lead` : "lead time unknown"}>
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
    <form
      className="app-card soft-panel"
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          <span className="app-muted">Vendor name</span>
          <input value={form.name} onChange={set("name")} placeholder="McMaster-Carr" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Category</span>
          <select value={form.category} onChange={set("category")}>
            {VENDOR_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {vendorCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Website</span>
          <input value={form.website} onChange={set("website")} placeholder="mcmaster.com" />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Email</span>
          <input value={form.contactEmail} onChange={set("contactEmail")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Phone</span>
          <input value={form.contactPhone} onChange={set("contactPhone")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Lead time (days)</span>
          <input type="number" min={0} value={form.leadTimeDays} onChange={set("leadTimeDays")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Rating (1–5)</span>
          <input type="number" min={1} max={5} value={form.rating} onChange={set("rating")} />
        </label>
      </div>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add vendor
        </button>
      </div>
    </form>
  );
}

function VendorList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.vendors.length === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge setup">No vendors yet</span>
        <h2>Build your sourcing directory</h2>
        <p className="app-muted">Add the suppliers you buy from so anyone on the team can reorder without hunting for links.</p>
      </section>
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
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
          <span className="app-badge demo">{vendorCategoryLabel(vendor.category)}</span>{" "}
          {vendor.rating ? <small className="app-muted">{"★".repeat(vendor.rating)}</small> : null}
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>
            {vendor.name}
            {vendor.preferred ? <span title="Preferred" style={{ color: "#c9a900" }}> ★</span> : null}
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
          className={`app-badge ${vendor.preferred ? "good" : "demo"}`}
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
            onChange={(event) => mutate({ action: "update-vendor", vendorId: vendor.id, rating: event.target.value || null })}
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
