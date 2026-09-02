/* global self, caches, clients */
/**
 * Vantage offline app shell (CD #10).
 *
 * - Precache `/offline` so cold no-signal navigations (incl. PWA start) boot.
 * - Allowlisted shell routes: network-first document cache, then `/offline`.
 * - Other navigations: network-only; on failure fall back to `/offline`
 *   (never cache non-shell auth HTML).
 * - Never intercept /api/* or Next RSC/Flight requests — with ONE explicit
 *   exception: GET /api/scouting/media/<clientId>[?variant=thumb] (pit photo
 *   bytes) is cache-first + revalidate in MEDIA_CACHE, count/byte-trimmed.
 * - Static assets only in the asset cache. Scout outbox stays in IndexedDB.
 * - SIGN_OUT clears the shell + media caches so a shared tablet never shows
 *   the previous team's photos to the next scout.
 *
 * Route allowlist mirror: apps/web/lib/offline/shell-routes.ts
 * Media message contract: apps/web/lib/scout-media/client.ts
 */
// Bump all three on any release that changes the shell or its assets: `activate`
// deletes every cache whose key is not one of these, so a version bump is what
// forces a returning installed client off the previous release's cached UI.
const ASSET_CACHE = "vantage-assets-v6";
const SHELL_CACHE = "vantage-shell-v6";
const MEDIA_CACHE = "vantage-media-v1";
const SHELL_URL = "/offline";

// Media cache budget — a weekend's worth of pit thumbs, not a photo archive.
const MEDIA_MAX_ENTRIES = 150;
const MEDIA_MAX_BYTES = 60 * 1024 * 1024;

const PRECACHE = ["/manifest.webmanifest", "/icon.svg", SHELL_URL];

const SHELL_ROUTES = [
  "/offline",
  "/offline-shell",
  "/scouting",
  "/schedule",
  "/competition",
  "/calendar",
  "/team/calendar",
  "/team",
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

/* ---------------------------------------------------------------------------
 * Scout media cache — the only /api path this worker ever touches.
 * Allow-list: GET /api/scouting/media/<clientId>?orgId=…[&variant=thumb].
 * Anything else under /api (including /media/list) stays network-only.
 * ------------------------------------------------------------------------- */

function isScoutMediaUrl(url) {
  if (url.origin !== self.location.origin) return false;
  const match = /^\/api\/scouting\/media\/([^/]+)$/.exec(url.pathname);
  if (!match || match[1] === "list") return false;
  if (!url.searchParams.get("orgId")) return false;
  for (const key of url.searchParams.keys()) {
    if (key !== "orgId" && key !== "variant") return false;
  }
  const variant = url.searchParams.get("variant");
  return variant === null || variant === "thumb";
}

function isCacheableMediaResponse(response) {
  return Boolean(response) && response.status === 200 && response.type === "basic";
}

function isGoneStatus(status) {
  return status === 401 || status === 403 || status === 404 || status === 410;
}

/**
 * Simple insertion-order trim: Cache.keys() returns entries oldest-first, so
 * dropping from the front approximates LRU without bookkeeping. Sizes come
 * from content-length (set by the route) — no bodies are read.
 */
async function trimMediaCache(cache) {
  const keys = await cache.keys();
  const sizes = [];
  let total = 0;
  for (const key of keys) {
    const cached = await cache.match(key);
    const size = cached ? Number(cached.headers.get("content-length")) || 0 : 0;
    sizes.push(size);
    total += size;
  }
  let index = 0;
  while (index < keys.length && (keys.length - index > MEDIA_MAX_ENTRIES || total > MEDIA_MAX_BYTES)) {
    await cache.delete(keys[index]);
    total -= sizes[index];
    index += 1;
  }
}

function conditionalMediaRequest(url, cached) {
  const headers = new Headers();
  const etag = cached && cached.headers.get("etag");
  if (etag) headers.set("if-none-match", etag);
  return new Request(url, { credentials: "same-origin", headers });
}

async function revalidateMedia(cache, url, cached) {
  const response = await fetch(conditionalMediaRequest(url, cached));
  if (response.status === 304 && cached) return cached;
  if (isCacheableMediaResponse(response)) {
    await cache.put(url, response.clone());
    await trimMediaCache(cache);
    return response;
  }
  if (isGoneStatus(response.status)) await cache.delete(url);
  return response;
}

/** Cache-first: serve the stored copy immediately, revalidate (ETag) in the background. */
async function mediaCacheFirst(event, request) {
  const url = new URL(request.url).href;
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(url);
  if (cached) {
    event.waitUntil(revalidateMedia(cache, url, cached).catch(() => undefined));
    return cached;
  }
  try {
    return await revalidateMedia(cache, url, null);
  } catch {
    return Response.error();
  }
}

async function precacheMedia(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  const cache = await caches.open(MEDIA_CACHE);
  for (const raw of urls.slice(0, MEDIA_MAX_ENTRIES)) {
    try {
      const url = new URL(String(raw), self.location.origin);
      if (!isScoutMediaUrl(url)) continue;
      if (await cache.match(url.href)) continue;
      const response = await fetch(new Request(url.href, { credentials: "same-origin" }));
      if (isCacheableMediaResponse(response)) await cache.put(url.href, response);
    } catch {
      // Best effort — the wall still loads from the network when it can.
    }
  }
  await trimMediaCache(cache);
}

async function evictMedia(urls) {
  if (!Array.isArray(urls) || !urls.length) return;
  const cache = await caches.open(MEDIA_CACHE);
  for (const raw of urls) {
    try {
      const url = new URL(String(raw), self.location.origin);
      if (isScoutMediaUrl(url)) await cache.delete(url.href);
    } catch {
      // ignore malformed
    }
  }
}

/** Shared-tablet hygiene: drop the private caches, keep the immutable asset cache. */
async function clearPrivateCaches() {
  await Promise.all([caches.delete(SHELL_CACHE), caches.delete(MEDIA_CACHE)]);
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
            .filter((key) => key !== ASSET_CACHE && key !== SHELL_CACHE && key !== MEDIA_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "WARM_SHELL") event.waitUntil(precacheShell());
  else if (data.type === "PRECACHE_MEDIA") event.waitUntil(precacheMedia(data.urls));
  else if (data.type === "EVICT_MEDIA") event.waitUntil(evictMedia(data.urls));
  else if (data.type === "SIGN_OUT") event.waitUntil(clearPrivateCaches());
});

