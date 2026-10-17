import { describe, expect, it } from "vitest";
import { checkoutBreakdown, groupIntoCarts, parseUsd, shareExtras, vendorKey, type CartSourceOrder } from "./vendor-carts-model";

const order = (id: string, over: Partial<CartSourceOrder> = {}): CartSourceOrder => ({
  id,
  title: id,
  vendor: "REV Robotics",
  vendorId: "v-rev",
  quantity: 1,
  totalCostUsd: 10,
  costSource: "requester-estimate",
  status: "approved",
  vendorOrderId: null,
  itemUrl: null,
  requestedByName: null,
  neededBy: null,
  ...over,
});

describe("vendor carts", () => {
  it("groups approved, unbought requests one cart per vendor, most urgent first", () => {
    const carts = groupIntoCarts([
      order("a", { totalCostUsd: 12.5 }),
      order("b", { totalCostUsd: 7.25 }),
      order("c", { vendor: "McMaster-Carr", vendorId: "v-mc", neededBy: "2026-10-20" }),
      order("d", { status: "pending" }),
      order("e", { vendorOrderId: "already-bought" }),
      order("f", { vendorId: null, vendor: "  Local hardware " }),
      order("g", { vendorId: null, vendor: "local HARDWARE", costSource: "unpriced", totalCostUsd: 0 }),
    ]);
    expect(carts.map((cart) => [cart.vendorName, cart.lines.map((line) => line.orderId)])).toEqual([
      ["McMaster-Carr", ["c"]],
      ["REV Robotics", ["a", "b"]],
      ["Local hardware", ["f", "g"]],
    ]);
    expect(carts[1]!.expectedUsd).toBe(19.75);
    expect(carts[2]!.lines[1]!.unpriced).toBe(true);
    expect(vendorKey(null, " Local Hardware")).toBe(vendorKey(null, "local hardware"));
  });

  it("shares shipping and tax by what each line cost, and the shares add up to the cent", () => {
    const shares = shareExtras(
      [
        { orderId: "a", paidCents: 1000 },
        { orderId: "b", paidCents: 1000 },
        { orderId: "c", paidCents: 1000 },
      ],
      100,
    );
    expect([...shares.values()].reduce((sum, cents) => sum + cents, 0)).toBe(100);
    expect([...shares.values()].sort()).toEqual([33, 33, 34]);
    expect(shareExtras([{ orderId: "a", paidCents: 3000 }, { orderId: "b", paidCents: 1000 }], 400)).toEqual(new Map([["a", 300], ["b", 100]]));
    // Every line free (a donated part with paid shipping): split evenly.
    expect(shareExtras([{ orderId: "a", paidCents: 0 }, { orderId: "b", paidCents: 0 }], 999)).toEqual(new Map([["a", 500], ["b", 499]]));
  });

  it("records each line's actual cost and totals that always match the order", () => {
    const result = checkoutBreakdown(
      [
        { orderId: "a", paidUsd: 19.99 },
        { orderId: "b", paidUsd: 5.01 },
      ],
      8.5,
      2.13,
    );
    expect(result.subtotalUsd).toBe(25);
    expect(result.totalUsd).toBe(35.63);
    const actual = [...result.actualByOrder.values()];
    expect(Math.round(actual.reduce((sum, usd) => sum + usd, 0) * 100)).toBe(3563);
    expect(result.actualByOrder.get("a")).toBeGreaterThan(result.actualByOrder.get("b")!);
  });

  it("reads typed dollar amounts and refuses nonsense", () => {
    expect(parseUsd("$1,234.567")).toBe(1234.57);
    expect(parseUsd("")).toBeNull();
    expect(parseUsd("-3")).toBe("invalid");
    expect(parseUsd("abc")).toBe("invalid");
    expect(parseUsd(2_000_000)).toBe("invalid");
  });
});
