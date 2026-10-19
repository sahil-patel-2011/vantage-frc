// Vendor carts (0738) — pure shapes and money math, safe to import from client code.
//
// Approved requests that haven't been bought yet, grouped one cart per vendor.
// Checking a cart out records what each line actually cost: its own price plus a
// share of the order's shipping and tax. All money is handled in whole cents so
// the lines always add up to the order total exactly.

export type CartLine = {
  orderId: string;
  title: string;
  quantity: number;
  /** The approved figure (requester's estimate or the mentor's price). */
  expectedUsd: number;
  /** Nobody has priced it yet: the expected zero is a placeholder, not a free part. */
  unpriced: boolean;
  itemUrl: string | null;
  requestedByName: string | null;
  neededBy: string | null;
};

export type VendorCart = {
  key: string;
  vendorId: string | null;
  vendorName: string;
  lines: CartLine[];
  expectedUsd: number;
  /** Earliest needed-by among the lines, so the most urgent cart reads first. */
  neededBy: string | null;
};

export type PlacedVendorOrder = {
  id: string;
  vendorName: string;
  orderNumber: string | null;
  subtotalUsd: number;
  shippingUsd: number;
  taxUsd: number;
  totalUsd: number;
  placedAt: string;
  placedByName: string | null;
  lines: Array<{ orderId: string; title: string; status: string; expectedUsd: number; actualUsd: number | null }>;
};

export type VendorCartsView =
  | { status: "setup_required"; reason: "no_team" | "migration"; message: string; orgId: string | null }
  | {
      status: "live";
      orgId: string;
      seasonYear: number;
      /** Finance manager (0714): only they check out a cart or record what something cost. */
      canPlace: boolean;
      carts: VendorCart[];
      placed: PlacedVendorOrder[];
      computedAt: string;
    };

export type CartSourceOrder = {
  id: string;
  title: string;
  vendor: string;
  vendorId: string | null;
  quantity: number;
  totalCostUsd: number;
  costSource: string | null;
  status: string;
  vendorOrderId: string | null;
  itemUrl: string | null;
  requestedByName: string | null;
  neededBy: string | null;
};

/** One cart per vendor: the directory identity when there is one, else the name. */
export function vendorKey(vendorId: string | null, vendorName: string): string {
  return vendorId ? `id:${vendorId}` : `name:${vendorName.trim().toLowerCase()}`;
}

export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Approved, not yet bought, grouped by vendor; the most urgent and biggest carts first. */
export function groupIntoCarts(orders: readonly CartSourceOrder[]): VendorCart[] {
  const carts = new Map<string, VendorCart>();
  for (const order of orders) {
    if (order.status !== "approved" || order.vendorOrderId) continue;
    const key = vendorKey(order.vendorId, order.vendor);
    const cart = carts.get(key) ?? { key, vendorId: order.vendorId, vendorName: order.vendor.trim() || "No vendor", lines: [], expectedUsd: 0, neededBy: null };
    cart.lines.push({
      orderId: order.id,
      title: order.title,
      quantity: order.quantity,
      expectedUsd: order.totalCostUsd,
      unpriced: order.costSource === "unpriced",
      itemUrl: order.itemUrl,
      requestedByName: order.requestedByName,
      neededBy: order.neededBy,
    });
    cart.expectedUsd = fromCents(toCents(cart.expectedUsd) + toCents(order.totalCostUsd));
    if (order.neededBy && (!cart.neededBy || order.neededBy < cart.neededBy)) cart.neededBy = order.neededBy;
    carts.set(key, cart);
  }
  return [...carts.values()].sort(
    (a, b) => (a.neededBy ?? "9999").localeCompare(b.neededBy ?? "9999") || b.expectedUsd - a.expectedUsd || a.vendorName.localeCompare(b.vendorName),
  );
}

/**
 * Shares `extraCents` (shipping + tax) across lines in proportion to what each line cost,
 * or evenly when every line cost nothing. Largest remainder, so the shares add up exactly.
 */
export function shareExtras(lines: ReadonlyArray<{ orderId: string; paidCents: number }>, extraCents: number): Map<string, number> {
  const shares = new Map<string, number>();
  if (!lines.length) return shares;
  const weights = lines.map((line) => Math.max(0, line.paidCents));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = lines.map((_, index) => (totalWeight > 0 ? (extraCents * weights[index]!) / totalWeight : extraCents / lines.length));
  const floors = exact.map((value) => Math.floor(value));
  let remainder = extraCents - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - floors[index]! })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    floors[index]! += 1;
    remainder -= 1;
  }
  lines.forEach((line, index) => shares.set(line.orderId, floors[index]!));
  return shares;
}

export type CheckoutLine = { orderId: string; paidUsd: number };

/** What each line actually cost (its price plus its share of shipping and tax), and the order's totals. */
export function checkoutBreakdown(lines: readonly CheckoutLine[], shippingUsd: number, taxUsd: number) {
  const paid = lines.map((line) => ({ orderId: line.orderId, paidCents: toCents(line.paidUsd) }));
  const subtotalCents = paid.reduce((sum, line) => sum + line.paidCents, 0);
  const shippingCents = toCents(shippingUsd);
  const taxCents = toCents(taxUsd);
  const shares = shareExtras(paid, shippingCents + taxCents);
  return {
    subtotalUsd: fromCents(subtotalCents),
    shippingUsd: fromCents(shippingCents),
    taxUsd: fromCents(taxCents),
    totalUsd: fromCents(subtotalCents + shippingCents + taxCents),
    actualByOrder: new Map(paid.map((line) => [line.orderId, fromCents(line.paidCents + (shares.get(line.orderId) ?? 0))])),
  };
}

/** A typed dollar amount: blank is null, anything else must be 0 to 1,000,000 with at most cents. */
export function parseUsd(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return "invalid";
  return Math.round(n * 100) / 100;
}