/* ---------------------------------------------------------------------------
 * Web Push (the "your match is up in 7 minutes" ping).
 *
 * Payload contract — server side is apps/web/lib/push/payload.ts:
 *   { title, body?, url?, tag?, type?, urgent? }
 * `url` is always a same-origin path (the server strips anything else).
 * A push MUST show a notification: browsers revoke the subscription from origins
 * that receive a push and stay silent, so the catch path still shows something.
 * ------------------------------------------------------------------------- */

const PUSH_FALLBACK_TITLE = "Vantage";

function readPushPayload(event) {
  if (!event.data) return { title: PUSH_FALLBACK_TITLE };
  try {
    const parsed = event.data.json();
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    const text = event.data.text();
    if (text) return { title: PUSH_FALLBACK_TITLE, body: text };
  }
  return { title: PUSH_FALLBACK_TITLE };
}

function pushNotificationOptions(payload) {
  const urgent = payload.urgent === true;
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: {
      url: typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/",
      type: typeof payload.type === "string" ? payload.type : "",
    },
    // Competition-day pings stay on screen until someone acts on them.
    requireInteraction: urgent,
  };
  if (typeof payload.tag === "string" && payload.tag) {
    options.tag = payload.tag;
    // Same tag = a newer version of the same thing; buzz again rather than replace silently.
    options.renotify = true;
  }
  if (urgent) options.vibrate = [180, 80, 180];
  return options;
}

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : PUSH_FALLBACK_TITLE;
  event.waitUntil(self.registration.showNotification(title, pushNotificationOptions(payload)));
});

/**
 * Browsers rotate a subscription on their own schedule. Re-register with the same
 * application server key and tell the server, otherwise the device goes quiet with
 * nothing in the UI to explain why. Best-effort: failures leave the old row to be
 * pruned by the next 404/410 from the push service.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldSubscription = event.oldSubscription;
  const applicationServerKey =
    (event.newSubscription && event.newSubscription.options.applicationServerKey) ||
    (oldSubscription && oldSubscription.options.applicationServerKey);
  event.waitUntil(
    (async () => {
      try {
        const subscription =
          event.newSubscription ||
          (await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }));
        const toBase64Url = (buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return self.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        };
        await fetch("/api/push", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            p256dh: toBase64Url(subscription.getKey("p256dh")),
            auth: toBase64Url(subscription.getKey("auth")),
            previousEndpoint: oldSubscription ? oldSubscription.endpoint : null,
          }),
        });
      } catch {
        // Nothing useful to do inside a service worker; the next visit re-subscribes.
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  );
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        // Reuse the open app window: navigate it, then bring it forward.
        if ("navigate" in client) {
          const navigated = await client.navigate(target.href).catch(() => client);
          return (navigated || client).focus();
        }
        return client.focus();
      }
      return clients.openWindow(target.href);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    // Explicit allow-list exception: pit photo bytes are cache-first.
    if (isScoutMediaUrl(url)) event.respondWith(mediaCacheFirst(event, request));
    return;
  }
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
