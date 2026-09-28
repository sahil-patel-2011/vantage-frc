import { putFeatureSnapshot } from "../offline/feature-cache";

/** Keep the authenticated person's last readable scouting copy without blocking live UI. */
export async function persistScoutingSnapshot<T>(orgId: string, data: T): Promise<void> {
  if (!orgId) return;
  try {
    await putFeatureSnapshot("scouting", orgId, data);
    await putFeatureSnapshot("scouting", "_", data);
  } catch {
    // Live scouting is already available. Collection's durable outbox reports its
    // own storage failures rather than claiming this best-effort copy was saved.
  }
}
