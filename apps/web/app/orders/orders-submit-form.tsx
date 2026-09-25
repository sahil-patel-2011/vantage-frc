"use client";

import { useEffect, useState, type FormEvent } from "react";
import { validateBuySheet } from "../../lib/finance/buy-sheet";
import { hubHref } from "../../lib/nav/hubs";

/*
  "Log a purchase" on Orders. Split from orders-client.tsx when adding a vendor by name
  took that file past the line limit.
*/

type DirectoryVendor = { id: string; name: string; preferred: boolean };

/** The select value for "New vendor…"; never a real vendor id (those are uuids). */
const NEW_VENDOR = "__new__";

class VendorError extends Error {}
type CatalogItem = { id: string; name: string };

const CATALOG_ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Catalog rows from /api/inventory. Empty or malformed payloads stay empty — never invent an id. */
function catalogItemsFromInventory(data: unknown): CatalogItem[] {
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const catalog: CatalogItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { id?: unknown; name?: unknown; archived?: unknown };
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!CATALOG_ITEM_ID.test(id)) continue;
    if (raw.archived === true) continue;
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : id;
    catalog.push({ id, name });
  }
  return catalog;
}

export function SubmitForm({
  orgId,
  seasonYear,
  busy,
  setBusy,
  setError,
  onCreated,
}: {
  orgId: string;
  seasonYear: number;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  onCreated: () => void;
}) {
  const [vendors, setVendors] = useState<DirectoryVendor[]>([]);
  const [vendorsReady, setVendorsReady] = useState(false);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  // "New vendor" in the select: a name typed here goes into the directory on submit. The form
  // used to refuse every purchase until someone had filled in the directory on another page.
  const [vendorChoice, setVendorChoice] = useState("");
  // Shown by the button that was pressed, not at the top of the page.
  const [formError, setFormError] = useState("");
  const directoryHref = hubHref("/business", "vendors", orgId);
  const addingVendor = vendorsReady && (vendors.length === 0 || vendorChoice === NEW_VENDOR);

  useEffect(() => {
    let cancelled = false;
    setVendorsReady(false);
    setCatalogItems([]);
    void fetch(`/api/vendors?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        const data = (await response.json()) as {
          status?: string;
          vendors?: DirectoryVendor[];
        };
        if (cancelled) return;
        setVendors(
          data.status === "live" && Array.isArray(data.vendors)
            ? data.vendors.map((vendor) => ({
                id: vendor.id,
                name: vendor.name,
                preferred: Boolean(vendor.preferred),
              }))
            : [],
        );
      })
      .catch(() => {
        if (!cancelled) setVendors([]);
      })
      .finally(() => {
        if (!cancelled) setVendorsReady(true);
      });
    void fetch(`/api/inventory?orgId=${encodeURIComponent(orgId)}`)
      .then(async (response) => {
        const data = response.ok ? await response.json() : null;
        if (!cancelled) setCatalogItems(catalogItemsFromInventory(data));
      })
      .catch(() => {
        if (!cancelled) setCatalogItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const sheet = validateBuySheet({
      title: data.title,
      justification: data.justification,
      neededBy: data.neededBy,
      estimateUsd: data.estimateUsd,
    });
    if (!sheet.ok) {
      setFormError(sheet.error);
      return;
    }
    if (!addingVendor && !vendorChoice) {
      setFormError("Pick a vendor, or choose New vendor… and type its name.");
      return;
    }
    const newVendorName = typeof data.newVendor === "string" ? data.newVendor.trim() : "";
    if (addingVendor && !newVendorName) {
      setFormError("Type the vendor's name, for example AndyMark.");
      return;
    }
    setBusy(true);
    setFormError("");
    setError("");
    const catalogId =
      typeof data.inventoryItemId === "string"
        ? catalogItems.find((item) => item.id === data.inventoryItemId)?.id
        : undefined;
    void resolveVendorId(addingVendor ? newVendorName : null, String(data.vendorId ?? ""))
      .then((vendorId) =>
        fetch("/api/finance/purchase-requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            seasonYear,
            title: sheet.value.title,
            justification: sheet.value.justification,
            estimateUsd: sheet.value.costUsd,
            vendorId,
            itemUrl: data.itemUrl,
            neededBy: sheet.value.neededBy ?? undefined,
            ...(catalogId ? { inventoryItemId: catalogId } : {}),
          }),
        }),
      )
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; request?: unknown };
        if (!response.ok || !payload.request) {
          setFormError(payload.error ?? "Choose a vendor from the vendor directory.");
          return;
        }
        form.reset();
        setVendorChoice("");
        onCreated();
      })
      .catch((error: unknown) =>
        setFormError(error instanceof VendorError ? error.message : "Network error — please try again."),
      )
      .finally(() => setBusy(false));
  };

  /** The chosen vendor's id, or the id of the one just added to the directory by name. */
  async function resolveVendorId(newName: string | null, chosen: string): Promise<string> {
    if (!newName) return chosen;
    const existing = vendors.find((vendor) => vendor.name.toLowerCase() === newName.toLowerCase());
    if (existing) return existing.id;
    const response = await fetch("/api/vendors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "create-vendor", name: newName }),
    });
    const view = (await response.json()) as { error?: string; vendors?: DirectoryVendor[] };
    const made = view.vendors?.find((vendor) => vendor.name.toLowerCase() === newName.toLowerCase());
    if (!response.ok || !made) throw new VendorError(view.error ?? "Could not add that vendor.");
    setVendors((current) => [...current, { id: made.id, name: made.name, preferred: Boolean(made.preferred) }]);
    return made.id;
  }

  return (
    <section className="soft-panel">
      <span className="biz-overline">Add a line</span>
      <h2>Log a purchase</h2>
      <p className="orders-form-lead">
        What, why, when you need it, and the cost. Mentors approve; pay on the vendor site — never paste card or bank
        numbers.
      </p>
      <form className="orders-form" onSubmit={onSubmit}>
        <label>
          What
          <input name="title" required maxLength={200} placeholder='e.g. 1/2" hex shaft stock' />
        </label>
        <label>
          Why
          <textarea
            name="justification"
            required
            maxLength={2000}
            placeholder="Subsystem, event, or spare — never paste card or bank numbers"
          />
        </label>
        <div className="orders-form-grid">
          <label>
            When <small>needed by, optional</small>
            <input name="neededBy" type="date" />
          </label>
          <label>
            Cost ($)
            <input name="estimateUsd" type="number" min={0} step="0.01" required placeholder="42.00" />
          </label>
          {vendors.length > 0 ? (
            <label>
              Vendor <small>required</small>
              <select
                name="vendorId"
                aria-invalid={formError.startsWith("Pick a vendor") || undefined}
                disabled={!vendorsReady}
                value={vendorChoice}
                onChange={(event) => setVendorChoice(event.target.value)}
              >
                <option value="" disabled>
                  {vendorsReady ? "Choose a vendor" : "Loading vendors…"}
                </option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.preferred ? `${vendor.name} (preferred)` : vendor.name}
                  </option>
                ))}
                <option value={NEW_VENDOR}>New vendor…</option>
              </select>
            </label>
          ) : null}
          {addingVendor ? (
            <label>
              {vendors.length ? "New vendor" : "Vendor"} <small>added to your <a href={directoryHref}>vendor list</a></small>
              <input name="newVendor" required maxLength={200} placeholder="e.g. AndyMark" autoComplete="off" />
            </label>
          ) : null}
          <label>
            Buy link <small>optional product URL</small>
            <input name="itemUrl" type="url" placeholder="https://…" />
          </label>
          {catalogItems.length > 0 ? (
            <label>
              Restock inventory <small>optional — receive writes stock</small>
              <select name="inventoryItemId" defaultValue="">
                <option value="">None — skip stock receive</option>
                {catalogItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {formError ? (
          <p className="orders-error" role="alert">
            {formError}
          </p>
        ) : null}
        <button type="submit" className="orders-submit" disabled={busy || !vendorsReady}>
          Add to buy sheet
        </button>
      </form>
    </section>
  );
}
