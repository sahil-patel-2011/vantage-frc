/** A 0–1 ratio as a whole percent, e.g. `0.456` → `"46%"`. */
export function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
