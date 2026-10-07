/**
 * Hosted copies/recovery/setup workflows are optional and off by default.
 * Enable only for an explicitly authorized deployment with verified allowance.
 * This public boolean lets the browser avoid requests the server will refuse;
 * it contains no credentials and never controls primary scouting saves.
 */
export function hostedBackgroundWorkEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VANTAGE_HOSTED_BACKGROUND_ENABLED === "1";
}
