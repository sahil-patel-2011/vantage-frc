"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../../components/ui";
import {
  CATALOG_CATEGORY_LABELS,
  inventoryCategoryFor,
  searchCatalog,
  vendorSearchUrl,
  type CatalogCategory,
  type CatalogPart,
} from "../../lib/parts-catalog/catalog";
import "./parts-catalog.css";

/**
 * The parts FRC teams actually buy, with what you need to know to pick between
 * them — and two buttons that connect it to the rest of Vantage: put it in the
 * team's inventory (so "do we have any" has an answer) or send a part request
 * to a mentor (so "can we buy it" has one).
 *
 * No prices, on purpose: a stale price in a catalog is a wrong number that
 * looks authoritative. The vendor link is the price.
 */
export default function PartsCatalogClient() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CatalogCategory | "">("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Which team, and what it already stocks. Both come from the inventory API
  // so "In stock" here means the same thing it means on the Inventory page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    void fetch(`/api/inventory${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`)
      .then(async (r) => {
        const data = (await r.json()) as {
          context?: { orgId?: string | null };
          items?: Array<{ name: string; partNumber?: string | null }>;
        };
        if (data.context?.orgId) setOrgId(data.context.orgId);
        const names = new Set<string>();
        for (const item of data.items ?? []) {
          names.add(item.name.trim().toLowerCase());
          if (item.partNumber) names.add(item.partNumber.trim().toLowerCase());
        }
        setExisting(names);
      })
      .catch(() => {
        /* the catalog is still useful read-only */
      });
  }, []);

  const results = useMemo(() => searchCatalog(query, category || null), [query, category]);
  const grouped = useMemo(() => {
    const map = new Map<CatalogCategory, CatalogPart[]>();
    for (const p of results) map.set(p.category, [...(map.get(p.category) ?? []), p]);
    return map;
  }, [results]);

  const inStock = (p: CatalogPart) =>
    existing.has(p.name.trim().toLowerCase()) || (p.sku ? existing.has(p.sku.toLowerCase()) : false);

  async function addToInventory(p: CatalogPart) {
    if (!orgId) return;
    setBusy(p.id);
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create_item",
          orgId,
          name: p.name,
          category: inventoryCategoryFor(p.category),
          unit: p.unit,
          initialQuantity: 0,
          minQuantity: p.suggestedMin ?? 0,
          unitCost: null,
          locationId: null,
          subsystem: null,
          isSpare: false,
          partNumber: p.sku,
          vendor: p.vendor,
          notes: p.spec,
        }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setError(data.error ?? "Could not add to inventory.");
        return;
      }
      setExisting((prev) => new Set([...prev, p.name.toLowerCase()]));
      setNotice(`Added "${p.name}" to inventory at 0 on hand${p.suggestedMin ? `, reorder at ${p.suggestedMin}` : ""}. Set the real count on the Inventory page.`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const requestHref = (p: CatalogPart) => {
    const q = new URLSearchParams({ title: p.name, vendor: p.vendor, itemUrl: vendorSearchUrl(p) });
    if (orgId) q.set("orgId", orgId);
    return `/part-requests?${q.toString()}`;
  };

  return (
    <main className="module-page pc-page">
      <PageHeader
        breadcrumbs="Business / Money / Parts catalog"
        title="Parts catalog"
        description="The COTS parts FRC teams actually buy, with the spec you need to pick between them. Add one to inventory, or send a part request to a mentor."
      />

      <div className="pc-toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — nyloc, hex bearing, 1x1 tube, spark max…"
          aria-label="Search the catalog"
          autoFocus
        />
        <select value={category} onChange={(e) => setCategory(e.target.value as CatalogCategory | "")} aria-label="Category">
          <option value="">All categories</option>
          {(Object.keys(CATALOG_CATEGORY_LABELS) as CatalogCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATALOG_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <span className="app-muted">{results.length} part{results.length === 1 ? "" : "s"}</span>
      </div>

      {notice ? <p className="pc-notice">{notice}</p> : null}
      {error ? <p className="pc-error" role="alert">{error}</p> : null}

      {results.length === 0 ? (
        <p className="app-muted">
          Nothing in the catalog matches that. It is a curated list, not every part in the world — if you know what you
          want, <a href={orgId ? `/part-requests?orgId=${orgId}` : "/part-requests"}>request it directly</a>.
        </p>
      ) : null}

      {[...grouped.entries()].map(([cat, parts]) => (
        <section key={cat} className="pc-group" aria-label={CATALOG_CATEGORY_LABELS[cat]}>
          <h2>{CATALOG_CATEGORY_LABELS[cat]}</h2>
          <ul className="pc-list">
            {parts.map((p) => (
              <li key={p.id} className="pc-part">
                <div className="pc-main">
                  <strong>{p.name}</strong>
                  <span className="pc-meta">
                    {p.vendor}
                    {p.sku ? ` · ${p.sku}` : ""}
                    {inStock(p) ? <em className="pc-instock"> · in your inventory</em> : null}
                  </span>
                  <span className="pc-spec">{p.spec}</span>
                  <span className="app-muted">{p.use}</span>
                </div>
                <div className="pc-actions">
                  <a className="pc-link" href={vendorSearchUrl(p)} target="_blank" rel="noreferrer">
                    {p.vendor} page
                  </a>
                  <a className="pc-link" href={requestHref(p)}>
                    Request it
                  </a>
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={!orgId || busy === p.id || inStock(p)}
                    title={!orgId ? "Sign in to a team to add parts to its inventory" : undefined}
                    onClick={() => void addToInventory(p)}
                  >
                    {busy === p.id ? "Adding…" : inStock(p) ? "In inventory" : "Add to inventory"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <footer className="pc-foot app-muted">
        No prices here on purpose — the vendor page is the price. Part numbers are shown only where they are certain;
        otherwise the vendor link searches by name. Think something is wrong or missing? Tell{" "}
        <a href="mailto:sahiljpatel2011@gmail.com">sahiljpatel2011@gmail.com</a>.
      </footer>
    </main>
  );
}
