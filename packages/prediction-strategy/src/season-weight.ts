/** Season recency weights for weighted-current-v1 (current / prior / two-back). */
export function seasonWeight(currentYear: number, year: number) {
  const age = currentYear - year;
  if (age < 0 || age > 2) return 0;
  return age === 0 ? 1 : age === 1 ? 0.55 : 0.3;
}
