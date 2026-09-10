import { enqueueOutboxItem, newOutboxClientId, type OutboxFeature } from "./outbox";

/** Shown next to the field after a write is stored on the device. */
export const QUEUED_ON_DEVICE = "Saved on this device. It will upload when you are back online.";

export function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export async function queueProductWrite(input: {
  feature: OutboxFeature;
  orgId: string;
  payload: Record<string, unknown>;
}) {
  return enqueueOutboxItem({
    clientId: newOutboxClientId(),
    feature: input.feature,
    orgId: input.orgId,
    payload: input.payload,
  });
}
