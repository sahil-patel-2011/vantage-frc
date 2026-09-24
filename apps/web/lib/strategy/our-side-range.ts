/**
 * A stored prediction's confidence interval is about the RED alliance winning
 * (packages/prediction-strategy/src/alliance-outcome.ts: pRed ± interval). The headline win %
 * is shown from our side, so a blue team read "77% win probability · typical range 14–32%":
 * the range was red's. Flip it for blue so the range brackets the number above it.
 */
export function ourSideRange(
  low: number | null | undefined,
  high: number | null | undefined,
  side: "red" | "blue" | null | undefined,
): { low: number; high: number } | null {
  if (typeof low !== "number" || typeof high !== "number" || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (side === "blue") return { low: 1 - high, high: 1 - low };
  if (side === "red") return { low, high };
  return null;
}
