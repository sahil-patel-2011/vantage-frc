/**
 * The one way team money is written: "$2,134.75", "$25,000", "-$1,241.76".
 *
 * Cents show whenever there are cents and never otherwise, so "$1,234.5" (a missing zero) and
 * "$2,135" next to "$2,134.75" (the same figure rounded on one tile and not the other) cannot
 * happen: a treasurer adding up a page gets the total printed under it, to the cent. Every money
 * page (costs, Business › Money, part requests, fundraisers, reimbursements, budgets) uses this
 * instead of its own Intl call.
 */

const WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const WITH_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Money held as whole cents (the Business desk and the ledger). */
export function formatUsdCents(cents: number): string {
  if (!Number.isFinite(cents)) return WHOLE.format(0);
  const whole = Math.round(cents);
  // `|| 0` turns -0 into 0, so a refund that nets to nothing never reads "-$0".
  const dollars = whole / 100 || 0;
  return (whole % 100 === 0 ? WHOLE : WITH_CENTS).format(dollars);
}

/** Money held as dollars, from a number or Postgres numeric text ("1234.50"). */
export function formatUsd(dollars: number | string | null | undefined): string {
  const value = typeof dollars === "string" ? Number(dollars) : (dollars ?? 0);
  return formatUsdCents(Number.isFinite(value) ? Math.round(value * 100) : 0);
}
