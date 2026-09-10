"use client";
import { Button } from "../../components/ui";

import { useState } from "react";

/** CAD → purchase request: need part X without storing any payment instruments. */
export function CadPurchaseRequestPanel({
  orgId,
  defaultTitle,
  defaultWhy,
  onSubmitted,
}: {
  orgId: string;
  defaultTitle: string;
  defaultWhy: string;
  onSubmitted?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({
    title: defaultTitle,
    justification: defaultWhy,
    estimateUsd: "",
    itemUrl: "",
    vendor: "",
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "submit-order",
          title: form.title.trim() || defaultTitle || "CAD part need",
          justification: form.justification.trim() || defaultWhy || "Needed for CAD build.",
          estimateUsd: form.estimateUsd === "" ? 0 : Number(form.estimateUsd),
          quantity: 1,
          itemUrl: form.itemUrl.trim() || null,
          vendor: form.vendor.trim() || "unspecified",
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setNotice(data.error ?? "Could not create purchase request");
        return;
      }
      const ok = "Purchase request submitted — admins notified. Track it on Orders.";
      setNotice(ok);
      onSubmitted?.(ok);
      setForm({ title: "", justification: "", estimateUsd: "", itemUrl: "", vendor: "" });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not create purchase request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: open ? 12 : 0 }}>
        <Button variant="secondary" type="button" aria-pressed={open} onClick={() => { setOpen((v) => !v); setForm((prev) => ({ ...prev, title: prev.title || defaultTitle, justification: prev.justification || defaultWhy, })); }}>
          {open ? "Hide purchase request" : "Need part → order"}
        </Button>
        <Button as="a" variant="secondary" href={`/orders?orgId=${encodeURIComponent(orgId)}`}>
          Open orders
        </Button>
      </div>

      {open ? (
        <section className="app-card soft-panel" aria-label="Create purchase request from CAD">
          <span className="eyebrow">PURCHASE REQUEST</span>
          <h2 style={{ margin: "4px 0 8px" }}>Need part X → create order</h2>
          <p className="app-muted" style={{ marginTop: 0 }}>
            Submits a pending request (what / why / estimate / optional vendor link). Never stores card or bank data.
          </p>
          <form style={{ display: "grid", gap: 10 }} onSubmit={(event) => void submit(event)}>
            <label>
              What you need
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="e.g. 2× NEO 550 motors"
              />
            </label>
            <label>
              Why
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={form.justification}
                onChange={(e) => setForm((p) => ({ ...p, justification: e.target.value }))}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
              <label>
                Estimate ($)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.estimateUsd}
                  onChange={(e) => setForm((p) => ({ ...p, estimateUsd: e.target.value }))}
                />
              </label>
              <label>
                Vendor
                <input
                  value={form.vendor}
                  onChange={(e) => setForm((p) => ({ ...p, vendor: e.target.value }))}
                  placeholder="REV / WCP"
                />
              </label>
              <label>
                Product URL
                <input
                  type="url"
                  value={form.itemUrl}
                  onChange={(e) => setForm((p) => ({ ...p, itemUrl: e.target.value }))}
                  placeholder="https://"
                />
              </label>
            </div>
            {notice ? <p className="telemetry-status">{notice}</p> : null}
            <Button variant="primary" type="submit" disabled={busy}>
              Submit purchase request
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
