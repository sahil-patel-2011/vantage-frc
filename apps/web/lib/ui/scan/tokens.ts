/** Scan polish tokens — keep in lockstep with `app/vantage-scan.css`. */

export const SCAN_NAVY = "#0d3560";
export const SCAN_NAVY_DEEP = "#092848";
export const SCAN_NAVY_SOFT = "#e7eef6";
export const SCAN_GOLD = "#e8b923";
export const SCAN_GOLD_INK = "#14243a";
export const SCAN_RAIL = "#0d3560";

export const SCAN_CSS_VARS = [
  "--scan-navy",
  "--scan-navy-deep",
  "--scan-navy-soft",
  "--scan-gold",
  "--scan-gold-ink",
  "--scan-rail",
  "--scan-rail-ink",
  "--scan-radius",
  "--scan-title",
  "--scan-stack",
] as const;

export const SCAN_HUB_CLASS = (hub: string) => `scan-hub--${hub}`;

export type ScanBand = "a" | "b" | "c";

export type ScanRailState = "done" | "current" | "upcoming";

export function scanRailState(index: number, currentIndex: number): ScanRailState {
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "current";
  return "upcoming";
}
