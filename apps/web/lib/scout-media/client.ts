/**
 * Browser-safe helpers for scout media (no sharp, no node imports).
 * URL builders and the service-worker media-cache handshake used by the
 * scouting form, the pit photo wall, and sign-out.
 */

export type ScoutMediaVariant = "full" | "thumb";

export function scoutMediaUrl(
  orgId: string,
  clientId: string,
  variant: ScoutMediaVariant = "full",
): string {
  const base = `/api/scouting/media/${encodeURIComponent(clientId)}?orgId=${encodeURIComponent(orgId)}`;
  return variant === "thumb" ? `${base}&variant=thumb` : base;
}

export const SW_MEDIA_MESSAGES = {
  precache: "PRECACHE_MEDIA",
  evict: "EVICT_MEDIA",
  signOut: "SIGN_OUT",
} as const;

async function activeWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active ?? navigator.serviceWorker.controller ?? null;
  } catch {
    return null;
  }
}

/** Ask the SW to warm thumbs/fulls (same-origin /api/scouting/media/* only). */
export async function precacheScoutMedia(urls: string[]): Promise<void> {
  if (!urls.length) return;
  const worker = await activeWorker();
  worker?.postMessage({ type: SW_MEDIA_MESSAGES.precache, urls });
}

/** Drop a deleted photo from the SW media cache so it cannot resurface offline. */
export async function evictScoutMedia(urls: string[]): Promise<void> {
  if (!urls.length) return;
  const worker = await activeWorker();
  worker?.postMessage({ type: SW_MEDIA_MESSAGES.evict, urls });
}

/**
 * Shared-tablet hygiene: on sign-out the SW clears the shell + media caches so
 * the next scout who picks up the device cannot browse the last team's photos.
 */
export async function clearServiceWorkerCachesOnSignOut(): Promise<void> {
  const worker = await activeWorker();
  worker?.postMessage({ type: SW_MEDIA_MESSAGES.signOut });
}
