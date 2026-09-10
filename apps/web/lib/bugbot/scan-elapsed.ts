/**
 * Wall-clock elapsed time for a Bugbot pass. The UI prints this from
 * Date.now() around the chunk loop — never a stored or invented duration.
 */

export type BugbotBillingMode = "subscription" | "ultra";

/** Human scan duration, or empty when the clock was not started. */
export function formatScanElapsed(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  const totalSeconds = Math.round(elapsedMs / 1000);
  if (totalSeconds < 1) return "under 1s";
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
}

/**
 * One billing footnote after a scan/fix/recheck. Ultra names the charge;
 * subscription names the team's keys or plan — never "BYO" or a feature id.
 */
export function bugbotBilledNote(mode: BugbotBillingMode | undefined, chargeUsd?: number): string {
  return mode === "ultra" && chargeUsd
    ? ` Charged $${Number(chargeUsd).toFixed(2)} Bugbot Ultra.`
    : " Uses your team's keys or plan allowance.";
}

/** Suffix for the Bugbot header after a completed pass. */
export function bugbotScanMetaLine(meta: {
  provider?: string | null;
  model?: string | null;
  filesScanned?: number;
  elapsedMs?: number;
}): string {
  const parts: string[] = [];
  if (meta.model) {
    const who = [meta.provider, meta.model].filter(Boolean).join("/");
    if (who) parts.push(who);
  }
  if (typeof meta.filesScanned === "number" && Number.isFinite(meta.filesScanned)) {
    const count = Math.max(0, Math.round(meta.filesScanned));
    parts.push(`${count} file${count === 1 ? "" : "s"}`);
  }
  if (typeof meta.elapsedMs === "number") {
    const elapsed = formatScanElapsed(meta.elapsedMs);
    if (elapsed) parts.push(elapsed);
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}
