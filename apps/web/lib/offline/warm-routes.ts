/**
 * Ask the service worker to cache pages (and the scripts and styles they load) for
 * offline use now, instead of waiting for someone to open each one online.
 * Handled by WARM_ROUTES in public/sw.js.
 *
 * Resolves null when no service worker controls the page (development, a first
 * visit before it activates, or a browser without one) or when it does not answer
 * in time — the caller says so rather than claiming the pages are saved.
 */
export type WarmResult = { pages: number; files: number };

export async function warmOfflineRoutes(paths: string[], timeoutMs = 90_000): Promise<WarmResult | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<WarmResult>) => {
      window.clearTimeout(timer);
      const data = event.data;
      resolve(data && typeof data.pages === "number" ? data : null);
    };
    controller.postMessage({ type: "WARM_ROUTES", paths }, [channel.port2]);
  });
}
