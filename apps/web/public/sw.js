/* global self, caches, fetch, URL, Response */
/**
 * Vantage offline app shell (CD #10).
 *
 * - Precache `/offline` so cold no-signal navigations (incl. PWA start) boot.
 * - Allowlisted shell routes: network-first document cache, then `/offline`.
 * - Other navigations: network-only; on failure fall back to `/offline`
 *   (never cache non-shell auth HTML).
 * - Never intercept /api/* or Next RSC/Flight requests.
 * - Static assets only in the asset cache. Scout outbox stays in IndexedDB.
 *
 * Route allowlist mirror: apps/web/lib/offline/shell-routes.ts
 */
const ASSET_CACHE = "vantage-assets-v3";
const SHELL_CACHE = "vantage-shell-v3";
const SHELL_URL = "/offline";

const PRECACHE = ["/manifest.webmanifest", "/icon.svg", SHELL_URL];

const SHELL_ROUTES = [
  "/offline",
  "/scouting",
  "/calendar",
  "/team/calendar",
  "/todos",
  "/tasks",
  "/logistics",
];

function isShellPath(pathname) {
  return SHELL_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + "/"),
  );
}

function isRscRequest(request) {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/x-component")) return true;
  if (request.headers.get("RSC") === "1") return true;
  if (request.headers.get("Next-Router-State-Tree")) return true;
  if (request.headers.get("Next-Router-Prefetch")) return true;
  return false;
}

function isStaticAssetPath(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/manifest.webmanifest" ||
    /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?)$/i.test(
      pathname,
    )
  );
}

function hardOfflineHtml() {
  return new Response(
    "<!doctype html><title>Offline</title><p>Vantage is offline. Open the app once online to cache the scout shell.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

async function matchShellFallback() {
  const cache = await caches.open(SHELL_CACHE);
  return (await cache.match(SHELL_URL, { ignoreSearch: true })) || hardOfflineHtml();
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined)));
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(new URL(request.url).pathname));
    if (cached) return cached;
    return matchShellFallback();
  }
}

async function navigateWithShellFallback(request) {
  try {
    return await fetch(request);
  } catch {
    return matchShellFallback();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== ASSET_CACHE && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "WARM_SHELL") {
    event.waitUntil(precacheShell());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  if (isRscRequest(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      isShellPath(url.pathname)
        ? networkFirstShell(request)
        : navigateWithShellFallback(request),
    );
    return;
  }

  if (!isStaticAssetPath(url.pathname)) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (url.pathname.startsWith("/_next/static/") && cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return cached || Response.error();
      }
    }),
  );
});
