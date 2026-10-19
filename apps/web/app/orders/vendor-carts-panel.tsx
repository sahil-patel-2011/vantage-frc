"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { formatUsd } from "../../lib/finance/format-usd";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { checkoutBreakdown, parseUsd, type PlacedVendorOrder, type VendorCart, type VendorCartsView } from "../../lib/orders/vendor-carts-model";
import { friendlyErrorMessage } from "../../lib/ui/friendly-error";

type LiveCarts = Extract<VendorCartsView, { status: "live" }>;

/**
 * Buy by vendor: approved requests that haven't been bought, one cart per vendor. A finance
 * manager checks a cart out once they've paid on the vendor's site, entering what each item cost
 * plus shipping and tax; each request then records what it actually cost and the budget counts
 * that. Hidden until database update 0738 is applied, and when there's nothing to show.
 */
export function VendorCartsPanel({
  orgId,
  seasonYear,
  refreshKey,
  onChanged,
}: {
  orgId: string;
  seasonYear: number;
  /** Changes whenever the buy sheet reloads, so approvals show up as cart lines. */
  refreshKey: string;
  onChanged: () => void;
}) {
  const [view, setView] = useState<LiveCarts | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/orders/carts?${new URLSearchParams({ orgId, season: String(seasonYear) })}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json().catch(() => null)) as VendorCartsView | null;
        if (live) setView(response.ok && data?.status === "live" ? data : null);
      } catch {
        // The buy sheet itself still works; carts just stay hidden this time.
      }
    })();
    return () => {
      live = false;
    };
  }, [orgId, seasonYear, refreshKey]);

  const send = useCallback(
    async (payload: Record<string, unknown>): Promise<boolean> => {
      setBusy(true);
      setProblem(null);
      try {
        const response = await fetch("/api/orders/carts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json().catch(() => null)) as VendorCartsView | { error?: string } | null;
        if (!response.ok || !data || !("status" in data) || data.status !== "live") {
          setProblem((data && "error" in data && data.error) || "That didn't go through. Try again.");
          return false;
        }
        setView(data);
        onChanged();
        return true;
      } catch (error) {
        setProblem(friendlyErrorMessage(error, "That didn't go through. Try again."));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [orgId, seasonYear, onChanged],
  );

  if (!view || (!view.carts.length && !view.placed.length)) return null;

  return (
    <section className="soft-panel orders-carts" aria-labelledby="orders-carts-title">
      <h2 id="orders-carts-title">Buy by vendor</h2>
      {problem ? <p className="telemetry-status" role="alert">{problem}</p> : null}
      {view.carts.length ? (
        <ul className="orders-cart-list">
          {view.carts.map((cart) => (
            <CartCard key={cart.key} cart={cart} canPlace={view.canPlace} busy={busy} send={send} />
          ))}
        </ul>
      ) : (
        <p className="app-muted">Nothing approved is waiting to be bought.</p>
      )}
      {view.placed.length ? <PlacedOrders placed={view.placed} canPlace={view.canPlace} busy={busy} send={send} /> : null}
    </section>
  );
}

function CartCard({
  cart,
  canPlace,
  busy,
  send,
}: {
  cart: VendorCart;
  canPlace: boolean;
  busy: boolean;
  send: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="orders-cart">
      <div className="orders-cart-head">
        <strong>{cart.vendorName}</strong>
        <span className="app-muted">
          {cart.lines.length} item{cart.lines.length === 1 ? "" : "s"} · about {formatUsd(cart.expectedUsd)}
          {cart.neededBy ? ` · needed by ${cart.neededBy}` : ""}
        </span>
        {canPlace && !open ? (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => setOpen(true)}>
            Check out
          </Button>
        ) : null}
      </div>
      {open ? (
        <Checkout cart={cart} busy={busy} send={send} onClose={() => setOpen(false)} />
      ) : (
        <ul className="orders-cart-lines">
          {cart.lines.map((line) => (
            <li key={line.orderId}>
              {line.itemUrl ? (
                <a href={line.itemUrl} target="_blank" rel="noreferrer">{line.title}</a>
              ) : (
                <span>{line.title}</span>
              )}
              <span className="app-muted">
                {line.quantity > 1 ? `${line.quantity} × · ` : ""}
                {line.unpriced ? "not priced yet" : formatUsd(line.expectedUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Checkout({
  cart,
  busy,
  send,
  onClose,
}: {
  cart: VendorCart;
  busy: boolean;
  send: (payload: Record<string, unknown>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [paid, setPaid] = useState<Record<string, string>>(() =>
    Object.fromEntries(cart.lines.map((line) => [line.orderId, line.unpriced ? "" : line.expectedUsd.toFixed(2)])),
  );
  const [shipping, setShipping] = useState("");
  const [tax, setTax] = useState("");
  const [orderNumber, setOrderNumber] = useState("");

  const parsed = useMemo(() => {
    const lines = cart.lines.map((line) => ({ orderId: line.orderId, value: parseUsd(paid[line.orderId]) }));
    const shippingValue = parseUsd(shipping);
    const taxValue = parseUsd(tax);
    const ready = lines.every((line) => typeof line.value === "number") && shippingValue !== "invalid" && taxValue !== "invalid";
    const breakdown = ready
      ? checkoutBreakdown(
          lines.map((line) => ({ orderId: line.orderId, paidUsd: line.value as number })),
          (shippingValue as number | null) ?? 0,
          (taxValue as number | null) ?? 0,
        )
      : null;
    return { lines, breakdown };
  }, [cart.lines, paid, shipping, tax]);

  return (
    <form
      className="orders-checkout"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!parsed.breakdown) return;
        const ok = await send({
          action: "place-order",
          lines: parsed.lines.map((line) => ({ orderId: line.orderId, paidUsd: line.value })),
          shippingUsd: shipping,
          taxUsd: tax,
          orderNumber,
        });
        if (ok) onClose();
      }}
    >
      <p className="app-muted">Pay on {cart.vendorName}'s site first, then enter what it came to. Each request records its share of shipping and tax.</p>
      <ul className="orders-checkout-lines">
        {cart.lines.map((line) => (
          <li key={line.orderId}>
            <label>
              <span>{line.title}</span>
              <input
                inputMode="decimal"
                aria-label={`What ${line.title} cost`}
                placeholder={line.unpriced ? "Price" : line.expectedUsd.toFixed(2)}
                value={paid[line.orderId] ?? ""}
                onChange={(event) => setPaid((current) => ({ ...current, [line.orderId]: event.target.value }))}
              />
            </label>
          </li>
        ))}
      </ul>
      <div className="orders-checkout-extras">
        <label>
          Shipping
          <input inputMode="decimal" placeholder="0.00" value={shipping} onChange={(event) => setShipping(event.target.value)} />
        </label>
        <label>
          Tax
          <input inputMode="decimal" placeholder="0.00" value={tax} onChange={(event) => setTax(event.target.value)} />
        </label>
        <label>
          Order number
          <input placeholder="Optional" maxLength={120} value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} />
        </label>
      </div>
      <div className="orders-checkout-foot">
        <strong>{parsed.breakdown ? `Total ${formatUsd(parsed.breakdown.totalUsd)}` : "Enter what each item cost"}</strong>
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={busy || !parsed.breakdown}>
          {busy ? "Saving…" : "Record order"}
        </Button>
      </div>
    </form>
  );
}

function PlacedOrders({
  placed,
  canPlace,
  busy,
  send,
}: {
  placed: PlacedVendorOrder[];
  canPlace: boolean;
  busy: boolean;
  send: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <details className="orders-placed">
      <summary>Bought this season ({placed.length})</summary>
      <ul>
        {placed.map((order) => {
          const waiting = order.lines.filter((line) => line.status === "ordered").length;
          const expected = order.lines.reduce((sum, line) => sum + line.expectedUsd, 0);
          return (
            <li key={order.id}>
              <div className="orders-placed-head">
                <strong>{order.vendorName}</strong>
                <span>{formatUsd(order.totalUsd)}</span>
                <span className="app-muted">
                  {order.placedAt.slice(0, 10)}
                  {order.placedByName ? ` · ${order.placedByName}` : ""}
                  {order.orderNumber ? ` · #${order.orderNumber}` : ""}
                  {Math.abs(order.totalUsd - expected) >= 0.01 ? ` · expected ${formatUsd(expected)}` : ""}
                </span>
                {canPlace && waiting ? (
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void send({ action: "receive-order", vendorOrderId: order.id })}>
                    Mark all received
                  </Button>
                ) : null}
              </div>
              <ul className="orders-cart-lines">
                {order.lines.map((line) => (
                  <li key={line.orderId}>
                    <span>{line.title}</span>
                    <span className="app-muted">
                      {line.actualUsd == null ? "" : formatUsd(line.actualUsd)}
                      {line.status === "ordered" ? " · on its way" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** On a bought request with no recorded cost: a finance manager types what it actually came to. */
export function RecordActualCost({ busy, onSave }: { busy: boolean; onSave: (actualUsd: number) => void }) {
  const [value, setValue] = useState("");
  const parsed = parseUsd(value);
  return (
    <form
      className="orders-record-actual"
      onSubmit={(event) => {
        event.preventDefault();
        if (typeof parsed !== "number") return;
        onSave(parsed);
        setValue("");
      }}
    >
      <label>
        What it actually cost
        <input inputMode="decimal" placeholder="Incl. shipping and tax" value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={busy || typeof parsed !== "number"}>Save</Button>
    </form>
  );
}
